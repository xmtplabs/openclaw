/**
 * XMTP channel adapter for OpenClaw gateway.
 * Composes dm-policy, inbound-pipeline, and gateway-lifecycle modules.
 */

import type { Attachment, RemoteAttachment } from "@xmtp/agent-sdk";
import { downloadRemoteAttachment } from "@xmtp/agent-sdk";
import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type PluginRuntime,
  type ReplyPayload,
  type RuntimeLogger,
} from "openclaw/plugin-sdk";
import {
  listXmtpAccountIds,
  resolveDefaultXmtpAccountId,
  resolveXmtpAccount,
  type CoreConfig,
  type ResolvedXmtpAccount,
} from "./accounts.js";
import { xmtpMessageActions } from "./actions.js";
import { xmtpChannelConfigSchema } from "./config-schema.js";
import {
  evaluateDmAccess,
  isGroupAllowed,
  normalizeXmtpAddress,
  sendPairingReply,
} from "./dm-policy.js";
import { startAccount, stopAccountHandler } from "./gateway-lifecycle.js";
import { runInboundPipeline } from "./inbound-pipeline.js";
import { isEnsName } from "./lib/ens-resolver.js";
import { createAgentFromAccount } from "./lib/xmtp-client.js";
import { xmtpOnboardingAdapter } from "./onboarding.js";
import { getClientForAccount, xmtpOutbound } from "./outbound.js";
import { getXmtpRuntime } from "./runtime.js";

const CHANNEL_ID = "xmtp";

const meta = {
  id: CHANNEL_ID,
  label: "XMTP",
  selectionLabel: "XMTP (Agent SDK)",
  docsPath: "/channels/xmtp",
  docsLabel: "xmtp",
  blurb: "Decentralized messaging via XMTP protocol",
  systemImage: "network",
  order: 76,
  aliases: [CHANNEL_ID],
};

function normalizeXmtpMessagingTarget(raw: string): string | undefined {
  const s = normalizeXmtpAddress(raw);
  return s || undefined;
}

// Re-export for existing test imports
export { isGroupAllowed } from "./dm-policy.js";

// ---------------------------------------------------------------------------
// Inbound message handler (thin orchestrator)
// ---------------------------------------------------------------------------

export async function handleInboundMessage(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  content: string;
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}) {
  const { account, sender, conversationId, content, messageId, isDirect, runtime, log } = params;

  if (account.debug) {
    log?.info(
      `[${account.accountId}] Inbound from ${sender.slice(0, 12)}: ${content.slice(0, 50)}`,
    );
  }

  // Group access control
  if (!isDirect && !isGroupAllowed({ account, conversationId })) {
    if (account.debug) {
      log?.info(
        `[${account.accountId}] Dropped message from disallowed conversation ${conversationId.slice(0, 12)}`,
      );
    }
    return;
  }

  // DM access control
  if (isDirect) {
    const decision = await evaluateDmAccess({ account, sender, runtime });
    if (!decision.allowed) {
      if (decision.reason === "pairing" && decision.created && decision.code) {
        await sendPairingReply({
          account,
          sender,
          conversationId,
          code: decision.code,
          runtime,
          log,
        });
      } else if (decision.reason === "blocked" && account.debug) {
        log?.info(
          `[${account.accountId}] Blocked DM from ${sender.slice(0, 12)} (dmPolicy=${decision.dmPolicy})`,
        );
      } else if (decision.reason === "disabled" && account.debug) {
        log?.info(
          `[${account.accountId}] Dropped DM from ${sender.slice(0, 12)} (dmPolicy=disabled)`,
        );
      }
      return;
    }
  }

  // Pipeline: route -> envelope -> session -> dispatch
  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await runInboundPipeline({
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
    senderName: params.senderName,
    groupMembers: params.groupMembers,
    ensContext: params.ensContext,
    deliverReply: async (payload: ReplyPayload) => {
      await deliverXmtpReply({
        payload,
        conversationId,
        accountId: account.accountId,
        runtime,
        log,
        tableMode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Inbound reaction handler
// ---------------------------------------------------------------------------

export async function handleInboundReaction(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  reaction: { content: string; action: number | string; reference: string };
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}) {
  const { account, sender, conversationId, reaction, messageId, isDirect, runtime, log } = params;

  const actionLabel = reaction.action === 2 ? "removed" : "added";

  if (account.debug) {
    log?.info(
      `[${account.accountId}] Reaction from ${sender.slice(0, 12)}: ${reaction.content} ${actionLabel}`,
    );
  }

  // Group access control (same as handleInboundMessage)
  if (!isDirect && !isGroupAllowed({ account, conversationId })) {
    if (account.debug) {
      log?.info(
        `[${account.accountId}] Dropped reaction from disallowed conversation ${conversationId.slice(0, 12)}`,
      );
    }
    return;
  }

  // DM access control (same as handleInboundMessage)
  if (isDirect) {
    const decision = await evaluateDmAccess({ account, sender, runtime });
    if (!decision.allowed) {
      if (account.debug) {
        log?.info(
          `[${account.accountId}] Dropped reaction from ${sender.slice(0, 12)} (dm access denied)`,
        );
      }
      return;
    }
  }

  // Format reaction as descriptive content for the inbound pipeline
  const content = `[Reaction: ${reaction.content} ${actionLabel} to message ${reaction.reference}]`;

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await runInboundPipeline({
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
    senderName: params.senderName,
    groupMembers: params.groupMembers,
    ensContext: params.ensContext,
    deliverReply: async (payload: ReplyPayload) => {
      await deliverXmtpReply({
        payload,
        conversationId,
        accountId: account.accountId,
        runtime,
        log,
        tableMode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Inbound attachment handler (RemoteAttachment — download + decrypt)
// ---------------------------------------------------------------------------

export async function handleInboundAttachment(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  remoteAttachments: RemoteAttachment[];
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}) {
  const { account, sender, conversationId, remoteAttachments, messageId, isDirect, runtime, log } =
    params;

  // Group access control (same as handleInboundMessage)
  if (!isDirect && !isGroupAllowed({ account, conversationId })) {
    if (account.debug) {
      log?.info(
        `[${account.accountId}] Dropped attachment from disallowed conversation ${conversationId.slice(0, 12)}`,
      );
    }
    return;
  }

  // DM access control (same as handleInboundMessage)
  if (isDirect) {
    const decision = await evaluateDmAccess({ account, sender, runtime });
    if (!decision.allowed) {
      if (account.debug) {
        log?.info(
          `[${account.accountId}] Dropped attachment from ${sender.slice(0, 12)} (dm access denied)`,
        );
      }
      return;
    }
  }

  // Download, decrypt, and save each attachment
  const media: Array<{ path: string; contentType?: string }> = [];
  const filenames: string[] = [];

  for (const ra of remoteAttachments) {
    try {
      const decrypted = await downloadRemoteAttachment(ra);
      const saved = await runtime.channel.media.saveMediaBuffer(
        Buffer.from(decrypted.content),
        decrypted.mimeType,
        "inbound",
        undefined,
        decrypted.filename,
      );
      media.push({ path: saved.path, contentType: saved.contentType });
      filenames.push(decrypted.filename ?? ra.filename ?? "attachment");
    } catch (err) {
      log?.error(`[${account.accountId}] Failed to download remote attachment: ${String(err)}`);
    }
  }

  if (media.length === 0) return;

  const content =
    filenames.length === 1
      ? `[Attachment: ${filenames[0]}]`
      : `[Attachments: ${filenames.join(", ")}]`;

  if (account.debug) {
    log?.info(`[${account.accountId}] Inbound attachment from ${sender.slice(0, 12)}: ${content}`);
  }

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await runInboundPipeline({
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
    media,
    senderName: params.senderName,
    groupMembers: params.groupMembers,
    ensContext: params.ensContext,
    deliverReply: async (payload: ReplyPayload) => {
      await deliverXmtpReply({
        payload,
        conversationId,
        accountId: account.accountId,
        runtime,
        log,
        tableMode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Inbound inline attachment handler (Attachment — bytes already decoded)
// ---------------------------------------------------------------------------

export async function handleInboundInlineAttachment(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  attachments: Attachment[];
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}) {
  const { account, sender, conversationId, attachments, messageId, isDirect, runtime, log } =
    params;

  // Group access control
  if (!isDirect && !isGroupAllowed({ account, conversationId })) {
    if (account.debug) {
      log?.info(
        `[${account.accountId}] Dropped inline attachment from disallowed conversation ${conversationId.slice(0, 12)}`,
      );
    }
    return;
  }

  // DM access control
  if (isDirect) {
    const decision = await evaluateDmAccess({ account, sender, runtime });
    if (!decision.allowed) {
      if (account.debug) {
        log?.info(
          `[${account.accountId}] Dropped inline attachment from ${sender.slice(0, 12)} (dm access denied)`,
        );
      }
      return;
    }
  }

  // Save each inline attachment directly (no download needed)
  const media: Array<{ path: string; contentType?: string }> = [];
  const filenames: string[] = [];

  for (const att of attachments) {
    try {
      const saved = await runtime.channel.media.saveMediaBuffer(
        Buffer.from(att.content),
        att.mimeType,
        "inbound",
        undefined,
        att.filename,
      );
      media.push({ path: saved.path, contentType: saved.contentType });
      filenames.push(att.filename ?? "attachment");
    } catch (err) {
      log?.error(`[${account.accountId}] Failed to save inline attachment: ${String(err)}`);
    }
  }

  if (media.length === 0) return;

  const content =
    filenames.length === 1
      ? `[Attachment: ${filenames[0]}]`
      : `[Attachments: ${filenames.join(", ")}]`;

  if (account.debug) {
    log?.info(
      `[${account.accountId}] Inbound inline attachment from ${sender.slice(0, 12)}: ${content}`,
    );
  }

  const tableMode = runtime.channel.text.resolveMarkdownTableMode({
    cfg: runtime.config.loadConfig(),
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  await runInboundPipeline({
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
    media,
    senderName: params.senderName,
    groupMembers: params.groupMembers,
    ensContext: params.ensContext,
    deliverReply: async (payload: ReplyPayload) => {
      await deliverXmtpReply({
        payload,
        conversationId,
        accountId: account.accountId,
        runtime,
        log,
        tableMode,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Reply delivery
// ---------------------------------------------------------------------------

async function deliverXmtpReply(params: {
  payload: ReplyPayload;
  conversationId: string;
  accountId: string;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  tableMode?: "off" | "bullets" | "code";
}): Promise<void> {
  const { payload, conversationId, accountId, runtime, log, tableMode = "code" } = params;

  const agent = getClientForAccount(accountId);
  if (!agent) {
    throw new Error("XMTP agent not available");
  }

  const text = runtime.channel.text.convertMarkdownTables(payload.text ?? "", tableMode);

  if (text) {
    const conversation = await agent.client.conversations.getConversationById(conversationId);
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId.slice(0, 12)}...`);
    }

    const cfg = runtime.config.loadConfig();
    const chunkLimit = runtime.channel.text.resolveTextChunkLimit(cfg, CHANNEL_ID, accountId);
    const chunks = runtime.channel.text.chunkMarkdownText(text, chunkLimit);

    for (const chunk of chunks) {
      try {
        await conversation.sendText(chunk);
      } catch (err) {
        log?.error(`[${accountId}] Failed to send message: ${String(err)}`);
        throw err;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const xmtpPlugin: ChannelPlugin<ResolvedXmtpAccount> = {
  id: CHANNEL_ID,
  meta,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: true,
    threads: false,
  },
  reload: { configPrefixes: ["channels.xmtp"] },
  gatewayMethods: ["xmtp.setup", "xmtp.setup.status", "xmtp.setup.complete", "xmtp.setup.cancel"],
  configSchema: xmtpChannelConfigSchema,
  onboarding: xmtpOnboardingAdapter,
  config: {
    listAccountIds: (cfg) => listXmtpAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultXmtpAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: CHANNEL_ID,
        accountId,
        clearBaseFields: [
          "name",
          "walletKey",
          "dbEncryptionKey",
          "env",
          "debug",
          "publicAddress",
          "ownerAddress",
        ],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      env: account.env,
      publicAddress: account.publicAddress || undefined,
      ownerAddress: account.ownerAddress || undefined,
    }),
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.xmtp.dmPolicy",
      allowFromPath: "channels.xmtp.allowFrom",
      approveHint: "wallet address",
    }),
  },
  pairing: {
    idLabel: "address",
    normalizeAllowEntry: (entry) => normalizeXmtpAddress(entry),
  },
  messaging: {
    normalizeTarget: normalizeXmtpMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const t = raw.trim();
        if (!t) return false;
        // Ethereum address: exactly 42 hex chars (0x + 40)
        if (t.length === 42 && /^0x[0-9a-fA-F]{40}$/.test(t)) return true;
        if (isEnsName(t)) return true;
        return false;
      },
      hint: "<address, ENS name, or conversation topic>",
    },
  },
  actions: xmtpMessageActions,
  agentPrompt: {
    messageToolHints: ({ cfg, accountId }) => {
      const hints = [
        "- XMTP targets are wallet addresses, ENS names, or conversation topics. Use `to=<address or name.eth>` for `action=send`.",
        "- When ENS names are available (in SenderName, GroupMembers, or [ENS Context] blocks), always refer to users by their ENS name (e.g., nick.eth) rather than raw Ethereum addresses.",
        "- Use `action=react` with `to=<conversation>`, `messageId=<id>`, and `emoji=<emoji>` to react to messages.",
      ];
      try {
        const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
        if (!account.config.pinataApiKey || !account.config.pinataSecretKey) {
          hints.push(
            "- Media sending is NOT available: Pinata IPFS credentials are not configured for this XMTP account. Do not attempt to send images or files.",
          );
        } else {
          hints.push("- Media sending is available. You can include images and files in messages.");
        }
      } catch {
        // If account resolution fails, omit media hint
      }
      return hints;
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  outbound: xmtpOutbound,
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (!lastError) return [];
        return [
          {
            channel: CHANNEL_ID,
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot, account }) => ({
      configured: snapshot.configured ?? false,
      env: (account as ResolvedXmtpAccount).env ?? "production",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.walletKey || !account.dbEncryptionKey) {
        return {
          ok: false,
          error: "Not configured: walletKey and dbEncryptionKey required.",
        };
      }
      try {
        const runtime = getXmtpRuntime();
        const stateDir = runtime.state.resolveStateDir();
        const agent = await createAgentFromAccount(account, stateDir);
        const limit = timeoutMs ?? 10000;
        try {
          await Promise.race([
            agent.start(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("Probe timed out")), limit),
            ),
          ]);
        } finally {
          await agent.stop().catch(() => {});
        }
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastProbeAt: runtime?.lastProbeAt ?? null,
    }),
  },
  gateway: {
    startAccount,
    stopAccount: stopAccountHandler,
  },
};
