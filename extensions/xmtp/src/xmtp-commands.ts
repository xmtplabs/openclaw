import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveDefaultXmtpAccountId, resolveXmtpAccount, type CoreConfig } from "./accounts.js";

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
}
