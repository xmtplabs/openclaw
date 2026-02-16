/**
 * Shared helpers for XMTP unit tests (mock-based, no network).
 */

import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk";
import { vi } from "vitest";
import type { ResolvedXmtpAccount, CoreConfig } from "../accounts.js";
import type { DmPolicy, GroupPolicy, XMTPAccountConfig } from "../config-types.js";
import { handleInboundMessage } from "../channel.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const TEST_OWNER_ADDRESS = "0xOwner1234567890abcdef1234567890abcdef1234";
export const TEST_SENDER_ADDRESS = "0xSender567890abcdef1234567890abcdef567890";

// ---------------------------------------------------------------------------
// Account helpers (moved from e2e-helpers)
// ---------------------------------------------------------------------------

/**
 * Build an XMTPAccountConfig from a test agent.
 */
export function createTestAccountConfig(params: {
  address: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowFrom?: Array<string | number>;
  groups?: string[];
  debug?: boolean;
  ownerAddress?: string;
}): XMTPAccountConfig {
  return {
    env: "dev",
    dmPolicy: params.dmPolicy ?? "open",
    groupPolicy: params.groupPolicy ?? "open",
    allowFrom: params.allowFrom,
    groups: params.groups,
    debug: params.debug ?? true,
    publicAddress: params.address,
    ...(params.ownerAddress ? { ownerAddress: params.ownerAddress } : {}),
  };
}

/**
 * Build a ResolvedXmtpAccount for testing.
 */
export function createTestAccount(params: {
  accountId?: string;
  address: string;
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  allowFrom?: Array<string | number>;
  groups?: string[];
  debug?: boolean;
  ownerAddress?: string;
}): ResolvedXmtpAccount {
  const config = createTestAccountConfig(params);
  return {
    accountId: params.accountId ?? "default",
    enabled: true,
    configured: true,
    walletKey: "",
    dbEncryptionKey: "",
    env: "dev",
    debug: params.debug ?? true,
    publicAddress: params.address,
    ownerAddress: params.ownerAddress,
    config: config,
  };
}

// ---------------------------------------------------------------------------
// Mock runtime (moved from e2e-helpers)
// ---------------------------------------------------------------------------

export type MockRuntime = {
  runtime: PluginRuntime;
  mocks: {
    loadConfig: ReturnType<typeof vi.fn>;
    writeConfigFile: ReturnType<typeof vi.fn>;
    resolveAgentRoute: ReturnType<typeof vi.fn>;
    resolveStorePath: ReturnType<typeof vi.fn>;
    readSessionUpdatedAt: ReturnType<typeof vi.fn>;
    resolveEnvelopeFormatOptions: ReturnType<typeof vi.fn>;
    formatAgentEnvelope: ReturnType<typeof vi.fn>;
    finalizeInboundContext: ReturnType<typeof vi.fn>;
    recordInboundSession: ReturnType<typeof vi.fn>;
    resolveMarkdownTableMode: ReturnType<typeof vi.fn>;
    dispatchReplyWithBufferedBlockDispatcher: ReturnType<typeof vi.fn>;
    chunkMarkdownText: ReturnType<typeof vi.fn>;
    resolveTextChunkLimit: ReturnType<typeof vi.fn>;
    convertMarkdownTables: ReturnType<typeof vi.fn>;
    buildPairingReply: ReturnType<typeof vi.fn>;
    readAllowFromStore: ReturnType<typeof vi.fn>;
    upsertPairingRequest: ReturnType<typeof vi.fn>;
  };
};

/**
 * Create a mock PluginRuntime for unit tests of handleInboundMessage.
 */
export function createMockRuntime(overrides?: {
  dmPolicy?: DmPolicy;
  allowFrom?: Array<string | number>;
  storeAllowFrom?: string[];
  pairingResult?: { code: string; created: boolean };
}): MockRuntime {
  const cfg: CoreConfig = {
    channels: {
      xmtp: {
        dmPolicy: overrides?.dmPolicy ?? "open",
        allowFrom: overrides?.allowFrom,
        env: "dev",
      },
    },
  };

  const loadConfig = vi.fn(() => cfg);
  const writeConfigFile = vi.fn(async () => {});
  const resolveAgentRoute = vi.fn(() => ({
    agentId: "test-agent",
    accountId: "default",
    sessionKey: "test-session",
  }));
  const resolveStorePath = vi.fn(() => "/tmp/test-store");
  const readSessionUpdatedAt = vi.fn(() => null);
  const resolveEnvelopeFormatOptions = vi.fn(() => ({}));
  const formatAgentEnvelope = vi.fn(({ body }: { body: string }) => body);
  const finalizeInboundContext = vi.fn((ctx: Record<string, unknown>) => ctx);
  const recordInboundSession = vi.fn(async () => {});
  const resolveMarkdownTableMode = vi.fn(() => "code" as const);
  const dispatchReplyWithBufferedBlockDispatcher = vi.fn(async () => {});
  const chunkMarkdownText = vi.fn((text: string) => [text]);
  const resolveTextChunkLimit = vi.fn(() => 4000);
  const convertMarkdownTables = vi.fn((text: string) => text);
  const buildPairingReply = vi.fn(
    ({ code }: { channel: string; idLine: string; code: string }) => `Pairing code: ${code}`,
  );
  const readAllowFromStore = vi.fn(async () => overrides?.storeAllowFrom ?? []);
  const upsertPairingRequest = vi.fn(
    async () => overrides?.pairingResult ?? { code: "TESTCODE", created: true },
  );

  const runtime = {
    config: { loadConfig, writeConfigFile },
    channel: {
      routing: { resolveAgentRoute },
      session: {
        resolveStorePath,
        readSessionUpdatedAt,
        recordInboundSession,
      },
      reply: {
        resolveEnvelopeFormatOptions,
        formatAgentEnvelope,
        finalizeInboundContext,
        dispatchReplyWithBufferedBlockDispatcher,
      },
      text: {
        chunkMarkdownText,
        resolveTextChunkLimit,
        resolveMarkdownTableMode,
        convertMarkdownTables,
      },
      pairing: {
        buildPairingReply,
        readAllowFromStore,
        upsertPairingRequest,
      },
    },
  } as unknown as PluginRuntime;

  return {
    runtime,
    mocks: {
      loadConfig,
      writeConfigFile,
      resolveAgentRoute,
      resolveStorePath,
      readSessionUpdatedAt,
      resolveEnvelopeFormatOptions,
      formatAgentEnvelope,
      finalizeInboundContext,
      recordInboundSession,
      resolveMarkdownTableMode,
      dispatchReplyWithBufferedBlockDispatcher,
      chunkMarkdownText,
      resolveTextChunkLimit,
      convertMarkdownTables,
      buildPairingReply,
      readAllowFromStore,
      upsertPairingRequest,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock ENS resolver
// ---------------------------------------------------------------------------

/**
 * Create a mock EnsResolver for unit tests.
 * Each method returns the provided default value (or null/empty Map).
 */
export function createMockEnsResolver(overrides?: {
  resolveEnsName?: string | null;
  resolveAddress?: string | null;
  resolveAll?: Map<string, string | null>;
}) {
  return {
    resolveEnsName: vi.fn(async () => overrides?.resolveEnsName ?? null),
    resolveAddress: vi.fn(async () => overrides?.resolveAddress ?? null),
    resolveAll: vi.fn(async () => overrides?.resolveAll ?? new Map<string, string | null>()),
  };
}

// ---------------------------------------------------------------------------
// Fake XMTP agent (consolidated from access-control + outbound tests)
// ---------------------------------------------------------------------------

/**
 * Create a fake XMTP agent for unit tests.
 *
 * When `conversationId` is provided, `getConversationById` only returns a
 * conversation for that specific ID (useful for outbound routing tests).
 * When omitted, every lookup succeeds (useful for DM-policy / pairing tests).
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function makeFakeAgent(opts?: { conversationId?: string }): {
  agent: Record<string, unknown>;
  sentMessages: string[];
  sentToAddress: Array<{ to: string; text: string }>;
  fakeConversation: Record<string, unknown>;
} {
  const sentMessages: string[] = [];
  const sentToAddress: Array<{ to: string; text: string }> = [];

  const fakeConversation = {
    sendText: vi.fn(async (text: string) => {
      sentMessages.push(text);
      return "msg-id";
    }),
    sendRemoteAttachment: vi.fn(async () => "msg-attachment-id"),
    sendReaction: vi.fn(async () => {}),
  };

  const agent = {
    client: {
      conversations: {
        getConversationById: vi.fn(async (id: string) => {
          if (opts?.conversationId && id !== opts.conversationId) {
            return undefined;
          }
          return fakeConversation;
        }),
      },
    },
    createDmWithAddress: vi.fn(async (_address: string) => fakeConversation),
    sendText: vi.fn(async (to: string, text: string) => {
      sentToAddress.push({ to, text });
    }),
    on: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };

  return { agent, sentMessages, sentToAddress, fakeConversation };
}

// ---------------------------------------------------------------------------
// callInbound — named-param wrapper for handleInboundMessage
// ---------------------------------------------------------------------------

/**
 * Call `handleInboundMessage` with named params and sensible defaults.
 * Defaults to a DM (conversationId === sender) with TEST_SENDER_ADDRESS.
 */
export async function callInbound(params: {
  account: ResolvedXmtpAccount;
  sender?: string;
  conversationId?: string;
  isDirect?: boolean;
  content?: string;
  messageId?: string;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): Promise<void> {
  const {
    account,
    sender = TEST_SENDER_ADDRESS,
    content = "hello",
    messageId = "msg-1",
    runtime,
    log,
  } = params;
  const conversationId = params.conversationId ?? sender;
  // Default: if conversationId was not explicitly set, treat as DM
  const isDirect = params.isDirect ?? params.conversationId === undefined;
  return handleInboundMessage({
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
  });
}
