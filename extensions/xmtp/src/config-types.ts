/**
 * XMTP channel configuration types.
 * Self-contained for the extension to avoid cross-package imports.
 */

export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";
export type GroupPolicy = "open" | "disabled" | "allowlist";

export type XMTPAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this XMTP account. Default: true. */
  enabled?: boolean;
  /** Wallet private key (hex or env var name). Required for agent identity. */
  walletKey?: string;
  /** DB encryption key for local XMTP storage. Required. */
  dbEncryptionKey?: string;
  /** XMTP environment: production (default) or dev. */
  env?: "production" | "dev";
  /** Enable debug logging for this account. */
  debug?: boolean;
  /** Sender access policy (default: pairing). Controls who can message the agent. */
  dmPolicy?: DmPolicy;
  /** Allowlist of addresses permitted to message the agent. */
  allowFrom?: Array<string | number>;
  /** Controls how group messages are handled (default: open). */
  groupPolicy?: GroupPolicy;
  /** Allowlist of conversation IDs the agent listens in (groupPolicy "allowlist"). Include "*" to allow all. */
  groups?: string[];
  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit?: number;
  /** Ethereum address for display; derived from walletKey if not set. */
  publicAddress?: string;
  /** Pinata API key for IPFS upload of media attachments. */
  pinataApiKey?: string;
  /** Pinata secret key for IPFS upload of media attachments. */
  pinataSecretKey?: string;
  /** Custom IPFS gateway URL (default: https://gateway.pinata.cloud/ipfs/). */
  ipfsGatewayUrl?: string;
  /** Ethereum address of the owner. Auto-allowed for DMs; a conversation is created on startup. */
  ownerAddress?: string;
  /** web3.bio API key for ENS resolution (optional, improves rate limits). */
  web3BioApiKey?: string;
};

export type XMTPConfig = {
  /** Per-account XMTP configuration (multi-account). */
  accounts?: Record<string, XMTPAccountConfig>;
} & XMTPAccountConfig;
