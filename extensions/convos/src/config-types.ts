/**
 * Convos channel configuration types
 * These mirror the types in src/config/types.convos.ts but are self-contained
 * for the extension to avoid cross-package imports.
 */

export type ConvosReactionLevel = "off" | "ack" | "minimal" | "extensive";
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type GroupPolicy = "open" | "disabled" | "allowlist";

export type ConvosAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this Convos account. Default: true. */
  enabled?: boolean;
  /** Hex-encoded XMTP private key (auto-generated on first run). */
  privateKey?: string;
  /** XMTP environment: production (default) or dev. */
  env?: "production" | "dev";
  /** Enable debug logging for this account. */
  debug?: boolean;
  /** Direct message access policy (default: pairing). */
  dmPolicy?: DmPolicy;
  /** Allowlist for direct message senders. */
  allowFrom?: Array<string | number>;
  /** Optional allowlist for group senders. */
  groupAllowFrom?: Array<string | number>;
  /** Controls how group messages are handled. */
  groupPolicy?: GroupPolicy;
  /** Max group messages to keep as history context (0 disables). */
  historyLimit?: number;
  /** Max DM turns to keep as history context. */
  dmHistoryLimit?: number;
  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number;
  /** Chunking mode: "length" (default) splits by size; "newline" splits on every newline. */
  chunkMode?: "length" | "newline";
  /** Action toggles for message tool capabilities. */
  actions?: {
    /** Enable/disable sending reactions via message tool (default: true). */
    reactions?: boolean;
  };
  /** Controls agent reaction behavior. */
  reactionLevel?: ConvosReactionLevel;
  /** The conversation ID where OpenClaw communicates with its owner. */
  ownerConversationId?: string;
};

export type ConvosConfig = {
  /** Optional per-account Convos configuration (multi-account). */
  accounts?: Record<string, ConvosAccountConfig>;
} & ConvosAccountConfig;
