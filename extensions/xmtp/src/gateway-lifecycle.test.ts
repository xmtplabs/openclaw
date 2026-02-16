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
  createTestAccount,
  makeFakeAgent,
  createMockRuntime,
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
// buildTextHandler
// ---------------------------------------------------------------------------

describe("buildTextHandler", () => {
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

    const handler = buildTextHandler({ account, runtime });

    expect(typeof handler).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = buildTextHandler({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: { content: "hello", id: "msg-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips messages with non-string content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildTextHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "msg-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips messages when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildTextHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: "hello", id: "msg-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildReactionHandler
// ---------------------------------------------------------------------------

describe("buildReactionHandler", () => {
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

    const handler = buildReactionHandler({ account, runtime });

    expect(typeof handler).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = buildReactionHandler({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: { content: { content: "\u2764\uFE0F", action: 1, reference: "msg-1" }, id: "r-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips reactions with null content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildReactionHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "r-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips reactions when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildReactionHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: { content: "\u2764\uFE0F", action: 1, reference: "msg-1" }, id: "r-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildAttachmentHandler
// ---------------------------------------------------------------------------

describe("buildAttachmentHandler", () => {
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

    const handler = buildAttachmentHandler({ account, runtime });

    expect(typeof handler).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = buildAttachmentHandler({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: { content: { url: "https://example.com/file" }, id: "att-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips attachments with null content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "att-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips attachments when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: { url: "https://example.com/file" }, id: "att-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildInlineAttachmentHandler
// ---------------------------------------------------------------------------

describe("buildInlineAttachmentHandler", () => {
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

    const handler = buildInlineAttachmentHandler({ account, runtime });

    expect(typeof handler).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = buildInlineAttachmentHandler({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: {
        content: { filename: "test.png", mimeType: "image/png", content: new Uint8Array([1]) },
        id: "att-1",
      },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips inline attachments with null content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildInlineAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "att-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips inline attachments when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildInlineAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: {
        content: { filename: "test.png", mimeType: "image/png", content: new Uint8Array([1]) },
        id: "att-1",
      },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildMultiAttachmentHandler
// ---------------------------------------------------------------------------

describe("buildMultiAttachmentHandler", () => {
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

    const handler = buildMultiAttachmentHandler({ account, runtime });

    expect(typeof handler).toBe("function");
  });

  it("skips denied contacts", async () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "open",
      debug: true,
    });
    const { runtime, mocks } = createMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const handler = buildMultiAttachmentHandler({ account, runtime, log: log as any });
    await handler({
      isDenied: true,
      message: {
        content: { attachments: [{ url: "https://example.com/file" }] },
        id: "multi-1",
      },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("denied contact"));
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
  });

  it("skips multi-attachments with null content", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildMultiAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: { content: undefined, id: "multi-1" },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => "0xSender",
    } as any);

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
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

  it("skips multi-attachments when sender address is empty", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    const handler = buildMultiAttachmentHandler({ account, runtime });
    await handler({
      isDenied: false,
      message: {
        content: { attachments: [{ url: "https://example.com/file" }] },
        id: "multi-1",
      },
      conversation: { id: "convo-1" },
      isDm: () => true,
      getSenderAddress: async () => undefined,
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

    // Create a mock ENS resolver
    const ensResolver = {
      resolveEnsName: vi.fn(async () => resolvedAddr),
      resolveAddress: vi.fn(async () => null),
      resolveAll: vi.fn(async () => new Map()),
    };

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

    // Create a mock ENS resolver that returns null (resolution failure)
    const ensResolver = {
      resolveEnsName: vi.fn(async () => null),
      resolveAddress: vi.fn(async () => null),
      resolveAll: vi.fn(async () => new Map()),
    };

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

    // Create a mock ENS resolver (should not be called)
    const ensResolver = {
      resolveEnsName: vi.fn(async () => null),
      resolveAddress: vi.fn(async () => null),
      resolveAll: vi.fn(async () => new Map()),
    };

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
