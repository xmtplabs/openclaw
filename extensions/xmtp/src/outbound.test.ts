/**
 * Unit tests for XMTP outbound adapter and message actions.
 * Uses mock agents to test outbound delivery without network.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CoreConfig } from "./accounts.js";
import { xmtpMessageActions } from "./actions.js";
import {
  xmtpOutbound,
  setClientForAccount,
  getClientForAccount,
  getAgentOrThrow,
} from "./outbound.js";
import { getXmtpRuntime, setXmtpRuntime } from "./runtime.js";
import { makeFakeAgent } from "./test-utils/unit-helpers.js";

const ACCOUNT_ID = "default";
const CONVERSATION_ID = "convo-12345";
const VALID_WALLET_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function makeCfg(overrides?: Partial<CoreConfig>): CoreConfig {
  return {
    channels: {
      xmtp: {
        walletKey: VALID_WALLET_KEY,
        dbEncryptionKey: "testenc",
        env: "dev",
        publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        ...overrides?.channels?.xmtp,
      },
    },
    ...overrides,
  };
}

describe("XMTP outbound adapter", () => {
  beforeEach(() => {
    setClientForAccount(ACCOUNT_ID, null);
    // Set up a mock runtime for outbound calls
    setXmtpRuntime({
      channel: {
        text: {
          chunkMarkdownText: (text: string) => [text],
        },
      },
    } as unknown as PluginRuntime);
  });

  describe("setClientForAccount / getClientForAccount", () => {
    it("stores and retrieves agent", () => {
      const { agent } = makeFakeAgent();
      setClientForAccount("bot1", agent as any);

      expect(getClientForAccount("bot1")).toBe(agent);
    });

    it("removes agent when set to null", () => {
      const { agent } = makeFakeAgent();
      setClientForAccount("bot1", agent as any);
      setClientForAccount("bot1", null);

      expect(getClientForAccount("bot1")).toBeUndefined();
    });
  });

  describe("getAgentOrThrow", () => {
    it("returns agent when available", () => {
      const { agent } = makeFakeAgent();
      setClientForAccount(ACCOUNT_ID, agent as any);

      expect(getAgentOrThrow(ACCOUNT_ID)).toBe(agent);
    });

    it("throws when agent not available", () => {
      expect(() => getAgentOrThrow(ACCOUNT_ID)).toThrow("XMTP agent not running");
    });
  });

  describe("sendText", () => {
    it("delivers text to existing conversation", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      const result = await xmtpOutbound.sendText!({
        cfg,
        to: CONVERSATION_ID,
        text: "Hello from outbound",
        accountId: ACCOUNT_ID,
      });

      expect(agent.client.conversations.getConversationById).toHaveBeenCalledWith(CONVERSATION_ID);
      expect(fakeConversation.sendText).toHaveBeenCalledWith("Hello from outbound");
      expect(result).toEqual(
        expect.objectContaining({
          channel: "xmtp",
          messageId: "msg-id",
        }),
      );
    });

    it("throws for unknown conversation", async () => {
      const { agent } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      await expect(
        xmtpOutbound.sendText!({
          cfg,
          to: "unknown-convo",
          text: "hello",
          accountId: ACCOUNT_ID,
        }),
      ).rejects.toThrow("Conversation not found");
    });

    it("throws when agent not running", async () => {
      const cfg = makeCfg();

      await expect(
        xmtpOutbound.sendText!({
          cfg,
          to: CONVERSATION_ID,
          text: "hello",
          accountId: ACCOUNT_ID,
        }),
      ).rejects.toThrow("XMTP agent not running");
    });
  });

  describe("sendMedia", () => {
    it("sends mediaUrl as text", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/image.png",
        accountId: ACCOUNT_ID,
      });

      expect(fakeConversation.sendText).toHaveBeenCalledWith("https://example.com/image.png");
      expect(result).toEqual(expect.objectContaining({ channel: "xmtp" }));
    });

    it("falls back to text when no mediaUrl", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        text: "fallback text",
        accountId: ACCOUNT_ID,
      });

      expect(fakeConversation.sendText).toHaveBeenCalledWith("fallback text");
    });

    it("sends empty string when no mediaUrl or text", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        accountId: ACCOUNT_ID,
      });

      expect(fakeConversation.sendText).toHaveBeenCalledWith("");
    });
  });
});

describe("XMTP message actions", () => {
  beforeEach(() => {
    setClientForAccount(ACCOUNT_ID, null);
  });

  describe("listActions", () => {
    it("returns send action when accounts exist", () => {
      const cfg = makeCfg();
      const actions = xmtpMessageActions.listActions({ cfg });

      expect(actions).toContain("send");
    });
  });

  describe("handleAction: send", () => {
    it("delivers message via agent.sendText", async () => {
      const { agent, sentToAddress } = makeFakeAgent();
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      const result = await xmtpMessageActions.handleAction({
        action: "send",
        params: { to: "0xRecipient", message: "Hello!" },
        cfg,
        accountId: ACCOUNT_ID,
      });

      expect(agent.sendText).toHaveBeenCalledWith("0xRecipient", "Hello!");
      expect(result).toBeDefined();
    });

    it("throws for unsupported action", async () => {
      const { agent } = makeFakeAgent();
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      await expect(
        xmtpMessageActions.handleAction({
          action: "unsupported" as any,
          params: {},
          cfg,
          accountId: ACCOUNT_ID,
        }),
      ).rejects.toThrow('Action "unsupported" is not supported');
    });
  });

  describe("supportsButtons", () => {
    it("returns false", () => {
      expect(xmtpMessageActions.supportsButtons()).toBe(false);
    });
  });
});
