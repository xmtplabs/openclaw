/**
 * XMTP Agent SDK client helpers: agent creation, temporary client.
 *
 * Uses Agent.create(signer, options) instead of env-var mutation to avoid
 * race conditions when multiple accounts start concurrently.
 */

import { Agent, createSigner, createUser, type HexString } from "@xmtp/agent-sdk";
import * as path from "node:path";
import type { ResolvedXmtpAccount } from "../accounts.js";
import { getXmtpRuntime } from "../runtime.js";

/** Ensure a hex string has the `0x` prefix required by the SDK. */
function ensureHexPrefix(hex: string): HexString {
  return (hex.startsWith("0x") ? hex : `0x${hex}`) as HexString;
}

export async function createAgentFromAccount(
  account: ResolvedXmtpAccount,
  stateDir: string,
): Promise<Agent> {
  const dbPath = path.join(stateDir, "xmtp", account.accountId);
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
