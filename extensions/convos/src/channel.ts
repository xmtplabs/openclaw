import {
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
} from "openclaw/plugin-sdk";
import {
  listConvosAccountIds,
  resolveConvosAccount,
  resolveDefaultConvosAccountId,
  type CoreConfig,
  type ResolvedConvosAccount,
} from "./accounts.js";
import { ConvosSDKClient, type InboundMessage } from "./sdk-client.js";
import { convosOnboardingAdapter } from "./onboarding.js";
import { convosOutbound, setClientForAccount } from "./outbound.js";
import { getConvosRuntime } from "./runtime.js";

const meta = {
  id: "convos",
  label: "Convos",
  selectionLabel: "Convos (XMTP)",
  docsPath: "/channels/convos",
  docsLabel: "convos",
  blurb: "E2E encrypted messaging via XMTP",
  systemImage: "lock.shield.fill",
  order: 75,
  quickstartAllowFrom: false,
};

// Track SDK clients per account
const clients = new Map<string, ConvosSDKClient>();

function normalizeConvosMessagingTarget(raw: string): string | undefined {
  let normalized = raw.trim();
  if (!normalized) {
    return undefined;
  }
  const lowered = normalized.toLowerCase();
  if (lowered.startsWith("convos:")) {
    normalized = normalized.slice("convos:".length).trim();
  }
  return normalized || undefined;
}

export const convosPlugin: ChannelPlugin<ResolvedConvosAccount> = {
  id: "convos",
  meta,
  capabilities: {
    chatTypes: ["group"],
    reactions: true,
    threads: false,
    media: false,
  },
  reload: { configPrefixes: ["channels.convos"] },
  onboarding: convosOnboardingAdapter,
  config: {
    listAccountIds: (cfg) => listConvosAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveConvosAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultConvosAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "convos",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as CoreConfig,
        sectionKey: "convos",
        accountId,
        clearBaseFields: ["name", "privateKey", "env", "debug", "ownerConversationId"],
      }),
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      env: account.env,
    }),
  },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dmPolicy ?? "pairing",
      allowFrom: account.config.allowFrom ?? [],
      policyPath: "channels.convos.dmPolicy",
      allowFromPath: "channels.convos.allowFrom",
    }),
  },
  messaging: {
    normalizeTarget: normalizeConvosMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        // Convos conversation IDs are UUIDs or conversation slugs
        return /^[0-9a-f-]{36}$/i.test(trimmed) || trimmed.includes("/");
      },
      hint: "<conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [], // Convos doesn't have a user directory
    listGroups: async ({ cfg, accountId, query, limit }) => {
      const account = resolveConvosAccount({ cfg: cfg as CoreConfig, accountId });
      const client = clients.get(account.accountId);
      if (!client) {
        return [];
      }
      try {
        const conversations = await client.listConversations();
        const q = query?.trim().toLowerCase() ?? "";
        return conversations
          .filter((conv) => !q || conv.displayName.toLowerCase().includes(q))
          .slice(0, limit ?? 50)
          .map((conv) => ({
            kind: "group" as const,
            id: conv.id,
            name: conv.displayName,
          }));
      } catch {
        return [];
      }
    },
  },
  outbound: convosOutbound,
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
        if (!lastError) {
          return [];
        }
        return [
          {
            channel: "convos",
            accountId: account.accountId,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          },
        ];
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      env: snapshot.env ?? "production",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      // For SDK-based client, we verify by checking if we can create a client
      // If privateKey is set, the account is considered healthy
      if (!account.privateKey) {
        return {
          ok: false,
          error: "Not configured: no private key. Run 'openclaw configure' to set up Convos.",
        };
      }

      try {
        // Create a temporary client to verify connectivity
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 10000);

        const tempClient = await ConvosSDKClient.create({
          privateKey: account.privateKey,
          env: account.env,
          debug: account.debug,
        });

        clearTimeout(timeout);
        await tempClient.stop();

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
      env: account.env,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      probe,
      lastProbeAt: runtime?.lastProbeAt ?? null,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const { account, abortSignal, setStatus, log } = ctx;
      const runtime = getConvosRuntime();

      if (!account.privateKey) {
        throw new Error(
          "Convos not configured: no private key. Run 'openclaw configure' to set up Convos.",
        );
      }

      setStatus({
        accountId: account.accountId,
        env: account.env,
      });

      log?.info(`[${account.accountId}] starting Convos provider (env: ${account.env})`);

      // Create SDK client with message handling
      const client = await ConvosSDKClient.create({
        privateKey: account.privateKey,
        env: account.env,
        debug: account.debug,
        onMessage: (msg: InboundMessage) => {
          handleInboundMessage(account, msg, runtime, log);
        },
        onInvite: async (inviteCtx) => {
          // Auto-accept invites for now
          // TODO: Add policy-based handling
          log?.info(`[${account.accountId}] Auto-accepting invite request`);
          await inviteCtx.accept();
        },
      });

      // Store client for outbound use
      clients.set(account.accountId, client);
      setClientForAccount(account.accountId, client);

      // Start listening for messages
      await client.start();

      log?.info(`[${account.accountId}] Convos provider started`);

      // Cleanup on abort
      abortSignal?.addEventListener("abort", () => {
        stopClient(account.accountId, log);
      });

      return { client };
    },
    stopAccount: async (ctx) => {
      const { account, log } = ctx;
      log?.info(`[${account.accountId}] stopping Convos provider`);
      await stopClient(account.accountId, log);
    },
  },
};

/**
 * Handle inbound messages from SDK
 */
function handleInboundMessage(
  account: ResolvedConvosAccount,
  msg: InboundMessage,
  runtime: ReturnType<typeof getConvosRuntime>,
  log?: { info: (msg: string) => void; error: (msg: string) => void },
) {
  if (account.debug) {
    log?.info(
      `[${account.accountId}] Inbound message from ${msg.senderId}: ${msg.content.slice(0, 50)}`,
    );
  }

  if (!runtime) {
    log?.error(`[${account.accountId}] No runtime available for message handling`);
    return;
  }

  // Dispatch to reply pipeline
  runtime.channel.reply.dispatchReplyFromConfig({
    channel: "convos",
    accountId: account.accountId,
    message: {
      id: msg.messageId,
      text: msg.content,
      timestamp: msg.timestamp,
      isFromOwner: msg.conversationId === account.ownerConversationId,
    },
    sender: {
      id: msg.senderId,
      name: msg.senderName,
    },
    target: {
      kind: "group",
      groupId: msg.conversationId,
    },
    replyFn: async (reply) => {
      const client = clients.get(account.accountId);
      if (!client) {
        throw new Error("Convos client not available");
      }
      await client.sendMessage(msg.conversationId, reply);
    },
  });
}

/**
 * Stop SDK client for an account
 */
async function stopClient(
  accountId: string,
  log?: { info: (msg: string) => void; error: (msg: string) => void },
) {
  const client = clients.get(accountId);
  if (client) {
    try {
      await client.stop();
    } catch (err) {
      log?.error(`[${accountId}] Error stopping client: ${String(err)}`);
    }
    clients.delete(accountId);
    setClientForAccount(accountId, null);
  }
}
