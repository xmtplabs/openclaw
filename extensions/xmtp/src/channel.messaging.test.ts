/**
 * Unit tests for XMTP message flow via handleInboundMessage.
 * Tests message routing, envelope formatting, chunking, group policy, and debug logging using mock runtime.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { isGroupAllowed, xmtpPlugin } from "./channel.js";
import { setClientForAccount } from "./outbound.js";
import {
  createTestAccount,
  createMockRuntime,
  callInbound,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

describe("XMTP message flow", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
  });

  describe("inbound DM message", () => {
    it("dispatches message with correct inbound context", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime, content: "hello world" });

      expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
        expect.objectContaining({
          Body: expect.any(String),
          RawBody: "hello world",
          CommandBody: "hello world",
          From: `xmtp:${TEST_SENDER_ADDRESS}`,
          To: `xmtp:${TEST_SENDER_ADDRESS}`,
          ChatType: "direct",
          SenderId: TEST_SENDER_ADDRESS,
          Provider: "xmtp",
          Surface: "xmtp",
          MessageSid: "msg-1",
        }),
      );
    });

    it("resolves agent route for DM", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "xmtp",
          accountId: "default",
          peer: {
            kind: "direct",
            id: TEST_SENDER_ADDRESS,
          },
        }),
      );
    });

    it("records session for inbound message", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.recordInboundSession).toHaveBeenCalledTimes(1);
    });

    it("dispatches reply with buffered block dispatcher", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
        expect.objectContaining({
          ctx: expect.any(Object),
          cfg: expect.any(Object),
          dispatcherOptions: expect.objectContaining({
            deliver: expect.any(Function),
            onError: expect.any(Function),
          }),
        }),
      );
    });
  });

  describe("inbound group message", () => {
    it("dispatches group message with correct context", async () => {
      const groupId = "group-convo-12345";
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
        groupPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime, conversationId: groupId, content: "hello group" });

      expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
        expect.objectContaining({
          RawBody: "hello group",
          ChatType: "group",
          To: `xmtp:${groupId}`,
          SenderId: TEST_SENDER_ADDRESS,
        }),
      );
    });

    it("resolves agent route for group", async () => {
      const groupId = "group-convo-12345";
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime, conversationId: groupId });

      expect(mocks.resolveAgentRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          peer: {
            kind: "group",
            id: groupId,
          },
        }),
      );
    });

    it("group messages bypass DM policy", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "disabled",
        groupPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({
        account,
        runtime,
        conversationId: "group-convo-id-12345",
        content: "hello group",
      });

      // Group message should go through even with dmPolicy=disabled
      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });
  });

  describe("group policy enforcement", () => {
    it("groupPolicy 'open' allows any group", () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "open",
      });

      expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
    });

    it("groupPolicy 'disabled' blocks all groups", () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "disabled",
      });

      expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(false);
    });

    it("groupPolicy 'allowlist' allows listed group", () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "allowlist",
        groups: ["group-123"],
      });

      expect(isGroupAllowed({ account, conversationId: "group-123" })).toBe(true);
    });

    it("groupPolicy 'allowlist' blocks unlisted group", () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "allowlist",
        groups: ["group-123"],
      });

      expect(isGroupAllowed({ account, conversationId: "group-456" })).toBe(false);
    });

    it("groupPolicy 'allowlist' with '*' allows all groups", () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "allowlist",
        groups: ["*"],
      });

      expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
    });

    it("drops message from disabled group conversation", async () => {
      const groupId = "group-convo-12345";
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: "disabled",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime, conversationId: groupId });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    });
  });

  describe("debug logging", () => {
    it("logs inbound message when debug enabled", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
        debug: true,
      });
      const { runtime } = createMockRuntime();
      const log = { info: vi.fn(), error: vi.fn() };

      await callInbound({ account, runtime, log });

      expect(log.info).toHaveBeenCalledWith(expect.stringContaining("Inbound from"));
    });

    it("does not log when debug disabled", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
        debug: false,
      });
      const { runtime } = createMockRuntime();
      const log = { info: vi.fn(), error: vi.fn() };

      await callInbound({ account, runtime, log });

      // Info should not include "Inbound from" (debug is off)
      const inboundCalls = log.info.mock.calls.filter(
        ([msg]: [string]) => typeof msg === "string" && msg.includes("Inbound from"),
      );
      expect(inboundCalls).toHaveLength(0);
    });
  });

  describe("ENS-aware target resolution", () => {
    const looksLikeId = xmtpPlugin.messaging!.targetResolver!.looksLikeId!;

    it("recognizes Ethereum addresses", () => {
      expect(looksLikeId("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
    });

    it("recognizes ENS names", () => {
      expect(looksLikeId("nick.eth")).toBe(true);
      expect(looksLikeId("pay.nick.eth")).toBe(true);
      expect(looksLikeId("vitalik.eth")).toBe(true);
    });

    it("rejects empty strings", () => {
      expect(looksLikeId("")).toBe(false);
      expect(looksLikeId("  ")).toBe(false);
    });

    it("rejects non-ENS non-address strings", () => {
      expect(looksLikeId("hello")).toBe(false);
      expect(looksLikeId("not-an-address")).toBe(false);
    });

    it("hint mentions ENS name", () => {
      expect(xmtpPlugin.messaging!.targetResolver!.hint).toContain("ENS");
    });
  });

  describe("ENS-aware agent prompt hints", () => {
    it("mentions ENS names in the first tool hint", () => {
      const cfg = {
        channels: {
          xmtp: {
            walletKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        },
      };
      const hints = xmtpPlugin.agentPrompt!.messageToolHints!({
        cfg,
        accountId: "default",
      });
      expect(hints[0]).toContain("ENS");
      expect(hints[0]).toContain("name.eth");
    });

    it("includes hint about using ENS names for users", () => {
      const cfg = {
        channels: {
          xmtp: {
            walletKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          },
        },
      };
      const hints = xmtpPlugin.agentPrompt!.messageToolHints!({
        cfg,
        accountId: "default",
      });
      const ensHint = hints.find((h: string) => h.includes("ENS name") && h.includes("nick.eth"));
      expect(ensHint).toBeDefined();
    });
  });
});
