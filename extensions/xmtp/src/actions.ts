import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "openclaw/plugin-sdk";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk";
import { listXmtpAccountIds, resolveXmtpAccount, type CoreConfig } from "./accounts.js";
import { getAgentOrThrow } from "./outbound.js";

export const xmtpMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) =>
    listXmtpAccountIds(cfg as CoreConfig).length > 0
      ? (["send"] as ChannelMessageActionName[])
      : [],

  supportsButtons: () => false,

  handleAction: async ({ action, params, cfg, accountId }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);

    if (action === "send") {
      const to = readStringParam(params, "to", { required: true });
      const message = readStringParam(params, "message", { required: true, allowEmpty: true });
      await agent.sendText(to, message ?? "");
      return jsonResult({ ok: true, to, messageId: `xmtp-${Date.now()}` });
    }

    throw new Error(`Action "${action}" is not supported for XMTP.`);
  },
};
