/**
 * XMTP setup: generate identity, show public address, persist.
 * No QR, no invite URL, no join logic.
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { resolveXmtpAccount, updateXmtpSection, type CoreConfig } from "./accounts.js";
import { generateXmtpIdentity } from "./lib/identity.js";
import { runTemporaryXmtpClient } from "./lib/xmtp-client.js";
import { getXmtpRuntime } from "./runtime.js";

let setupResult: {
  walletKey: string;
  dbEncryptionKey: string;
  env: "production" | "dev";
  publicAddress: string;
  ownerAddress?: string;
} | null = null;

export async function handleSetup(params: {
  accountId?: string;
  env?: "production" | "dev";
  ownerAddress?: string;
}): Promise<{ publicAddress: string }> {
  const log = getXmtpRuntime().logging.getChildLogger();
  const env = params.env === "dev" ? "dev" : "production";

  log?.info(`[xmtp] setup started (env: ${env})`);

  const { walletKey, dbEncryptionKey, publicAddress } = generateXmtpIdentity();

  await runTemporaryXmtpClient({
    walletKey,
    dbEncryptionKey,
    env,
    accountId: params.accountId ?? DEFAULT_ACCOUNT_ID,
  });

  setupResult = {
    walletKey,
    dbEncryptionKey,
    env,
    publicAddress,
    ownerAddress: params.ownerAddress,
  };

  log?.info(`[xmtp] setup identity generated (address: ${publicAddress})`);
  return { publicAddress };
}

export function handleSetupStatus(): {
  configured: boolean;
  publicAddress?: string;
  setupPending?: boolean;
} {
  if (setupResult) {
    return {
      configured: false,
      setupPending: true,
      publicAddress: setupResult.publicAddress,
    };
  }

  const runtime = getXmtpRuntime();
  const cfg = runtime.config.loadConfig() as OpenClawConfig;
  const account = resolveXmtpAccount({ cfg: cfg as CoreConfig });

  return {
    configured: account.configured,
    publicAddress: account.configured ? account.publicAddress : undefined,
  };
}

export async function handleSetupComplete(): Promise<{ saved: true }> {
  if (!setupResult) {
    throw new Error("No active setup to complete. Run xmtp.setup first.");
  }

  const runtime = getXmtpRuntime();
  const log = runtime.logging.getChildLogger();
  const cfg = runtime.config.loadConfig() as OpenClawConfig;

  log?.info("[xmtp] setup complete — writing config");

  const next = updateXmtpSection(cfg, {
    walletKey: setupResult.walletKey,
    dbEncryptionKey: setupResult.dbEncryptionKey,
    env: setupResult.env,
    publicAddress: setupResult.publicAddress,
    enabled: true,
    ...(setupResult.ownerAddress ? { ownerAddress: setupResult.ownerAddress } : {}),
  });

  await runtime.config.writeConfigFile(next);
  setupResult = null;

  log?.info("[xmtp] setup config saved");
  return { saved: true };
}

export function handleSetupCancel(): { cancelled: boolean } {
  const log = getXmtpRuntime().logging.getChildLogger();
  const wasPending = setupResult !== null;
  setupResult = null;
  if (wasPending) {
    log?.info("[xmtp] setup cancelled");
  }
  return { cancelled: wasPending };
}
