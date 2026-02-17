/**
 * Unit tests for inbound-pipeline.ts — message routing, envelope, session, dispatch.
 */

import { describe, expect, it, vi } from "vitest";
import { runInboundPipeline } from "./inbound-pipeline.js";
import {
  createTestAccount,
  createMockRuntime,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

const CONVERSATION_ID = "convo-12345";

function callPipeline(overrides?: {
  isDirect?: boolean;
  conversationId?: string;
  content?: string;
  messageId?: string;
  deliverReply?: () => Promise<void>;
  onDeliveryError?: (err: unknown, info: { kind: string }) => void;
}) {
  const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
  const { runtime, mocks } = createMockRuntime();

  const deliverReply = overrides?.deliverReply ?? vi.fn(async () => {});

  const promise = runInboundPipeline({
    account,
    sender: TEST_SENDER_ADDRESS,
    conversationId: overrides?.conversationId ?? CONVERSATION_ID,
    content: overrides?.content ?? "hello",
    messageId: overrides?.messageId ?? "msg-1",
    isDirect: overrides?.isDirect ?? true,
    runtime,
    deliverReply,
    onDeliveryError: overrides?.onDeliveryError,
  });

  return { promise, mocks, deliverReply };
}

describe("runInboundPipeline", () => {
  it("resolves agent route with correct params for DM", async () => {
    const { promise, mocks } = callPipeline({ isDirect: true });
    await promise;

    expect(mocks.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "xmtp",
        accountId: "default",
        peer: { kind: "direct", id: CONVERSATION_ID },
      }),
    );
  });

  it("resolves agent route with correct params for group", async () => {
    const { promise, mocks } = callPipeline({ isDirect: false });
    await promise;

    expect(mocks.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: { kind: "group", id: CONVERSATION_ID },
      }),
    );
  });

  it("resolves store path using route agentId", async () => {
    const { promise, mocks } = callPipeline();
    await promise;

    expect(mocks.resolveStorePath).toHaveBeenCalledWith(
      undefined, // cfg.session?.store
      { agentId: "test-agent" },
    );
  });

  it("reads previous session timestamp", async () => {
    const { promise, mocks } = callPipeline();
    await promise;

    expect(mocks.readSessionUpdatedAt).toHaveBeenCalledWith({
      storePath: "/tmp/test-store",
      sessionKey: "test-session",
    });
  });

  it("formats agent envelope with channel and sender", async () => {
    const { promise, mocks } = callPipeline({ content: "test message" });
    await promise;

    expect(mocks.formatAgentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "XMTP",
        from: TEST_SENDER_ADDRESS.slice(0, 12),
        body: "test message [message_id:msg-1]",
      }),
    );
  });

  it("finalizes inbound context with correct fields", async () => {
    const { promise, mocks } = callPipeline({
      content: "hello world",
      messageId: "msg-42",
      isDirect: true,
    });
    await promise;

    expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        RawBody: "hello world",
        CommandBody: "hello world",
        From: `xmtp:${TEST_SENDER_ADDRESS}`,
        To: `xmtp:${CONVERSATION_ID}`,
        ChatType: "direct",
        SenderId: TEST_SENDER_ADDRESS,
        Provider: "xmtp",
        Surface: "xmtp",
        MessageSid: "msg-42",
        OriginatingChannel: "xmtp",
      }),
    );
  });

  it("sets ChatType to group for non-direct messages", async () => {
    const { promise, mocks } = callPipeline({ isDirect: false });
    await promise;

    expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({ ChatType: "group" }),
    );
  });

  it("records inbound session", async () => {
    const { promise, mocks } = callPipeline();
    await promise;

    expect(mocks.recordInboundSession).toHaveBeenCalledTimes(1);
    expect(mocks.recordInboundSession).toHaveBeenCalledWith(
      expect.objectContaining({
        storePath: "/tmp/test-store",
        sessionKey: "test-session",
      }),
    );
  });

  it("dispatches reply with buffered block dispatcher", async () => {
    const { promise, mocks } = callPipeline();
    await promise;

    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchReplyWithBufferedBlockDispatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        ctx: expect.any(Object),
        cfg: expect.any(Object),
        dispatcherOptions: expect.objectContaining({
          deliver: expect.any(Function),
        }),
      }),
    );
  });

  it("passes custom deliverReply callback to dispatcher", async () => {
    const deliverReply = vi.fn(async () => {});
    const { promise, mocks } = callPipeline({ deliverReply });
    await promise;

    // The dispatcher should receive our deliverReply
    const call = mocks.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0][0];
    expect(call.dispatcherOptions.deliver).toBe(deliverReply);
  });

  it("passes custom onDeliveryError to dispatcher", async () => {
    const onDeliveryError = vi.fn();
    const { promise, mocks } = callPipeline({ onDeliveryError });
    await promise;

    const call = mocks.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0][0];
    expect(call.dispatcherOptions.onError).toBe(onDeliveryError);
  });

  it("uses default error handler when onDeliveryError not provided", async () => {
    const { promise, mocks } = callPipeline();
    await promise;

    const call = mocks.dispatchReplyWithBufferedBlockDispatcher.mock.calls[0][0];
    expect(call.dispatcherOptions.onError).toBeDefined();
    expect(typeof call.dispatcherOptions.onError).toBe("function");
  });
});

describe("message ID tagging", () => {
  it("tags body with [message_id:...] when messageId is provided", async () => {
    const { promise, mocks } = callPipeline({ content: "hello", messageId: "msg-42" });
    await promise;

    expect(mocks.formatAgentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello [message_id:msg-42]",
      }),
    );
  });

  it("does not tag body when messageId is undefined", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    await runInboundPipeline({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: CONVERSATION_ID,
      content: "hello",
      messageId: undefined,
      isDirect: true,
      runtime,
      deliverReply: vi.fn(async () => {}),
    });

    expect(mocks.formatAgentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello",
      }),
    );
  });
});

describe("ENS enrichment", () => {
  it("uses senderName in envelope from field when provided", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    await runInboundPipeline({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-1",
      content: "hello",
      messageId: "msg-1",
      isDirect: true,
      runtime,
      senderName: "nick.eth",
      deliverReply: vi.fn(),
    });

    expect(mocks.formatAgentEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ from: "nick.eth" }),
    );
  });

  it("prepends ENS context to Body when provided", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    await runInboundPipeline({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-1",
      content: "hello",
      messageId: "msg-1",
      isDirect: true,
      runtime,
      ensContext: "[ENS Context: nick.eth = 0x1234]",
      deliverReply: vi.fn(),
    });

    // finalizeInboundContext receives Body with ensContext prepended
    expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        Body: expect.stringContaining("[ENS Context: nick.eth = 0x1234]"),
      }),
    );
  });

  it("passes SenderName and GroupMembers to context", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    await runInboundPipeline({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-1",
      content: "hello",
      messageId: "msg-1",
      isDirect: false,
      runtime,
      senderName: "nick.eth",
      groupMembers: "nick.eth (0xd8da…6045), 0x1234…5678",
      deliverReply: vi.fn(),
    });

    expect(mocks.finalizeInboundContext).toHaveBeenCalledWith(
      expect.objectContaining({
        SenderName: "nick.eth",
        GroupMembers: "nick.eth (0xd8da…6045), 0x1234…5678",
      }),
    );
  });

  it("does not prepend ENS context when not provided", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
    const { runtime, mocks } = createMockRuntime();

    await runInboundPipeline({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-1",
      content: "hello",
      messageId: "msg-1",
      isDirect: true,
      runtime,
      deliverReply: vi.fn(),
    });

    // Body should NOT contain [ENS Context
    const bodyArg = mocks.finalizeInboundContext.mock.calls[0][0].Body;
    expect(bodyArg).not.toContain("[ENS Context");
  });
});
