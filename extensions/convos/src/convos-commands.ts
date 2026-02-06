import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  resolveConvosAccount,
  resolveDefaultConvosAccountId,
  type CoreConfig,
} from "./accounts.js";
import { getClientForAccount } from "./outbound.js";

export function registerConvosCommands(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "invite",
    description: "Create a new Convos conversation and get an invite link.",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const cfg = ctx.config as CoreConfig;
      const account = resolveConvosAccount({
        cfg,
        accountId: resolveDefaultConvosAccountId(cfg),
      });
      if (!account.configured) {
        return { text: "Convos is not configured. Run openclaw configure and set up Convos." };
      }
      const client = getClientForAccount(account.accountId);
      if (!client) {
        return { text: "Convos is not running. Start the gateway with Convos enabled." };
      }
      const result = await client.createConversation(ctx.args?.trim() || undefined);
      return { text: `Invite link:\n${result.inviteUrl}` };
    },
  });

  api.registerCommand({
    name: "join",
    description: "Join a Convos conversation via invite URL.",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const cfg = ctx.config as CoreConfig;
      const account = resolveConvosAccount({
        cfg,
        accountId: resolveDefaultConvosAccountId(cfg),
      });
      if (!account.configured) {
        return { text: "Convos is not configured. Run openclaw configure and set up Convos." };
      }
      const client = getClientForAccount(account.accountId);
      if (!client) {
        return { text: "Convos is not running. Start the gateway with Convos enabled." };
      }
      const trimmed = ctx.args?.trim();
      if (!trimmed) {
        return { text: "Usage: /join <invite-url>" };
      }
      try {
        const result = await client.joinConversation(trimmed);
        if (result.conversationId) {
          return { text: `Joined conversation ${result.conversationId.slice(0, 8)}...` };
        }
        return {
          text: "Join request sent. Waiting for approval from the conversation owner.",
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `Join failed: ${msg}` };
      }
    },
  });
}
