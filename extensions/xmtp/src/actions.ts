import type { ChannelMessageActionAdapter, ChannelMessageActionName } from "openclaw/plugin-sdk";
import { jsonResult, readReactionParams, readStringParam } from "openclaw/plugin-sdk";
import { listXmtpAccountIds, resolveXmtpAccount, type CoreConfig } from "./accounts.js";
import { getAgentOrThrow } from "./outbound.js";

export const xmtpMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) =>
    listXmtpAccountIds(cfg as CoreConfig).length > 0
      ? (["send", "react"] as ChannelMessageActionName[])
      : [],

  supportsButtons: (_params) => false,

  handleAction: async ({ action, params, cfg, accountId }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);

    if (action === "send") {
      const to = readStringParam(params, "to", { required: true });
      const message = readStringParam(params, "message", { required: true, allowEmpty: true });
      let conversation = await agent.client.conversations.getConversationById(to);
      if (!conversation && to.startsWith("0x")) {
        conversation = await agent.createDmWithAddress(to as `0x${string}`);
      }
      if (!conversation) {
        throw new Error(`Conversation not found: ${to.slice(0, 12)}...`);
      }
      const messageId = await conversation.sendText(message ?? "");
      return jsonResult({ ok: true, to, messageId });
    }

    if (action === "react") {
      const to = readStringParam(params, "to", { required: true });
      const messageId = readStringParam(params, "messageId", { required: true });
      const { emoji, remove } = readReactionParams(params, {
        removeErrorMessage: "Emoji is required to remove an XMTP reaction.",
      });

      const conversation = await agent.client.conversations.getConversationById(to);
      if (!conversation) {
        throw new Error(`Conversation not found: ${to.slice(0, 12)}...`);
      }

      await conversation.sendReaction({
        reference: messageId,
        referenceInboxId: "",
        action: remove ? 2 : 1,
        content: emoji,
        schema: 1,
      });

      return jsonResult(remove ? { ok: true, removed: emoji } : { ok: true, added: emoji });
    }

    throw new Error(`Action "${action}" is not supported for XMTP.`);
  },
};
