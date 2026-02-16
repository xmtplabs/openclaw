import type { Agent } from "@xmtp/agent-sdk";
import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { createRemoteAttachment, encryptAttachment } from "@xmtp/agent-sdk";
import { fetchWithSsrFGuard } from "openclaw/plugin-sdk";
import { resolveXmtpAccount, type CoreConfig } from "./accounts.js";
import { getResolverForAccount, isEnsName } from "./lib/ens-resolver.js";
import { getOrCreateConversation } from "./lib/xmtp-client.js";
import { getXmtpRuntime } from "./runtime.js";

const MAX_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

const CHANNEL_ID = "xmtp";
const agents = new Map<string, Agent>();

/**
 * Set the agent runtime for an account (called from channel.ts during startAccount)
 */
export function setClientForAccount(accountId: string, agent: Agent | null): void {
  if (agent) {
    agents.set(accountId, agent);
  } else {
    agents.delete(accountId);
  }
}

/**
 * Get the agent runtime for an account
 */
export function getClientForAccount(accountId: string): Agent | undefined {
  return agents.get(accountId);
}

/**
 * Get the agent runtime for an account or throw
 */
export function getAgentOrThrow(accountId: string): Agent {
  const agent = agents.get(accountId);
  if (!agent) {
    throw new Error(`XMTP agent not running for account ${accountId}. Is the gateway started?`);
  }
  return agent;
}

/** Resolve an ENS name to an address if applicable. */
async function resolveOutboundTarget(to: string, accountId: string): Promise<string> {
  if (!isEnsName(to)) return to;
  const resolver = getResolverForAccount(accountId);
  if (!resolver) return to;
  const resolved = await resolver.resolveEnsName(to);
  return resolved ?? to;
}

/** Extract filename from a URL path. */
function filenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/");
    return segments[segments.length - 1] || "attachment";
  } catch {
    return "attachment";
  }
}

/** Upload encrypted bytes to Pinata IPFS. Returns the IPFS gateway URL. */
async function uploadToPinata(
  data: Uint8Array,
  filename: string,
  apiKey: string,
  secretKey: string,
  gatewayUrl = "https://gateway.pinata.cloud/ipfs/",
): Promise<string> {
  const formData = new FormData();
  formData.append("file", new Blob([data as BlobPart]), filename);
  const response = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      pinata_api_key: apiKey,
      pinata_secret_api_key: secretKey,
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Pinata upload failed: ${response.status} ${response.statusText}`);
  }
  const result = (await response.json()) as { IpfsHash: string };
  return `${gatewayUrl.replace(/\/+$/, "")}/${result.IpfsHash}`;
}

/** Download media from URL with SSRF guard and size limit. */
async function downloadMedia(
  url: string,
): Promise<{ content: Uint8Array; mimeType: string; filename: string } | null> {
  let release: (() => Promise<void>) | undefined;
  try {
    const result = await fetchWithSsrFGuard({
      url,
      timeoutMs: 30_000,
      auditContext: "xmtp-media-download",
    });
    release = result.release;
    const { response } = result;
    if (!response.ok) {
      await release();
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_MEDIA_BYTES) {
      await release();
      return null;
    }

    const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim();
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_MEDIA_BYTES) {
      await release();
      return null;
    }

    await release();
    return {
      content: new Uint8Array(buffer),
      mimeType,
      filename: filenameFromUrl(url),
    };
  } catch {
    await release?.();
    return null;
  }
}

export const xmtpOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getXmtpRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);
    const target = await resolveOutboundTarget(to, account.accountId);
    const conversation = await getOrCreateConversation(agent, target);
    const messageId = await conversation.sendText(text);
    return { channel: CHANNEL_ID, messageId };
  },

  sendMedia: async ({ cfg, to, accountId, mediaUrl, text }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);
    const target = await resolveOutboundTarget(to, account.accountId);
    const conversation = await getOrCreateConversation(agent, target);

    // Send caption text first if provided alongside media
    if (text && mediaUrl) {
      await conversation.sendText(text);
    }

    // Try to download and send as native remote attachment
    if (mediaUrl && account.config.pinataApiKey && account.config.pinataSecretKey) {
      const media = await downloadMedia(mediaUrl);
      if (media) {
        const encrypted = encryptAttachment({
          filename: media.filename,
          mimeType: media.mimeType,
          content: media.content,
        });
        const fileUrl = await uploadToPinata(
          new Uint8Array(encrypted.payload),
          media.filename,
          account.config.pinataApiKey,
          account.config.pinataSecretKey,
          account.config.ipfsGatewayUrl,
        );
        const remoteAttachment = createRemoteAttachment(encrypted, fileUrl);
        const messageId = await conversation.sendRemoteAttachment(remoteAttachment);
        return { channel: CHANNEL_ID, messageId };
      }
    }

    // Fallback: send as text
    const fallback = text ?? mediaUrl ?? "";
    const messageId = await conversation.sendText(fallback);
    return { channel: CHANNEL_ID, messageId };
  },
};
