/**
 * Types for XMTP agent runtime and message handling.
 * Agent from @xmtp/agent-sdk also has sendText(to, text) for sending to an address.
 */

export interface XmtpConversation {
  sendText(text: string, isOptimistic?: boolean): Promise<string>;
}

export interface XmtpClientConversations {
  getConversationById(id: string): Promise<XmtpConversation | undefined>;
}

export interface XmtpAgentRuntime {
  readonly client: { conversations: XmtpClientConversations };
  sendText(to: string, text: string): Promise<void | string>;
  on(
    event: "text",
    handler: (ctx: {
      message: { content: string; id?: string };
      conversation?: { id?: string };
      getSenderAddress(): Promise<string>;
    }) => void | Promise<void>,
  ): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
