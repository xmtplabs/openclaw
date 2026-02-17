/**
 * XMTP Agent SDK client helpers: agent creation, temporary client.
 *
 * Uses Agent.create(signer, options) instead of env-var mutation to avoid
 * race conditions when multiple accounts start concurrently.
 */

import { Agent, createSigner, createUser, type HexString } from "@xmtp/agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedXmtpAccount } from "../accounts.js";
import { getXmtpRuntime } from "../runtime.js";

/** Ensure a hex string has the `0x` prefix required by the SDK. */
export function ensureHexPrefix(hex: string): HexString {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as HexString;
}

/**
 * Look up a conversation by ID, or create a DM if the target looks like
 * an Ethereum address (starts with 0x). Throws if neither succeeds.
 */
export async function getOrCreateConversation(
  agent: Pick<Agent, "client" | "createDmWithAddress">,
  target: string,
) {
  let conversation = await agent.client.conversations.getConversationById(target);
  if (!conversation && target.startsWith("0x")) {
    conversation = await agent.createDmWithAddress(target as `0x${string}`);
  }
  if (!conversation) {
    throw new Error(`Conversation not found: ${target.slice(0, 12)}...`);
  }
  return conversation;
}

export async function createAgentFromAccount(
  account: ResolvedXmtpAccount,
  stateDir: string,
): Promise<Agent> {
  const dbPath = path.join(stateDir, "xmtp", account.accountId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const user = createUser(ensureHexPrefix(account.walletKey));
  const signer = createSigner(user);
  return Agent.create(signer, {
    env: account.env,
    dbEncryptionKey: ensureHexPrefix(account.dbEncryptionKey),
    dbPath,
  });
}

export async function runTemporaryXmtpClient(params: {
  walletKey: string;
  dbEncryptionKey: string;
  env: "production" | "dev";
  accountId?: string;
}): Promise<void> {
  const accountId = params.accountId ?? "default";
  const stateDir = getXmtpRuntime().state.resolveStateDir();
  const dbPath = path.join(stateDir, "xmtp", accountId);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const user = createUser(ensureHexPrefix(params.walletKey));
  const signer = createSigner(user);
  const agent = await Agent.create(signer, {
    env: params.env,
    dbEncryptionKey: ensureHexPrefix(params.dbEncryptionKey),
    dbPath,
  });
  try {
    await agent.start();
  } finally {
    await agent.stop();
  }
}
