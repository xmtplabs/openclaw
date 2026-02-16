/**
 * Unit tests for XMTP outbound adapter and message actions.
 * Uses mock agents to test outbound delivery without network.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
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

vi.mock("@xmtp/agent-sdk", () => ({
  encryptAttachment: vi.fn(
    (attachment: { filename?: string; mimeType: string; content: Uint8Array }) => ({
      payload: new Uint8Array([1, 2, 3, 4]),
      contentDigest: "abc123digest",
      secret: new Uint8Array([5, 6, 7]),
      salt: new Uint8Array([8, 9, 10]),
      nonce: new Uint8Array([11, 12, 13]),
      contentLength: 4,
      filename: attachment.filename,
    }),
  ),
  createRemoteAttachment: vi.fn((encrypted: Record<string, unknown>, fileUrl: string) => ({
    url: fileUrl,
    contentDigest: encrypted.contentDigest,
    secret: encrypted.secret,
    salt: encrypted.salt,
    nonce: encrypted.nonce,
    scheme: "https:",
    contentLength: encrypted.contentLength,
    filename: encrypted.filename,
  })),
}));

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

    it("creates DM via createDmWithAddress when conversation not found and to is an address", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();
      const ethAddress = "0xAbCdEf1234567890abcdef1234567890AbCdEf12";

      const result = await xmtpOutbound.sendText!({
        cfg,
        to: ethAddress,
        text: "Hello via DM",
        accountId: ACCOUNT_ID,
      });

      expect(agent.client.conversations.getConversationById).toHaveBeenCalledWith(ethAddress);
      expect(agent.createDmWithAddress).toHaveBeenCalledWith(ethAddress);
      expect(fakeConversation.sendText).toHaveBeenCalledWith("Hello via DM");
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

    it("creates DM via createDmWithAddress when conversation not found and to is an address", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();
      const ethAddress = "0xAbCdEf1234567890abcdef1234567890AbCdEf12";

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: ethAddress,
        mediaUrl: "https://example.com/image.png",
        accountId: ACCOUNT_ID,
      });

      expect(agent.client.conversations.getConversationById).toHaveBeenCalledWith(ethAddress);
      expect(agent.createDmWithAddress).toHaveBeenCalledWith(ethAddress);
      expect(fakeConversation.sendText).toHaveBeenCalledWith("https://example.com/image.png");
      expect(result).toEqual(expect.objectContaining({ channel: "xmtp" }));
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

  describe("sendMedia with remote attachment", () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("downloads media, encrypts, uploads to Pinata, and sends remote attachment", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);

      const cfg = makeCfg({
        channels: {
          xmtp: {
            walletKey: VALID_WALLET_KEY,
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            pinataApiKey: "test-api-key",
            pinataSecretKey: "test-secret-key",
          },
        },
      });

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("example.com")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            arrayBuffer: async () => new ArrayBuffer(8),
          } as Response;
        }
        if (urlStr.includes("pinata.cloud")) {
          return {
            ok: true,
            json: async () => ({ IpfsHash: "QmTestHash123" }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      }) as typeof fetch;

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/image.png",
        accountId: ACCOUNT_ID,
      });

      expect(fakeConversation.sendRemoteAttachment).toHaveBeenCalledTimes(1);
      expect(result.channel).toBe("xmtp");
    });

    it("sends caption text before attachment", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);

      const cfg = makeCfg({
        channels: {
          xmtp: {
            walletKey: VALID_WALLET_KEY,
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            pinataApiKey: "test-api-key",
            pinataSecretKey: "test-secret-key",
          },
        },
      });

      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.includes("example.com")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/jpeg" }),
            arrayBuffer: async () => new ArrayBuffer(4),
          } as Response;
        }
        if (urlStr.includes("pinata.cloud")) {
          return {
            ok: true,
            json: async () => ({ IpfsHash: "QmTestHash456" }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      }) as typeof fetch;

      await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/photo.jpg",
        text: "Check this out",
        accountId: ACCOUNT_ID,
      });

      // Caption sent as text first
      expect(fakeConversation.sendText).toHaveBeenCalledWith("Check this out");
      // Attachment sent
      expect(fakeConversation.sendRemoteAttachment).toHaveBeenCalledTimes(1);
    });

    it("falls back to text when Pinata credentials not configured", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg(); // No Pinata credentials

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/image.png",
        accountId: ACCOUNT_ID,
      });

      // Should fall back to sending URL as text
      expect(fakeConversation.sendText).toHaveBeenCalledWith("https://example.com/image.png");
      expect(result.channel).toBe("xmtp");
    });

    it("falls back to text when download fails", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);

      const cfg = makeCfg({
        channels: {
          xmtp: {
            walletKey: VALID_WALLET_KEY,
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            pinataApiKey: "test-api-key",
            pinataSecretKey: "test-secret-key",
          },
        },
      });

      globalThis.fetch = vi.fn(
        async () => ({ ok: false, status: 404 }) as Response,
      ) as typeof fetch;

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/missing.png",
        text: "fallback text",
        accountId: ACCOUNT_ID,
      });

      // Caption was sent first (text && mediaUrl is true)
      // Then download failed, so fallback sends text
      expect(fakeConversation.sendText).toHaveBeenCalledWith("fallback text");
    });

    it("uses custom IPFS gateway URL when configured", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);

      const cfg = makeCfg({
        channels: {
          xmtp: {
            walletKey: VALID_WALLET_KEY,
            dbEncryptionKey: "testenc",
            env: "dev",
            publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            pinataApiKey: "test-api-key",
            pinataSecretKey: "test-secret-key",
            ipfsGatewayUrl: "https://custom-gateway.example.com/ipfs/",
          },
        },
      });

      const fetchCalls: string[] = [];
      globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        fetchCalls.push(urlStr);
        if (urlStr.includes("example.com/image")) {
          return {
            ok: true,
            headers: new Headers({ "content-type": "image/png" }),
            arrayBuffer: async () => new ArrayBuffer(8),
          } as Response;
        }
        if (urlStr.includes("pinata.cloud")) {
          return {
            ok: true,
            json: async () => ({ IpfsHash: "QmCustomHash" }),
          } as Response;
        }
        throw new Error(`Unexpected fetch: ${urlStr}`);
      }) as typeof fetch;

      const result = await xmtpOutbound.sendMedia!({
        cfg,
        to: CONVERSATION_ID,
        mediaUrl: "https://example.com/image.png",
        accountId: ACCOUNT_ID,
      });

      expect(fakeConversation.sendRemoteAttachment).toHaveBeenCalledTimes(1);
      // Verify the remote attachment uses the custom gateway URL
      const remoteAttachmentArg = (
        fakeConversation.sendRemoteAttachment as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(remoteAttachmentArg.url).toContain("custom-gateway.example.com");
      expect(result.channel).toBe("xmtp");
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
    it("delivers message via conversation.sendText", async () => {
      const { agent, fakeConversation } = makeFakeAgent();
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();

      const result = await xmtpMessageActions.handleAction({
        action: "send",
        params: { to: "0xRecipient", message: "Hello!" },
        cfg,
        accountId: ACCOUNT_ID,
      });

      expect(agent.client.conversations.getConversationById).toHaveBeenCalledWith("0xRecipient");
      expect(fakeConversation.sendText).toHaveBeenCalledWith("Hello!");
      expect(result).toBeDefined();
    });

    it("creates DM when conversation not found and to is an address", async () => {
      const { agent, fakeConversation } = makeFakeAgent({ conversationId: CONVERSATION_ID });
      setClientForAccount(ACCOUNT_ID, agent as any);
      const cfg = makeCfg();
      const ethAddress = "0xAbCdEf1234567890abcdef1234567890AbCdEf12";

      const result = await xmtpMessageActions.handleAction({
        action: "send",
        params: { to: ethAddress, message: "Hello!" },
        cfg,
        accountId: ACCOUNT_ID,
      });

      expect(agent.createDmWithAddress).toHaveBeenCalledWith(ethAddress);
      expect(fakeConversation.sendText).toHaveBeenCalledWith("Hello!");
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
      expect(xmtpMessageActions.supportsButtons({} as any)).toBe(false);
    });
  });
});
