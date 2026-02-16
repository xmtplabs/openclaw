/**
 * XMTP channel configuration schema
 * Used for Control UI form generation
 */

import { MarkdownConfigSchema, buildChannelConfigSchema } from "openclaw/plugin-sdk";
import { z } from "zod";

const allowFromEntry = z.union([z.string(), z.number()]);

/**
 * Zod schema for channels.xmtp.* configuration
 */
export const XMTPConfigSchema = z.object({
  /** Account name (optional display name) */
  name: z.string().optional(),

  /** Whether this channel is enabled */
  enabled: z.boolean().optional(),

  /** Markdown formatting overrides (tables). */
  markdown: MarkdownConfigSchema,

  /** Wallet private key (hex or env var name). Required for agent identity. */
  walletKey: z.string().optional(),

  /** DB encryption key for local XMTP storage. Required. */
  dbEncryptionKey: z.string().optional(),

  /** XMTP environment: production (default) or dev. */
  env: z.enum(["production", "dev"]).optional(),

  /** Enable debug logging for this account. */
  debug: z.boolean().optional(),

  /** Sender access policy (default: pairing). */
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),

  /** Allowlist of addresses permitted to message the agent. */
  allowFrom: z.array(allowFromEntry).optional(),

  /** Controls how group messages are handled (default: open). */
  groupPolicy: z.enum(["open", "disabled", "allowlist"]).optional(),

  /** Allowlist of conversation IDs (groupPolicy "allowlist"). Include "*" to allow all. */
  groups: z.array(z.string()).optional(),

  /** Outbound text chunk size (chars). Default: 4000. */
  textChunkLimit: z.number().int().min(4000).optional(),

  /** Ethereum address for display; derived from walletKey if not set. */
  publicAddress: z.string().optional(),

  /** Pinata API key for IPFS upload of media attachments. */
  pinataApiKey: z.string().optional(),

  /** Pinata secret key for IPFS upload of media attachments. */
  pinataSecretKey: z.string().optional(),

  /** Custom IPFS gateway URL (default: https://gateway.pinata.cloud/ipfs/). */
  ipfsGatewayUrl: z.string().url().optional(),

  /** Owner wallet address (auto-paired, DM created on startup). */
  ownerAddress: z.string().optional(),

  /** web3.bio API key for ENS resolution. */
  web3BioApiKey: z.string().optional(),
});

export type XMTPConfigInput = z.infer<typeof XMTPConfigSchema>;

/**
 * JSON Schema for Control UI (converted from Zod)
 */
export const xmtpChannelConfigSchema = buildChannelConfigSchema(XMTPConfigSchema);
