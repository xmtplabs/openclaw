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
    it.each([
      ["open allows any group", "open", undefined, "any-group", true],
      ["disabled blocks all groups", "disabled", undefined, "any-group", false],
      ["allowlist allows listed group", "allowlist", ["group-123"], "group-123", true],
      ["allowlist blocks unlisted group", "allowlist", ["group-123"], "group-456", false],
      ["allowlist wildcard allows all", "allowlist", ["*"], "any-group", true],
    ] as const)("%s", (_desc, groupPolicy, groups, conversationId, expected) => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        groupPolicy: groupPolicy as any,
        groups: groups as any,
      });
      expect(isGroupAllowed({ account, conversationId })).toBe(expected);
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

    it.each([
      ["Ethereum address", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", true],
      ["simple ENS name", "nick.eth", true],
      ["subdomain ENS name", "pay.nick.eth", true],
      ["well-known ENS name", "vitalik.eth", true],
      ["empty string", "", false],
      ["whitespace only", "  ", false],
      ["plain word", "hello", false],
      ["hyphenated string", "not-an-address", false],
    ] as const)("%s → %s", (_desc, input, expected) => {
      expect(looksLikeId(input)).toBe(expected);
    });

    it.each([
      [
        "32-char conversation ID via normalized",
        "xmtp:8f83e95ea30dda840dce97bd9b8b21e4",
        "8f83e95ea30dda840dce97bd9b8b21e4",
        true,
      ],
      [
        "64-char conversation topic via normalized",
        "xmtp:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        true,
      ],
      ["short hex (15 chars) rejected", "xmtp:abcdef012345678", "abcdef012345678", false],
      [
        "non-hex chars in normalized rejected",
        "xmtp:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        false,
      ],
    ] as const)("conversation ID: %s", (_desc, raw, normalized, expected) => {
      expect(looksLikeId(raw, normalized)).toBe(expected);
    });

    it("recognizes bare hex conversation ID without normalized param", () => {
      expect(looksLikeId("8f83e95ea30dda840dce97bd9b8b21e4")).toBe(true);
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
