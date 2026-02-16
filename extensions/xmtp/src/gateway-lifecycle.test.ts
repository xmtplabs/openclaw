/**
 * Unit tests for gateway-lifecycle.ts — agent start/stop, event wiring, address backfill.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { backfillPublicAddress, buildTextHandler, stopAgent } from "./gateway-lifecycle.js";
import { setClientForAccount, getClientForAccount } from "./outbound.js";
import { setXmtpRuntime } from "./runtime.js";
import {
  createTestAccount,
  makeFakeAgent,
  createMockRuntime,
  TEST_OWNER_ADDRESS,
} from "./test-utils/unit-helpers.js";

// ---------------------------------------------------------------------------
// stopAgent
// ---------------------------------------------------------------------------

describe("stopAgent", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
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
