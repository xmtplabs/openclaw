/**
 * Write XMTP env vars to ~/.openclaw/.env for Agent.createFromEnv().
 */

import fs from "node:fs";
import path from "node:path";
import { getXmtpRuntime } from "../runtime.js";

const XMTP_ENV_KEYS = ["XMTP_WALLET_KEY", "XMTP_DB_ENCRYPTION_KEY", "XMTP_ENV"] as const;

export function writeXmtpVarsToEnv(params: {
  walletKey: string;
  dbEncryptionKey: string;
  env: "production" | "dev";
}): string {
  const configDir = getXmtpRuntime().state.resolveStateDir();
  const envPath = path.join(configDir, ".env");
  const vars: Record<string, string> = {
    XMTP_WALLET_KEY: params.walletKey,
    XMTP_DB_ENCRYPTION_KEY: params.dbEncryptionKey,
    XMTP_ENV: params.env,
  };

  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf-8");
    lines = raw.split(/\r?\n/);
  }

  const keyPrefix = (key: string) =>
    new RegExp(`^\\s*(?:export\\s+)?${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
  const updated = new Set<string>();

  const nextLines = lines.map((line) => {
    for (const key of XMTP_ENV_KEYS) {
      if (keyPrefix(key).test(line)) {
        updated.add(key);
        return `${key}=${vars[key]}`;
      }
    }
    return line;
  });

  for (const key of XMTP_ENV_KEYS) {
    if (!updated.has(key)) {
      nextLines.push(`${key}=${vars[key]}`);
    }
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(envPath, `${nextLines.join("\n")}\n`, "utf-8");
  fs.chmodSync(envPath, 0o600);
  return envPath;
}
