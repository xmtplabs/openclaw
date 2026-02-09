/**
 * XMTP Agent SDK client helpers: env override, agent creation, temporary client.
 */

import { Agent } from "@xmtp/agent-sdk";
import * as path from "node:path";
import type { ResolvedXmtpAccount } from "../accounts.js";
import type { XmtpAgentRuntime } from "../types.js";
import { getXmtpRuntime } from "../runtime.js";

export async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await fn();
  } finally {
    Object.assign(process.env, prev);
  }
}

export async function createAgentFromAccount(
  account: ResolvedXmtpAccount,
  stateDir: string,
): Promise<XmtpAgentRuntime> {
  const dbDir = path.join(stateDir, "xmtp", account.accountId);
  return withEnv(
    {
      XMTP_WALLET_KEY: account.walletKey,
      XMTP_DB_ENCRYPTION_KEY: account.dbEncryptionKey,
      XMTP_ENV: account.env,
      XMTP_DB_DIRECTORY: dbDir,
    },
    async () => (await Agent.createFromEnv()) as unknown as XmtpAgentRuntime,
  );
}

export async function runTemporaryXmtpClient(params: {
  walletKey: string;
  dbEncryptionKey: string;
  env: "production" | "dev";
  accountId?: string;
}): Promise<void> {
  const accountId = params.accountId ?? "default";
  const stateDir = getXmtpRuntime().state.resolveStateDir();
  const dbDir = path.join(stateDir, "xmtp", accountId);

  await withEnv(
    {
      XMTP_WALLET_KEY: params.walletKey,
      XMTP_DB_ENCRYPTION_KEY: params.dbEncryptionKey,
      XMTP_ENV: params.env,
      XMTP_DB_DIRECTORY: dbDir,
    },
    async () => {
      const agent = (await Agent.createFromEnv()) as {
        start: () => Promise<void>;
        stop: () => Promise<void>;
      };
      try {
        await agent.start();
      } finally {
        await agent.stop();
      }
    },
  );
}
