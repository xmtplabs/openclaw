/**
 * Unit tests for XMTP DM policy enforcement in handleInboundMessage.
 * Uses mock PluginRuntime with real ResolvedXmtpAccount structs.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setClientForAccount } from "./outbound.js";
import {
  createTestAccount,
  createMockRuntime,
  makeFakeAgent,
  callInbound,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

describe("XMTP DM policy enforcement", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
  });

  describe("dmPolicy: open", () => {
    it("allows any sender", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "open",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });
  });

  describe("dmPolicy: disabled", () => {
    it("blocks all DMs", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "disabled",
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    });
  });

  describe("dmPolicy: allowlist", () => {
    it("allows listed address", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [TEST_SENDER_ADDRESS],
      });
      const { runtime, mocks } = createMockRuntime({
        allowFrom: [TEST_SENDER_ADDRESS],
      });

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });

    it("blocks unlisted address", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["0xOtherAddress"],
      });
      const { runtime, mocks } = createMockRuntime({
        allowFrom: ["0xOtherAddress"],
      });

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
    });

    it("allows sender found in store allowFrom", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [],
      });
      const { runtime, mocks } = createMockRuntime({
        storeAllowFrom: [TEST_SENDER_ADDRESS],
      });

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });

    it("allows wildcard '*' in config allowFrom", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["*"],
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });
  });

  describe("dmPolicy: pairing", () => {
    it("sends pairing code to unknown sender", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = createMockRuntime();

      const { agent, sentMessages } = makeFakeAgent();
      setClientForAccount("default", agent as any);

      await callInbound({ account, runtime });

      // Message should be dropped
      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
      // Pairing request should be created
      expect(mocks.upsertPairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "xmtp",
          id: TEST_SENDER_ADDRESS,
        }),
      );
      // Reply should be sent back
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toContain("TESTCODE");
    });

    it("allows paired sender (in store)", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = createMockRuntime({
        storeAllowFrom: [TEST_SENDER_ADDRESS],
      });

      await callInbound({ account, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
      expect(mocks.upsertPairingRequest).not.toHaveBeenCalled();
    });

    it("does not send pairing reply on duplicate (created=false)", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = createMockRuntime();
      mocks.upsertPairingRequest.mockResolvedValueOnce({ code: "TESTCODE", created: false });

      const { agent, sentMessages } = makeFakeAgent();
      setClientForAccount("default", agent as any);

      await callInbound({ account, runtime });

      // Message should still be dropped
      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).not.toHaveBeenCalled();
      // But no reply sent (not first request)
      expect(sentMessages.length).toBe(0);
    });
  });

  describe("address normalization", () => {
    it("matches addresses case-insensitively", async () => {
      const lowerSender = TEST_SENDER_ADDRESS.toLowerCase();
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [TEST_SENDER_ADDRESS.toUpperCase()],
      });
      const { runtime, mocks } = createMockRuntime();

      await callInbound({ account, sender: lowerSender, runtime });

      expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    });
  });
});
