import {
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  type OpenClawConfig,
  type PluginRuntime,
  type RuntimeLogger,
} from "openclaw/plugin-sdk";
import type { XMTPConfig } from "./config-types.js";
import {
  generateEncryptionKeyHex,
  generatePrivateKey,
  walletAddressFromPrivateKey,
} from "./lib/identity.js";

export type CoreConfig = {
  channels?: {
    xmtp?: XMTPConfig;
  };
  [key: string]: unknown;
};

export type ResolvedXmtpAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  configured: boolean;
  walletKey: string;
  dbEncryptionKey: string;
  env: "production" | "dev";
  debug: boolean;
  /** Ethereum address; from config or derived from walletKey. */
  publicAddress: string;
  /** Owner address (auto-paired, DM created on startup). */
  ownerAddress?: string;
  config: XMTPConfig;
};

export function getXmtpSection(cfg: CoreConfig): XMTPConfig | undefined {
  return cfg.channels?.xmtp;
}

export function updateXmtpSection(
  cfg: OpenClawConfig,
  update: Partial<XMTPConfig>,
): OpenClawConfig {
  const prev = (cfg.channels as CoreConfig["channels"])?.xmtp;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      xmtp: { ...prev, ...update },
    },
  };
}

export function listXmtpAccountIds(cfg: CoreConfig): string[] {
  const accounts = cfg.channels?.xmtp?.accounts;
  if (accounts && typeof accounts === "object" && Object.keys(accounts).length > 0) {
    return Object.keys(accounts);
  }
  return [DEFAULT_ACCOUNT_ID];
}

export function resolveDefaultXmtpAccountId(cfg: CoreConfig): string {
  const ids = listXmtpAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function getAccountBase(cfg: CoreConfig, accountId: string): XMTPConfig {
  const section = cfg.channels?.xmtp ?? {};
  const accounts = section.accounts;
  if (accounts && typeof accounts === "object" && accounts[accountId]) {
    return { ...section, ...accounts[accountId] } as XMTPConfig;
  }
  return section;
}

/**
 * Return config with publicAddress set for the given account (for backfill).
 * Writes to top-level xmtp or to xmtp.accounts[accountId] depending on structure.
 */
export function setAccountPublicAddress(
  cfg: OpenClawConfig,
  accountId: string,
  publicAddress: string,
): OpenClawConfig {
  const section = (cfg.channels as CoreConfig["channels"])?.xmtp ?? {};
  const accounts = section.accounts;
  if (accounts && typeof accounts === "object" && accounts[accountId]) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        xmtp: {
          ...section,
          accounts: {
            ...accounts,
            [accountId]: { ...accounts[accountId], publicAddress },
          },
        },
      },
    };
  }
  return updateXmtpSection(cfg, { publicAddress });
}

export function resolveXmtpAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedXmtpAccount {
  const accountId = normalizeAccountId(params.accountId);
  const base = getAccountBase(params.cfg, accountId);
  const enabled = base.enabled !== false;
  const configured = Boolean(base.walletKey && base.dbEncryptionKey);

  const publicAddress =
    base.publicAddress ?? (base.walletKey ? walletAddressFromPrivateKey(base.walletKey) : "");

  return {
    accountId,
    enabled,
    name: base.name?.trim() || undefined,
    configured,
    walletKey: base.walletKey ?? "",
    dbEncryptionKey: base.dbEncryptionKey ?? "",
    env: base.env === "dev" ? "dev" : "production",
    debug: base.debug ?? false,
    publicAddress,
    ownerAddress: base.ownerAddress?.trim() || undefined,
    config: base,
  };
}

export function listEnabledXmtpAccounts(cfg: CoreConfig): ResolvedXmtpAccount[] {
  return listXmtpAccountIds(cfg)
    .map((accountId) => resolveXmtpAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

/**
 * Throw if account is missing walletKey or dbEncryptionKey.
 */
export function ensureXmtpConfigured(account: ResolvedXmtpAccount): void {
  if (!account.walletKey || !account.dbEncryptionKey) {
    throw new Error(
      "XMTP not configured: walletKey and dbEncryptionKey required. Run 'openclaw configure' to set up XMTP.",
    );
  }
}

/**
 * Auto-generate missing walletKey and/or dbEncryptionKey, persist to config,
 * and return the updated account. If both keys are already present, returns
 * the account unchanged (no-op).
 */
export async function autoProvisionAccount(
  account: ResolvedXmtpAccount,
  runtime: PluginRuntime,
  log?: RuntimeLogger,
): Promise<ResolvedXmtpAccount> {
  const needWalletKey = !account.walletKey;
  const needEncryptionKey = !account.dbEncryptionKey;

  if (!needWalletKey && !needEncryptionKey) {
    return account;
  }

  const update: Partial<XMTPConfig> = {};
  let walletKey = account.walletKey;
  let dbEncryptionKey = account.dbEncryptionKey;
  let publicAddress = account.publicAddress;

  if (needWalletKey) {
    walletKey = generatePrivateKey();
    publicAddress = walletAddressFromPrivateKey(walletKey);
    update.walletKey = walletKey;
    update.publicAddress = publicAddress;
  }

  if (needEncryptionKey) {
    dbEncryptionKey = generateEncryptionKeyHex();
    update.dbEncryptionKey = dbEncryptionKey;
  }

  const cfg = runtime.config.loadConfig();
  const next = updateXmtpSection(cfg, update);
  await runtime.config.writeConfigFile(next);

  const generated = [needWalletKey && "walletKey", needEncryptionKey && "dbEncryptionKey"]
    .filter(Boolean)
    .join(", ");
  log?.info(`[${account.accountId}] auto-provisioned XMTP keys: ${generated}`);

  return {
    ...account,
    walletKey,
    dbEncryptionKey,
    publicAddress,
    configured: true,
  };
}
