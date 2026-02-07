import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveDefaultXmtpAccountId, resolveXmtpAccount, type CoreConfig } from "./accounts.js";
import { getAgentOrThrow } from "./outbound.js";

function normalizeAddress(raw: string): string {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("xmtp:")) {
    s = s.slice(5).trim();
  }
  return s;
}

export function registerXmtpCommands(api: OpenClawPluginApi): void {
  api.registerCommand({
    name: "address",
    description: "Print your XMTP public agent address.",
    acceptsArgs: false,
    requireAuth: true,
    handler: async (ctx) => {
      const cfg = ctx.config as CoreConfig;
      const account = resolveXmtpAccount({
        cfg,
        accountId: resolveDefaultXmtpAccountId(cfg),
      });
      if (!account.configured) {
        return { text: "XMTP is not configured. Run openclaw configure and set up XMTP." };
      }
      return { text: `This is your XMTP public address: ${account.publicAddress}` };
    },
  });

  api.registerCommand({
    name: "send",
    description: "Send a message to an XMTP address. Usage: /send address message",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const cfg = ctx.config as CoreConfig;
      const account = resolveXmtpAccount({
        cfg,
        accountId: resolveDefaultXmtpAccountId(cfg),
      });
      if (!account.configured) {
        return { text: "XMTP is not configured. Run openclaw configure and set up XMTP." };
      }
      const raw = ctx.args?.trim() ?? "";
      const firstSpace = raw.indexOf(" ");
      const address =
        firstSpace >= 0 ? normalizeAddress(raw.slice(0, firstSpace)) : normalizeAddress(raw);
      const message = firstSpace >= 0 ? raw.slice(firstSpace + 1).trim() : "";
      if (!address || !message) {
        return { text: "Usage: /send address message" };
      }
      try {
        const agent = getAgentOrThrow(account.accountId);
        await agent.sendText(address, message);
        return { text: `Sent to ${address.slice(0, 10)}...` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { text: `Send failed: ${msg}` };
      }
    },
  });
}
