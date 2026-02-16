/**
 * Unit tests for XMTP account resolution logic.
 * No network access needed — tests pure config parsing.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import {
  autoProvisionAccount,
  resolveXmtpAccount,
  listXmtpAccountIds,
  resolveDefaultXmtpAccountId,
  listEnabledXmtpAccounts,
  type CoreConfig,
  type ResolvedXmtpAccount,
} from "./accounts.js";

// Use a real 32-byte hex private key for tests that need address derivation
const VALID_WALLET_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("resolveXmtpAccount", () => {
  it("resolves default account from top-level config", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          walletKey: VALID_WALLET_KEY,
          dbEncryptionKey: "deadbeef",
          env: "dev",
          name: "My XMTP Bot",
          publicAddress: "0xTestAddr",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.walletKey).toBe(VALID_WALLET_KEY);
    expect(account.dbEncryptionKey).toBe("deadbeef");
    expect(account.env).toBe("dev");
    expect(account.name).toBe("My XMTP Bot");
    expect(account.configured).toBe(true);
    expect(account.enabled).toBe(true);
  });

  it("resolves named account from accounts map", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          accounts: {
            bot1: {
              walletKey: VALID_WALLET_KEY,
              dbEncryptionKey: "bot1enc",
              env: "dev",
              name: "Bot 1",
              publicAddress: "0xBot1Addr",
            },
          },
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "bot1" });

    expect(account.accountId).toBe("bot1");
    expect(account.walletKey).toBe(VALID_WALLET_KEY);
    expect(account.dbEncryptionKey).toBe("bot1enc");
    expect(account.name).toBe("Bot 1");
    expect(account.configured).toBe(true);
  });

  it("top-level fields act as defaults for named accounts", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          env: "dev",
          debug: true,
          accounts: {
            bot1: {
              walletKey: VALID_WALLET_KEY,
              dbEncryptionKey: "bot1enc",
              publicAddress: "0xBot1Addr",
            },
          },
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "bot1" });

    expect(account.env).toBe("dev");
    expect(account.debug).toBe(true);
    expect(account.walletKey).toBe(VALID_WALLET_KEY);
  });

  it("account-level fields override top-level defaults", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          env: "dev",
          accounts: {
            bot1: {
              walletKey: VALID_WALLET_KEY,
              dbEncryptionKey: "bot1enc",
              env: "production",
              publicAddress: "0xBot1Addr",
            },
          },
        },
      },
    };

    const account = resolveXmtpAccount({ cfg, accountId: "bot1" });

    expect(account.env).toBe("production");
  });

  it("configured is false when walletKey missing", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          dbEncryptionKey: "enc123",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.configured).toBe(false);
  });

  it("configured is false when dbEncryptionKey missing", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          walletKey: VALID_WALLET_KEY,
          publicAddress: "0xAddr",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.configured).toBe(false);
  });

  it("publicAddress derived from walletKey when not set explicitly", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          walletKey: VALID_WALLET_KEY,
          dbEncryptionKey: "enc123",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.publicAddress.toLowerCase()).toBe(VALID_ADDRESS.toLowerCase());
  });

  it("uses explicit publicAddress from config when set", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          walletKey: VALID_WALLET_KEY,
          dbEncryptionKey: "enc123",
          publicAddress: "0xCustomAddress",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.publicAddress).toBe("0xCustomAddress");
  });

  it("env defaults to production when not set", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          walletKey: VALID_WALLET_KEY,
          dbEncryptionKey: "enc",
          publicAddress: "0xAddr",
        },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.env).toBe("production");
  });

  it("debug defaults to false", () => {
    const cfg: CoreConfig = {
      channels: { xmtp: {} },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.debug).toBe(false);
  });

  it("enabled defaults to true", () => {
    const cfg: CoreConfig = {
      channels: { xmtp: {} },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.enabled).toBe(true);
  });

  it("enabled is false when explicitly disabled", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: { enabled: false },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.enabled).toBe(false);
  });

  it("handles empty xmtp config section", () => {
    const cfg: CoreConfig = {};

    const account = resolveXmtpAccount({ cfg });

    expect(account.accountId).toBe("default");
    expect(account.configured).toBe(false);
    expect(account.walletKey).toBe("");
    expect(account.dbEncryptionKey).toBe("");
    expect(account.publicAddress).toBe("");
  });

  it("trims whitespace from name", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: { name: "  My Bot  " },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.name).toBe("My Bot");
  });

  it("name is undefined for empty string", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: { name: "   " },
      },
    };

    const account = resolveXmtpAccount({ cfg });

    expect(account.name).toBeUndefined();
  });
});

describe("listXmtpAccountIds", () => {
  it("returns default when no accounts map", () => {
    const cfg: CoreConfig = {
      channels: { xmtp: { walletKey: VALID_WALLET_KEY } },
    };

    expect(listXmtpAccountIds(cfg)).toEqual(["default"]);
  });

  it("returns account keys when accounts map present", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          accounts: {
            bot1: { walletKey: VALID_WALLET_KEY },
            bot2: { walletKey: VALID_WALLET_KEY },
          },
        },
      },
    };

    const ids = listXmtpAccountIds(cfg);

    expect(ids).toContain("bot1");
    expect(ids).toContain("bot2");
    expect(ids).toHaveLength(2);
  });

  it("returns default when accounts map is empty", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: { accounts: {} },
      },
    };

    expect(listXmtpAccountIds(cfg)).toEqual(["default"]);
  });
});

describe("resolveDefaultXmtpAccountId", () => {
  it("returns 'default' when present in ids", () => {
    const cfg: CoreConfig = {
      channels: { xmtp: {} },
    };

    expect(resolveDefaultXmtpAccountId(cfg)).toBe("default");
  });

  it("returns first account ID when default not present", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          accounts: {
            bot1: { walletKey: VALID_WALLET_KEY },
          },
        },
      },
    };

    expect(resolveDefaultXmtpAccountId(cfg)).toBe("bot1");
  });
});

describe("listEnabledXmtpAccounts", () => {
  it("filters out disabled accounts", () => {
    const cfg: CoreConfig = {
      channels: {
        xmtp: {
          accounts: {
            bot1: {
              walletKey: VALID_WALLET_KEY,
              dbEncryptionKey: "e1",
              enabled: true,
              publicAddress: "0xBot1",
            },
            bot2: {
              walletKey: VALID_WALLET_KEY,
              dbEncryptionKey: "e2",
              enabled: false,
              publicAddress: "0xBot2",
            },
          },
        },
      },
    };

    const enabled = listEnabledXmtpAccounts(cfg);

    expect(enabled).toHaveLength(1);
    expect(enabled[0]?.accountId).toBe("bot1");
  });
});

// ---------------------------------------------------------------------------
// autoProvisionAccount
// ---------------------------------------------------------------------------

function makeAccount(overrides?: Partial<ResolvedXmtpAccount>): ResolvedXmtpAccount {
  return {
    accountId: "default",
    enabled: true,
    configured: false,
    walletKey: "",
    dbEncryptionKey: "",
    env: "dev",
    debug: false,
    publicAddress: "",
    config: {},
    ...overrides,
  };
}

function makeMockRuntime(): { runtime: PluginRuntime; writeConfigFile: ReturnType<typeof vi.fn> } {
  const writeConfigFile = vi.fn(async () => {});
  const loadConfig = vi.fn(() => ({ channels: { xmtp: {} } }));
  const runtime = { config: { loadConfig, writeConfigFile } } as unknown as PluginRuntime;
  return { runtime, writeConfigFile };
}

describe("autoProvisionAccount", () => {
  it("generates both keys when both are missing", async () => {
    const account = makeAccount();
    const { runtime, writeConfigFile } = makeMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const result = await autoProvisionAccount(account, runtime, log as any);

    expect(result.walletKey).toBeTruthy();
    expect(result.walletKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.dbEncryptionKey).toBeTruthy();
    expect(result.dbEncryptionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.publicAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(result.configured).toBe(true);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0][0];
    expect(written.channels.xmtp.walletKey).toBe(result.walletKey);
    expect(written.channels.xmtp.dbEncryptionKey).toBe(result.dbEncryptionKey);
    expect(written.channels.xmtp.publicAddress).toBe(result.publicAddress);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("walletKey, dbEncryptionKey"));
  });

  it("generates only dbEncryptionKey when walletKey is present", async () => {
    const account = makeAccount({
      walletKey: VALID_WALLET_KEY,
      publicAddress: VALID_ADDRESS,
    });
    const { runtime, writeConfigFile } = makeMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const result = await autoProvisionAccount(account, runtime, log as any);

    expect(result.walletKey).toBe(VALID_WALLET_KEY);
    expect(result.publicAddress).toBe(VALID_ADDRESS);
    expect(result.dbEncryptionKey).toMatch(/^[0-9a-f]{64}$/);
    expect(result.configured).toBe(true);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0][0];
    expect(written.channels.xmtp.walletKey).toBeUndefined();
    expect(written.channels.xmtp.dbEncryptionKey).toBe(result.dbEncryptionKey);
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("dbEncryptionKey"));
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining("walletKey"));
  });

  it("generates only walletKey when dbEncryptionKey is present", async () => {
    const existingEncKey = "ab".repeat(32);
    const account = makeAccount({ dbEncryptionKey: existingEncKey });
    const { runtime, writeConfigFile } = makeMockRuntime();
    const log = { info: vi.fn(), error: vi.fn() };

    const result = await autoProvisionAccount(account, runtime, log as any);

    expect(result.walletKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.dbEncryptionKey).toBe(existingEncKey);
    expect(result.publicAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(result.configured).toBe(true);
    expect(writeConfigFile).toHaveBeenCalledTimes(1);
    const written = writeConfigFile.mock.calls[0][0];
    expect(written.channels.xmtp.walletKey).toBe(result.walletKey);
    expect(written.channels.xmtp.publicAddress).toBe(result.publicAddress);
    expect(written.channels.xmtp.dbEncryptionKey).toBeUndefined();
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining("walletKey"));
    expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining("dbEncryptionKey"));
  });

  it("returns account unchanged when both keys are present", async () => {
    const account = makeAccount({
      walletKey: VALID_WALLET_KEY,
      dbEncryptionKey: "deadbeef",
      publicAddress: VALID_ADDRESS,
      configured: true,
    });
    const { runtime, writeConfigFile } = makeMockRuntime();

    const result = await autoProvisionAccount(account, runtime);

    expect(result).toBe(account);
    expect(writeConfigFile).not.toHaveBeenCalled();
  });

  it("generated wallet key produces a valid Ethereum address", async () => {
    const account = makeAccount();
    const { runtime } = makeMockRuntime();

    const result = await autoProvisionAccount(account, runtime);

    // Address should be a valid checksummed or lowercase Ethereum address
    expect(result.publicAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    // Verify it's derived from the generated wallet key
    const { walletAddressFromPrivateKey } = await import("./lib/identity.js");
    expect(result.publicAddress).toBe(walletAddressFromPrivateKey(result.walletKey));
  });

  it("generated encryption key is 32-byte hex", async () => {
    const account = makeAccount({ walletKey: VALID_WALLET_KEY, publicAddress: VALID_ADDRESS });
    const { runtime } = makeMockRuntime();

    const result = await autoProvisionAccount(account, runtime);

    expect(result.dbEncryptionKey).toHaveLength(64);
    expect(result.dbEncryptionKey).toMatch(/^[0-9a-f]{64}$/);
  });
});
