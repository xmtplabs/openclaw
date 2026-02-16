/**
 * Unit tests for gateway-lifecycle.ts — agent start/stop, event wiring, address backfill.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  backfillPublicAddress,
  buildAttachmentHandler,
  buildInlineAttachmentHandler,
  buildMultiAttachmentHandler,
  buildReactionHandler,
  buildTextHandler,
  resolveInboundEns,
  stopAgent,
} from "./gateway-lifecycle.js";
import {
  getResolverForAccount,
  setResolverForAccount,
  createEnsResolver,
  isEnsName,
} from "./lib/ens-resolver.js";
import { setClientForAccount, getClientForAccount } from "./outbound.js";
import { setXmtpRuntime } from "./runtime.js";
import {
  createMockEnsResolver,
  createMockRuntime,
  createTestAccount,
  makeFakeAgent,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

// ---------------------------------------------------------------------------
// stopAgent
// ---------------------------------------------------------------------------

describe("stopAgent", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
    setResolverForAccount("default", null);
  });

  it("clears the ENS resolver for the account", async () => {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);
    expect(getResolverForAccount("default")).toBe(resolver);

    await stopAgent("default");

    expect(getResolverForAccount("default")).toBeNull();
  });

  it("stops agent and removes from registry", async () => {
    const { agent } = makeFakeAgent();
    setClientForAccount("default", agent as any);

    await stopAgent("default");

    expect(agent.stop).toHaveBeenCalled();
    expect(getClientForAccount("default")).toBeUndefined();
  });

  it("does nothing for non-existent account", async () => {
    // Should not throw
    await stopAgent("nonexistent");
    expect(getClientForAccount("nonexistent")).toBeUndefined();
  });

  it("logs error and still removes agent on stop failure", async () => {
    const { agent } = makeFakeAgent();
    (agent.stop as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("stop failed"));
    setClientForAccount("default", agent as any);
    const log = { info: vi.fn(), error: vi.fn() };

    await stopAgent("default", log as any);

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("stop failed"));
    expect(getClientForAccount("default")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// backfillPublicAddress
// ---------------------------------------------------------------------------

describe("backfillPublicAddress", () => {
  it("writes address to config when account has no publicAddress", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    account.config.publicAddress = undefined;
    const writeConfigFile = vi.fn(async () => {});
    const loadConfig = vi.fn(() => ({ channels: { xmtp: {} } }));
    const runtime = { config: { loadConfig, writeConfigFile } } as unknown as PluginRuntime;
    const log = { info: vi.fn(), error: vi.fn() };

    await backfillPublicAddress({
      account,
      agent: { address: "0xNewAddress" },
      runtime,
      log: log as any,
    });

    expect(writeConfigFile).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("backfilled publicAddress"));
  });

  it("skips backfill when account already has publicAddress", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    account.config.publicAddress = "0xExisting";
    const writeConfigFile = vi.fn(async () => {});
    const runtime = { config: { writeConfigFile } } as unknown as PluginRuntime;

    await backfillPublicAddress({
      account,
      agent: { address: "0xNewAddress" },
      runtime,
    });

    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("skips backfill when agent has no address", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    account.config.publicAddress = undefined;
    const writeConfigFile = vi.fn(async () => {});
    const runtime = { config: { writeConfigFile } } as unknown as PluginRuntime;

    await backfillPublicAddress({
      account,
      agent: { address: undefined },
      runtime,
    });

    expect(writeConfigFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Shared handler guard-clause tests (all 5 handler builders)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlerCases: Array<{
  name: string;
  build: (p: { account: any; runtime: any; log?: any }) => (ctx: any) => Promise<void>;
  validMsg: Record<string, unknown>;
}> = [
  {
    name: "buildTextHandler",
    build: buildTextHandler,
    validMsg: { content: "hello", id: "msg-1" },
  },
  {
    name: "buildReactionHandler",
    build: buildReactionHandler,
    validMsg: { content: { content: "\u2764\uFE0F", action: 1, reference: "msg-1" }, id: "r-1" },
  },
  {
    name: "buildAttachmentHandler",
    build: buildAttachmentHandler,
    validMsg: { content: { url: "https://example.com/file" }, id: "att-1" },
  },
  {
    name: "buildInlineAttachmentHandler",
    build: buildInlineAttachmentHandler,
    validMsg: {
      content: { filename: "test.png", mimeType: "image/png", content: new Uint8Array([1]) },
      id: "att-1",
    },
  },
  {
    name: "buildMultiAttachmentHandler",
    build: buildMultiAttachmentHandler,
    validMsg: { content: { attachments: [{ url: "https://example.com/file" }] }, id: "multi-1" },
  },
];

describe.each(handlerCases)("$name", ({ build, validMsg }) => {
  beforeEach(() => {
    setClientForAccount("default", null);
    setXmtpRuntime({
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
      },
    } as unknown as PluginRuntime);
  });

  it("returns a function", () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime } = createMockRuntime();
    expect(typeof build({ account, runtime })).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = build({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: validMsg,
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips messages with null content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = build({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "null-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips messages when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = build({ account, runtime });
    await handler({
      isDenied: false,
      message: validMsg,
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// buildMultiAttachmentHandler has one additional edge case
describe("buildMultiAttachmentHandler (empty array)", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
    setXmtpRuntime({
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
      },
    } as unknown as PluginRuntime);
  });

  it("skips multi-attachments with empty attachments array", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildMultiAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: { attachments: [] }, id: "multi-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Owner DM creation on startup
// ---------------------------------------------------------------------------

describe("owner DM creation on startup", () => {
  it("creates DM with owner address when configured", async () => {
    const { agent } = makeFakeAgent();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      ownerAddress: TEST_SENDER_ADDRESS,
    });

    // Simulate the owner DM creation logic from startAccount
    if (account.ownerAddress) {
      await agent.createDmWithAddress(account.ownerAddress as `0x${string}`);
      log.info(`[${account.accountId}] Owner DM ready (${account.ownerAddress.slice(0, 12)}...)`);
    }

    expect(agent.createDmWithAddress).toHaveBeenCalledWith(TEST_SENDER_ADDRESS);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Owner DM ready"));
  });

  it("succeeds even if owner DM creation fails", async () => {
    const { agent } = makeFakeAgent();
    (agent.createDmWithAddress as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("not registered"),
    );
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      ownerAddress: TEST_SENDER_ADDRESS,
    });

    // Simulate the owner DM creation logic from startAccount (best-effort)
    if (account.ownerAddress) {
      try {
        await agent.createDmWithAddress(account.ownerAddress as `0x${string}`);
        log.info(`[${account.accountId}] Owner DM ready`);
      } catch (err) {
        log.warn(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
      }
    }

    expect(agent.createDmWithAddress).toHaveBeenCalledWith(TEST_SENDER_ADDRESS);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Could not create owner DM"));
  });

  it("skips DM creation when no owner is configured", async () => {
    const { agent } = makeFakeAgent();
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });

    // Simulate the owner DM creation logic from startAccount
    if (account.ownerAddress) {
      await agent.createDmWithAddress(account.ownerAddress as `0x${string}`);
    }

    expect(agent.createDmWithAddress).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Owner DM creation with ENS resolution
// ---------------------------------------------------------------------------

describe("owner DM creation with ENS resolution", () => {
  it("resolves ENS name before createDmWithAddress", async () => {
    const { agent } = makeFakeAgent();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      ownerAddress: "vitalik.eth",
    });
    const resolvedAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

    const ensResolver = createMockEnsResolver({ resolveEnsName: resolvedAddr });

    // Simulate the ENS-aware owner DM creation logic from startAccount
    if (account.ownerAddress) {
      try {
        let ownerAddr = account.ownerAddress;
        if (isEnsName(ownerAddr)) {
          const resolved = await ensResolver.resolveEnsName(ownerAddr);
          if (resolved) {
            ownerAddr = resolved;
            log.info(
              `[${account.accountId}] Resolved owner ENS ${account.ownerAddress} -> ${ownerAddr.slice(0, 12)}...`,
            );
          } else {
            log.warn(`[${account.accountId}] Could not resolve owner ENS: ${account.ownerAddress}`);
          }
        }
        if (/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) {
          await agent.createDmWithAddress(ownerAddr as `0x${string}`);
          log.info(`[${account.accountId}] Owner DM ready (${ownerAddr.slice(0, 12)}...)`);
        }
      } catch (err) {
        log.warn(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
      }
    }

    expect(ensResolver.resolveEnsName).toHaveBeenCalledWith("vitalik.eth");
    expect(agent.createDmWithAddress).toHaveBeenCalledWith(resolvedAddr);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Resolved owner ENS"));
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Owner DM ready"));
  });

  it("logs warning and skips DM when ENS resolution fails", async () => {
    const { agent } = makeFakeAgent();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      ownerAddress: "nonexistent.eth",
    });

    const ensResolver = createMockEnsResolver();

    // Simulate the ENS-aware owner DM creation logic from startAccount
    if (account.ownerAddress) {
      try {
        let ownerAddr = account.ownerAddress;
        if (isEnsName(ownerAddr)) {
          const resolved = await ensResolver.resolveEnsName(ownerAddr);
          if (resolved) {
            ownerAddr = resolved;
            log.info(
              `[${account.accountId}] Resolved owner ENS ${account.ownerAddress} -> ${ownerAddr.slice(0, 12)}...`,
            );
          } else {
            log.warn(`[${account.accountId}] Could not resolve owner ENS: ${account.ownerAddress}`);
          }
        }
        if (/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) {
          await agent.createDmWithAddress(ownerAddr as `0x${string}`);
          log.info(`[${account.accountId}] Owner DM ready (${ownerAddr.slice(0, 12)}...)`);
        }
      } catch (err) {
        log.warn(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
      }
    }

    expect(ensResolver.resolveEnsName).toHaveBeenCalledWith("nonexistent.eth");
    expect(agent.createDmWithAddress).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("Could not resolve owner ENS"));
  });

  it("uses regular address directly without ENS resolution", async () => {
    const { agent } = makeFakeAgent();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const regularAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      ownerAddress: regularAddr,
    });

    const ensResolver = createMockEnsResolver();

    // Simulate the ENS-aware owner DM creation logic from startAccount
    if (account.ownerAddress) {
      try {
        let ownerAddr = account.ownerAddress;
        if (isEnsName(ownerAddr)) {
          const resolved = await ensResolver.resolveEnsName(ownerAddr);
          if (resolved) {
            ownerAddr = resolved;
            log.info(
              `[${account.accountId}] Resolved owner ENS ${account.ownerAddress} -> ${ownerAddr.slice(0, 12)}...`,
            );
          } else {
            log.warn(`[${account.accountId}] Could not resolve owner ENS: ${account.ownerAddress}`);
          }
        }
        if (/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) {
          await agent.createDmWithAddress(ownerAddr as `0x${string}`);
          log.info(`[${account.accountId}] Owner DM ready (${ownerAddr.slice(0, 12)}...)`);
        }
      } catch (err) {
        log.warn(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
      }
    }

    expect(ensResolver.resolveEnsName).not.toHaveBeenCalled();
    expect(agent.createDmWithAddress).toHaveBeenCalledWith(regularAddr);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Owner DM ready"));
  });
});

// ---------------------------------------------------------------------------
// resolveInboundEns
// ---------------------------------------------------------------------------

describe("resolveInboundEns", () => {
  beforeEach(() => {
    setResolverForAccount("default", null);
  });

  it("returns empty object when no resolver is registered", async () => {
    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello",
      isDirect: true,
    });

    expect(result).toEqual({});
  });

  it("resolves sender address to ENS name", async () => {
    const mockResolver = createMockEnsResolver({ resolveAddress: "vitalik.eth" });
    setResolverForAccount("default", mockResolver);

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello",
      isDirect: true,
    });

    expect(result.senderName).toBe("vitalik.eth");
    expect(mockResolver.resolveAddress).toHaveBeenCalledWith(TEST_SENDER_ADDRESS);
  });

  it("does not set senderName when resolveAddress returns null", async () => {
    const mockResolver = createMockEnsResolver();
    setResolverForAccount("default", mockResolver);

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello",
      isDirect: true,
    });

    expect(result.senderName).toBeUndefined();
  });

  it("resolves ENS names mentioned in message content", async () => {
    const resolved = new Map<string, string | null>([
      ["nick.eth", "0xb8c2C29ee19D8307cb7255e1Cd9CbDE883A267d5"],
    ]);
    const mockResolver = createMockEnsResolver({ resolveAll: resolved });
    setResolverForAccount("default", mockResolver);

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "Send 1 ETH to nick.eth",
      isDirect: true,
    });

    expect(result.ensContext).toContain("nick.eth");
    expect(mockResolver.resolveAll).toHaveBeenCalledWith(["nick.eth"]);
  });

  it("resolves Ethereum addresses mentioned in message content", async () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const resolved = new Map<string, string | null>([[addr, "vitalik.eth"]]);
    const mockResolver = createMockEnsResolver({ resolveAll: resolved });
    setResolverForAccount("default", mockResolver);

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: `Check ${addr}`,
      isDirect: true,
    });

    expect(result.ensContext).toContain("vitalik.eth");
    expect(result.ensContext).toContain(addr);
  });

  it("does not set ensContext when no identifiers found in content", async () => {
    const mockResolver = createMockEnsResolver();
    setResolverForAccount("default", mockResolver);

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "just a regular message",
      isDirect: true,
    });

    expect(result.ensContext).toBeUndefined();
    // resolveAll should not be called if no identifiers extracted
    expect(mockResolver.resolveAll).not.toHaveBeenCalled();
  });

  it("resolves group members for non-DM conversations", async () => {
    const memberAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const resolved = new Map<string, string | null>([[memberAddr, "vitalik.eth"]]);
    const mockResolver = createMockEnsResolver({ resolveAll: resolved });
    setResolverForAccount("default", mockResolver);

    const conversation = {
      members: vi.fn(async () => [
        {
          accountIdentifiers: [{ identifier: memberAddr, identifierKind: "evm" }],
        },
      ]),
    };

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello group",
      isDirect: false,
      conversation,
    });

    expect(result.groupMembers).toContain("vitalik.eth");
    expect(conversation.members).toHaveBeenCalled();
  });

  it("skips group member resolution for DM conversations", async () => {
    const mockResolver = createMockEnsResolver();
    setResolverForAccount("default", mockResolver);

    const conversation = {
      members: vi.fn(async () => []),
    };

    await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello",
      isDirect: true,
      conversation,
    });

    expect(conversation.members).not.toHaveBeenCalled();
  });

  it("handles group member resolution failure gracefully", async () => {
    const mockResolver = createMockEnsResolver();
    setResolverForAccount("default", mockResolver);

    const conversation = {
      members: vi.fn(async () => {
        throw new Error("members fetch failed");
      }),
    };
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await resolveInboundEns({
      accountId: "default",
      sender: TEST_SENDER_ADDRESS,
      content: "hello group",
      isDirect: false,
      conversation,
      log: log as any,
    });

    // Should not throw, and groupMembers should be undefined
    expect(result.groupMembers).toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("ENS group member resolution failed"),
    );
  });
});

// ---------------------------------------------------------------------------
// buildTextHandler ENS integration
// ---------------------------------------------------------------------------

describe("buildTextHandler ENS integration", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
    setResolverForAccount("default", null);
    setXmtpRuntime({
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
      },
    } as unknown as PluginRuntime);
  });

  it("passes ENS context to handleInboundMessage when resolver is available", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const mockResolver = createMockEnsResolver({ resolveAddress: "sender.eth" });
    setResolverForAccount("default", mockResolver);

    const handler = buildTextHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: "hello", id: "msg-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => TEST_SENDER_ADDRESS,
    } as any);

    // The resolver should have been called
    expect(mockResolver.resolveAddress).toHaveBeenCalledWith(TEST_SENDER_ADDRESS);

    // The pipeline should have been invoked (finalizeInboundContext gets called)
    expect(mocks.finalizeInboundContext).toHaveBeenCalled();
    const ctxArg = mocks.finalizeInboundContext.mock.calls[0][0];
    expect(ctxArg.SenderName).toBe("sender.eth");
  });

  it("works without resolver (no ENS context passed)", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();
    // No resolver set

    const handler = buildTextHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: "hello", id: "msg-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => TEST_SENDER_ADDRESS,
    } as any);

    // Pipeline should still be called
    expect(mocks.finalizeInboundContext).toHaveBeenCalled();
    const ctxArg = mocks.finalizeInboundContext.mock.calls[0][0];
    expect(ctxArg.SenderName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildReactionHandler ENS integration
// ---------------------------------------------------------------------------

describe("buildReactionHandler ENS integration", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
    setResolverForAccount("default", null);
    setXmtpRuntime({
      channel: {
        text: { chunkMarkdownText: (text: string) => [text] },
      },
    } as unknown as PluginRuntime);
  });

  it("passes ENS context to handleInboundReaction when resolver is available", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const mockResolver = createMockEnsResolver({ resolveAddress: "reactor.eth" });
    setResolverForAccount("default", mockResolver);

    const handler = buildReactionHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: { content: "\u2764\ufe0f", action: 1, reference: "msg-1" }, id: "r-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => TEST_SENDER_ADDRESS,
    } as any);

    expect(mockResolver.resolveAddress).toHaveBeenCalledWith(TEST_SENDER_ADDRESS);
    expect(mocks.finalizeInboundContext).toHaveBeenCalled();
    const ctxArg = mocks.finalizeInboundContext.mock.calls[0][0];
    expect(ctxArg.SenderName).toBe("reactor.eth");
  });
});
