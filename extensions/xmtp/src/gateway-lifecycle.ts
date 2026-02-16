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
import {
  createEnsResolver,
  setResolverForAccount,
  isEnsName,
  getResolverForAccount,
  extractEnsNames,
  extractEthAddresses,
  formatEnsContext,
  formatGroupMembersWithEns,
  resolveOwnerAddress,
} from "./lib/ens-resolver.js";
import { createAgentFromAccount } from "./lib/xmtp-client.js";
import { getClientForAccount, setClientForAccount } from "./outbound.js";
import { getXmtpRuntime } from "./runtime.js";

// ---------------------------------------------------------------------------
// Stop helpers
// ---------------------------------------------------------------------------

export async function stopAgent(accountId: string, log?: RuntimeLogger): Promise<void> {
  setResolverForAccount(accountId, null); // Clean up resolver
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

  // Create ENS resolver for this account
  const ensResolver = createEnsResolver(account.config.web3BioApiKey);
  setResolverForAccount(account.accountId, ensResolver);

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
      const ownerAddr = await resolveOwnerAddress(account.ownerAddress, ensResolver);
      if (ownerAddr !== account.ownerAddress) {
        log?.info(
          `[${account.accountId}] Resolved owner ENS ${account.ownerAddress} → ${ownerAddr.slice(0, 12)}...`,
        );
      } else if (isEnsName(account.ownerAddress)) {
        log?.warn?.(`[${account.accountId}] Could not resolve owner ENS: ${account.ownerAddress}`);
      }
      if (/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) {
        await agent.createDmWithAddress(ownerAddr as `0x${string}`);
        log?.info(`[${account.accountId}] Owner DM ready (${ownerAddr.slice(0, 12)}...)`);
      }
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

/** Resolve ENS context for an inbound message. */
export async function resolveInboundEns(params: {
  accountId: string;
  sender: string;
  content: string;
  isDirect: boolean;
  conversation?: {
    members?: () => Promise<
      Array<{ accountIdentifiers: Array<{ identifier: string; identifierKind: unknown }> }>
    >;
  };
  log?: RuntimeLogger;
}): Promise<{
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}> {
  const resolver = getResolverForAccount(params.accountId);
  if (!resolver) return {};

  const result: { senderName?: string; groupMembers?: string; ensContext?: string } = {};

  // Resolve sender address to ENS name
  const senderName = await resolver.resolveAddress(params.sender);
  if (senderName) result.senderName = senderName;

  // Resolve ENS names and addresses mentioned in message content
  const names = extractEnsNames(params.content);
  const addresses = extractEthAddresses(params.content);
  const identifiers = [...names, ...addresses];
  if (identifiers.length > 0) {
    const resolved = await resolver.resolveAll(identifiers);
    const context = formatEnsContext(resolved);
    if (context) result.ensContext = context;
  }

  // Resolve group members (only for group conversations)
  if (!params.isDirect && params.conversation?.members) {
    try {
      const members = await params.conversation.members();
      const memberAddresses = members
        .flatMap((m) => m.accountIdentifiers)
        .filter((id) => typeof id.identifier === "string" && /^0x/i.test(id.identifier))
        .map((id) => id.identifier);
      if (memberAddresses.length > 0) {
        const resolved = await resolver.resolveAll(memberAddresses);
        const formatted = formatGroupMembersWithEns(memberAddresses, resolved);
        if (formatted) result.groupMembers = formatted;
      }
    } catch (err) {
      params.log?.warn?.(`ENS group member resolution failed: ${String(err)}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Generic inbound handler factory
// ---------------------------------------------------------------------------

type HandlerBaseParams = {
  account: ResolvedXmtpAccount;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
};

/**
 * Create an inbound event handler with shared boilerplate:
 * denied-check → content extraction → getSenderAddress → resolveInboundEns → dispatch.
 */
function createInboundHandler<T>(
  base: HandlerBaseParams,
  config: {
    label: string;
    /** Extract and validate content from the message context. Return null to skip. */
    extractContent: (msgCtx: MessageContext<T>) => T | null | undefined;
    /** Return text to use for ENS resolution (empty string for non-text content). */
    ensText: (content: T) => string;
    /** Dispatch the validated content to the appropriate channel handler. */
    dispatch: (ctx: {
      content: T;
      sender: string;
      conversationId: string;
      messageId: string | undefined;
      isDirect: boolean;
      ens: { senderName?: string; groupMembers?: string; ensContext?: string };
    }) => Promise<void>;
  },
): (msgCtx: MessageContext<T>) => Promise<void> {
  const { account, log } = base;
  const { label, extractContent, ensText, dispatch } = config;

  return async (msgCtx: MessageContext<T>) => {
    if (msgCtx.isDenied) {
      if (account.debug) {
        log?.info(`[${account.accountId}] Skipped ${label} from denied contact`);
      }
      return;
    }

    const content = extractContent(msgCtx);
    if (content == null) return;

    const sender = await msgCtx.getSenderAddress();
    if (!sender) return;

    const conversationId = msgCtx.conversation?.id as string;
    const isDirect = msgCtx.isDm();

    const ens = await resolveInboundEns({
      accountId: account.accountId,
      sender,
      content: ensText(content),
      isDirect,
      conversation: msgCtx.conversation as any,
      log,
    });

    try {
      await dispatch({
        content,
        sender,
        conversationId,
        messageId: msgCtx.message.id,
        isDirect,
        ens,
      });
    } catch (err) {
      log?.error(`[${account.accountId}] ${label} handling failed: ${String(err)}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Concrete handler builders (thin wrappers over createInboundHandler)
// ---------------------------------------------------------------------------

/** Build the text/markdown event handler for inbound messages. */
export function buildTextHandler(params: HandlerBaseParams) {
  const { account, runtime, log } = params;
  return createInboundHandler<string>(params, {
    label: "message",
    extractContent: (msgCtx) => {
      const content = msgCtx.message?.content;
      if (typeof content !== "string") return null;
      log?.info(
        `[${account.accountId}] text event: ${JSON.stringify({ content: content.slice(0, 50), id: msgCtx.message?.id })}`,
      );
      return content;
    },
    ensText: (content) => content,
    dispatch: async ({ content, sender, conversationId, messageId, isDirect, ens }) => {
      await handleInboundMessage({
        account,
        sender,
        conversationId,
        content,
        messageId,
        isDirect,
        runtime,
        log,
        ...ens,
      });
    },
  });
}

/** Build the reaction event handler for inbound reactions. */
export function buildReactionHandler(params: HandlerBaseParams) {
  const { account, runtime, log } = params;
  return createInboundHandler<Reaction>(params, {
    label: "reaction",
    extractContent: (msgCtx) => {
      const reaction = msgCtx.message?.content;
      if (!reaction) return null;
      log?.info(
        `[${account.accountId}] reaction event: ${JSON.stringify({
          content: reaction.content,
          action: reaction.action,
          reference: reaction.reference,
        })}`,
      );
      return reaction;
    },
    ensText: (reaction) => `[Reaction: ${reaction.content}]`,
    dispatch: async ({ content: reaction, sender, conversationId, messageId, isDirect, ens }) => {
      await handleInboundReaction({
        account,
        sender,
        conversationId,
        reaction,
        messageId,
        isDirect,
        runtime,
        log,
        ...ens,
      });
    },
  });
}

/** Build the attachment event handler for inbound RemoteAttachments. */
export function buildAttachmentHandler(params: HandlerBaseParams) {
  const { account, runtime, log } = params;
  return createInboundHandler<RemoteAttachment>(params, {
    label: "attachment",
    extractContent: (msgCtx) => msgCtx.message?.content ?? null,
    ensText: () => "",
    dispatch: async ({ content, sender, conversationId, messageId, isDirect, ens }) => {
      await handleInboundAttachment({
        account,
        sender,
        conversationId,
        remoteAttachments: [content],
        messageId,
        isDirect,
        runtime,
        log,
        ...ens,
      });
    },
  });
}

/** Build the inline-attachment event handler for inbound Attachments (raw bytes). */
export function buildInlineAttachmentHandler(params: HandlerBaseParams) {
  const { account, runtime, log } = params;
  return createInboundHandler<Attachment>(params, {
    label: "inline attachment",
    extractContent: (msgCtx) => msgCtx.message?.content ?? null,
    ensText: () => "",
    dispatch: async ({ content, sender, conversationId, messageId, isDirect, ens }) => {
      await handleInboundInlineAttachment({
        account,
        sender,
        conversationId,
        attachments: [content],
        messageId,
        isDirect,
        runtime,
        log,
        ...ens,
      });
    },
  });
}

/** Build the multi-attachment event handler for inbound MultiRemoteAttachments. */
export function buildMultiAttachmentHandler(params: HandlerBaseParams) {
  const { account, runtime, log } = params;
  return createInboundHandler<MultiRemoteAttachment>(params, {
    label: "multi-attachment",
    extractContent: (msgCtx) => {
      const multi = msgCtx.message?.content;
      return multi?.attachments?.length ? multi : null;
    },
    ensText: () => "",
    dispatch: async ({ content: multi, sender, conversationId, messageId, isDirect, ens }) => {
      // RemoteAttachmentInfo is structurally compatible with RemoteAttachment
      const remoteAttachments = multi.attachments as unknown as RemoteAttachment[];
      await handleInboundAttachment({
        account,
        sender,
        conversationId,
        remoteAttachments,
        messageId,
        isDirect,
        runtime,
        log,
        ...ens,
      });
    },
  });
}
