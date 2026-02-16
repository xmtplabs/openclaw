/**
 * XMTP inbound message pipeline.
 * Orchestrates routing, envelope formatting, session recording, and reply dispatch.
 * Decoupled from access control and XMTP-specific delivery.
 */

import type { PluginRuntime, ReplyPayload, RuntimeLogger } from "openclaw/plugin-sdk";
import type { ResolvedXmtpAccount } from "./accounts.js";

const CHANNEL_ID = "xmtp";

export async function runInboundPipeline(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  content: string;
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  deliverReply: (payload: ReplyPayload) => Promise<void>;
  onDeliveryError?: (err: unknown, info: { kind: string }) => void;
}): Promise<void> {
  const {
    account,
    sender,
    conversationId,
    content,
    messageId,
    isDirect,
    runtime,
    log,
    deliverReply,
    onDeliveryError,
  } = params;

  const cfg = runtime.config.loadConfig();

  const route = runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isDirect ? "direct" : "group",
      id: conversationId,
    },
  });

  const storePath = runtime.channel.session.resolveStorePath(cfg.session?.store, {
    agentId: route.agentId,
  });

  const previousTimestamp = runtime.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const body = runtime.channel.reply.formatAgentEnvelope({
    channel: "XMTP",
    from: sender.slice(0, 12),
    timestamp: Date.now(),
    previousTimestamp,
    envelope: envelopeOptions,
    body: content,
  });

  const ctxPayload = runtime.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: content,
    CommandBody: content,
    From: `xmtp:${sender}`,
    To: `xmtp:${conversationId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isDirect ? "direct" : "group",
    ConversationLabel: conversationId.slice(0, 12),
    SenderName: undefined,
    SenderId: sender,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: messageId,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `xmtp:${conversationId}`,
  });

  await runtime.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      log?.error(`[${account.accountId}] Failed updating session meta: ${String(err)}`);
    },
  });

  await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: deliverReply,
      onError:
        onDeliveryError ??
        ((err, info) => {
          const msg = String(err);
          if (msg.includes("XMTP agent not available")) {
            log?.info(
              `[${account.accountId}] XMTP ${info.kind} reply skipped (agent unavailable).`,
            );
            return;
          }
          log?.error(`[${account.accountId}] XMTP ${info.kind} reply failed: ${msg}`);
        }),
    },
  });
}
