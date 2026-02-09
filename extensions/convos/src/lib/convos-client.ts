/**
 * Convos/XMTP DB path resolution and writability checks.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Derive a short hash from the private key so that changing the key
 * produces a fresh DB directory, avoiding "identity rowid=1" crashes.
 */
export function keyHash8(privateKey: string): string {
  const hex = privateKey.startsWith("0x") ? privateKey.slice(2) : privateKey;
  return hex.slice(0, 8).toLowerCase();
}

/**
 * Build a deterministic dbPath file under the OpenClaw state directory.
 * Agent.create() expects a **file** path (SQLite DB), not a directory.
 *
 *   <stateDir>/convos/xmtp/<env>/<accountId>/<keyHash8>/xmtp.db
 */
export function resolveConvosDbPath(params: {
  stateDir: string;
  env: "production" | "dev";
  accountId: string;
  privateKey: string;
}): string {
  const hash = keyHash8(params.privateKey);
  const dir = path.join(params.stateDir, "convos", "xmtp", params.env, params.accountId, hash);
  return path.join(dir, "xmtp.db");
}

/**
 * Ensure the parent directory of a dbPath file exists and is writable.
 */
export function ensureDbPathWritable(dbPath: string): void {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const probe = path.join(dir, `.probe-${process.pid}`);
  try {
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch (err) {
    throw new Error(
      `XMTP dbPath parent dir is not writable: ${dir} — ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}
