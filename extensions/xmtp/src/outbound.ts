import type { Agent } from "@xmtp/agent-sdk";
import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { resolveXmtpAccount, type CoreConfig } from "./accounts.js";
import { getXmtpRuntime } from "./runtime.js";

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

export const xmtpOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getXmtpRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,

  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);
    const conversation = await agent.client.conversations.getConversationById(to);
    if (!conversation) {
      throw new Error(`Conversation not found: ${to.slice(0, 12)}...`);
    }
    await conversation.sendText(text);
    return { channel: CHANNEL_ID, messageId: `xmtp-${Date.now()}` };
  },

  sendMedia: async ({ cfg, to, accountId, mediaUrl, text }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);
    const conversation = await agent.client.conversations.getConversationById(to);
    if (!conversation) {
      throw new Error(`Conversation not found: ${to.slice(0, 12)}...`);
    }
    const url = mediaUrl ?? text ?? "";
    await conversation.sendText(url);
    return { channel: CHANNEL_ID, messageId: `xmtp-${Date.now()}` };
  },
};
