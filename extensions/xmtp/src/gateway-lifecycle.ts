/**
 * XMTP gateway agent lifecycle: start, stop, event wiring.
 */

import type {
  Attachment,
  MessageContext,
  MultiRemoteAttachment,
  Reaction,
  RemoteAttachment,
} from "@xmtp/agent-sdk";
import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk";
import {
  autoProvisionAccount,
  ensureXmtpConfigured,
  setAccountPublicAddress,
  type ResolvedXmtpAccount,
} from "./accounts.js";
import {
  handleInboundAttachment,
  handleInboundInlineAttachment,
  handleInboundMessage,
  handleInboundReaction,
} from "./channel.js";
import { createAgentFromAccount } from "./lib/xmtp-client.js";
import { getClientForAccount, setClientForAccount } from "./outbound.js";
import { getXmtpRuntime } from "./runtime.js";

// ---------------------------------------------------------------------------
// Stop helpers
// ---------------------------------------------------------------------------

export async function stopAgent(accountId: string, log?: RuntimeLogger): Promise<void> {
  const agent = getClientForAccount(accountId);
  if (agent) {
    try {
      await agent.stop();
    } catch (err) {
      log?.error(`[${accountId}] Error stopping agent: ${String(err)}`);
    }
    setClientForAccount(accountId, null);
  }
}

// ---------------------------------------------------------------------------
// Start / stop account (used by gateway adapter)
// ---------------------------------------------------------------------------

export async function startAccount(ctx: {
  account: ResolvedXmtpAccount;
  abortSignal?: AbortSignal;
  setStatus: (s: { accountId: string }) => void;
  log?: RuntimeLogger;
}): Promise<void> {
  const { abortSignal, setStatus, log } = ctx;
  const runtime = getXmtpRuntime();
  const account = await autoProvisionAccount(ctx.account, runtime, log);
  ensureXmtpConfigured(account);

  setStatus({ accountId: account.accountId });

  const stateDir = runtime.state.resolveStateDir();
  const agent = await createAgentFromAccount(account, stateDir);

  agent.errors.use(async (error, _ctx, next) => {
    log?.error(`[${account.accountId}] Agent error: ${String(error)}`);
    next();
  });

  await backfillPublicAddress({ account, agent, runtime, log });

  log?.info(
    `[${account.accountId}] starting XMTP provider (env: ${account.env}, agent: ${agent.address ?? account.publicAddress})`,
  );

  const handleTextLike = buildTextHandler({ account, runtime, log });
  const handleReaction = buildReactionHandler({ account, runtime, log });
  const handleAttachment = buildAttachmentHandler({ account, runtime, log });
  const handleInlineAttachment = buildInlineAttachmentHandler({ account, runtime, log });
  const handleMultiAttachment = buildMultiAttachmentHandler({ account, runtime, log });

  agent.on("text", handleTextLike);
  agent.on("markdown", handleTextLike);
  agent.on("reaction", handleReaction);
  agent.on("attachment", handleAttachment);
  agent.on("inline-attachment", handleInlineAttachment);
  agent.on("multi-attachment", handleMultiAttachment);

  await agent.start();
  setClientForAccount(account.accountId, agent);

  log?.info(`[${account.accountId}] XMTP provider started`);

  // Proactively open DM with owner so the channel is ready
  if (account.ownerAddress) {
    try {
      await agent.createDmWithAddress(account.ownerAddress as `0x${string}`);
      log?.info(`[${account.accountId}] Owner DM ready (${account.ownerAddress.slice(0, 12)}...)`);
    } catch (err) {
      log?.warn?.(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
    }
  }

  await new Promise<void>((resolve) => {
    const onAbort = () => {
      void stopAgent(account.accountId, log).finally(resolve);
    };
    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function stopAccountHandler(ctx: {
  account: ResolvedXmtpAccount;
  log?: RuntimeLogger;
}): Promise<void> {
  const { account, log } = ctx;
  log?.info(`[${account.accountId}] stopping XMTP provider`);
  await stopAgent(account.accountId, log);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Backfill publicAddress from agent.address when config doesn't have it. */
export async function backfillPublicAddress(params: {
  account: ResolvedXmtpAccount;
  agent: { address?: string };
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): Promise<void> {
  const { account, agent, runtime, log } = params;
  if (!account.config.publicAddress && agent.address) {
    const cfg = runtime.config.loadConfig();
    const next = setAccountPublicAddress(cfg, account.accountId, agent.address);
    await runtime.config.writeConfigFile(next);
    log?.info(`[${account.accountId}] backfilled publicAddress to config`);
  }
}

/** Build the reaction event handler for inbound reactions. */
export function buildReactionHandler(params: {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): (msgCtx: MessageContext<Reaction>) => Promise<void> {
  const { account, runtime, log } = params;

  return async (msgCtx: MessageContext<Reaction>) => {
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped reaction from denied contact`);
      }
      return;
    }

    const reaction = msgCtx.message?.content;
    if (!reaction) return;

    log?.info(
      `[${account.accountId}] reaction event: ${JSON.stringify({
        content: reaction.content,
        action: reaction.action,
        reference: reaction.reference,
      })}`,
    );

    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;

    const conversationId = msgCtx.conversation?.id as string;
    const isDirect = msgCtx.isDm();

    handleInboundReaction({
      account,
      sender,
      conversationId,
      reaction,
      messageId: msgCtx.message.id,
      isDirect,
      runtime,
      log,
    }).catch((err) => {
      log?.error(`[${account.accountId}] Reaction handling failed: ${String(err)}`);
    });
  };
}

/** Build the text/markdown event handler for inbound messages. */
export function buildTextHandler(params: {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): (msgCtx: MessageContext<string>) => Promise<void> {
  const { account, runtime, log } = params;

  return async (msgCtx: MessageContext<string>) => {
    // Skip messages from denied contacts
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped message from denied contact`);
      }
      return;
    }

    const content = msgCtx.message?.content;
    if (typeof content !== "string") return;

    log?.info(
      `[${account.accountId}] text event: ${JSON.stringify({ content: content.slice(0, 50), id: msgCtx.message?.id })}`,
    );
    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;
    const conversation = msgCtx.conversation;
    const conversationId = conversation?.id as string;
    const isDirect = msgCtx.isDm();
    handleInboundMessage({
      account,
      sender,
      conversationId,
      content,
      messageId: msgCtx.message.id,
      isDirect,
      runtime,
      log,
    }).catch((err) => {
      log?.error(`[${account.accountId}] Message handling failed: ${String(err)}`);
    });
  };
}

/** Build the attachment event handler for inbound RemoteAttachments. */
export function buildAttachmentHandler(params: {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): (msgCtx: MessageContext<RemoteAttachment>) => Promise<void> {
  const { account, runtime, log } = params;

  return async (msgCtx: MessageContext<RemoteAttachment>) => {
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped attachment from denied contact`);
      }
      return;
    }

    const remoteAttachment = msgCtx.message?.content;
    if (!remoteAttachment) return;

    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;

    const conversationId = msgCtx.conversation?.id as string;
    const isDirect = msgCtx.isDm();

    handleInboundAttachment({
      account,
      sender,
      conversationId,
      remoteAttachments: [remoteAttachment],
      messageId: msgCtx.message.id,
      isDirect,
      runtime,
      log,
    }).catch((err) => {
      log?.error(`[${account.accountId}] Attachment handling failed: ${String(err)}`);
    });
  };
}

/** Build the inline-attachment event handler for inbound Attachments (raw bytes). */
export function buildInlineAttachmentHandler(params: {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): (msgCtx: MessageContext<Attachment>) => Promise<void> {
  const { account, runtime, log } = params;

  return async (msgCtx: MessageContext<Attachment>) => {
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped inline attachment from denied contact`);
      }
      return;
    }

    const attachment = msgCtx.message?.content;
    if (!attachment) return;

    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;

    const conversationId = msgCtx.conversation?.id as string;
    const isDirect = msgCtx.isDm();

    handleInboundInlineAttachment({
      account,
      sender,
      conversationId,
      attachments: [attachment],
      messageId: msgCtx.message.id,
      isDirect,
      runtime,
      log,
    }).catch((err) => {
      log?.error(`[${account.accountId}] Inline attachment handling failed: ${String(err)}`);
    });
  };
}

/** Build the multi-attachment event handler for inbound MultiRemoteAttachments. */
export function buildMultiAttachmentHandler(params: {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): (msgCtx: MessageContext<MultiRemoteAttachment>) => Promise<void> {
  const { account, runtime, log } = params;

  return async (msgCtx: MessageContext<MultiRemoteAttachment>) => {
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped multi-attachment from denied contact`);
      }
      return;
    }

    const multiAttachment = msgCtx.message?.content;
    if (!multiAttachment?.attachments?.length) return;

    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;

    const conversationId = msgCtx.conversation?.id as string;
    const isDirect = msgCtx.isDm();

    // RemoteAttachmentInfo is structurally compatible with RemoteAttachment
    const remoteAttachments = multiAttachment.attachments as unknown as RemoteAttachment[];

    handleInboundAttachment({
      account,
      sender,
      conversationId,
      remoteAttachments,
      messageId: msgCtx.message.id,
      isDirect,
      runtime,
      log,
    }).catch((err) => {
      log?.error(`[${account.accountId}] Multi-attachment handling failed: ${String(err)}`);
    });
  };
}
