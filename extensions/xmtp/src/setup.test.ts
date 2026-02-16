/**
 * Unit tests for handleSetup — verifies key reuse logic.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const VALID_WALLET_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EXISTING_DB_ENC_KEY = "ab".repeat(32);
const GENERATED_DB_ENC_KEY = "cd".repeat(32);
const GENERATED_WALLET_KEY = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
const GENERATED_ADDRESS = "0xGeneratedAddr";

// --- Mocks ---

vi.mock("./runtime.js", () => ({
  getXmtpRuntime: vi.fn(),
}));

vi.mock("./lib/identity.js", () => ({
  generateXmtpIdentity: vi.fn(() => ({
    walletKey: GENERATED_WALLET_KEY,
    dbEncryptionKey: GENERATED_DB_ENC_KEY,
    publicAddress: GENERATED_ADDRESS,
  })),
  generateEncryptionKeyHex: vi.fn(() => GENERATED_DB_ENC_KEY),
  walletAddressFromPrivateKey: vi.fn(() => VALID_ADDRESS),
}));

vi.mock("./lib/xmtp-client.js", () => ({
  runTemporaryXmtpClient: vi.fn(async () => {}),
}));

import {
  generateXmtpIdentity,
  generateEncryptionKeyHex,
  walletAddressFromPrivateKey,
} from "./lib/identity.js";
import { runTemporaryXmtpClient } from "./lib/xmtp-client.js";
import { getXmtpRuntime } from "./runtime.js";
import { handleSetup } from "./setup.js";

type MockedFn = ReturnType<typeof vi.fn>;

function setupRuntime(xmtpConfig: Record<string, unknown> = {}) {
  const loadConfig = vi.fn(() => ({
    channels: { xmtp: xmtpConfig },
  }));
  const writeConfigFile = vi.fn(async () => {});
  const log = { info: vi.fn(), error: vi.fn() };

  (getXmtpRuntime as MockedFn).mockReturnValue({
    config: { loadConfig, writeConfigFile },
    logging: { getChildLogger: () => log },
  });

  return { loadConfig, writeConfigFile, log };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleSetup", () => {
  it("reuses both keys when walletKey and dbEncryptionKey exist in config", async () => {
    setupRuntime({
      walletKey: VALID_WALLET_KEY,
      dbEncryptionKey: EXISTING_DB_ENC_KEY,
      publicAddress: VALID_ADDRESS,
    });

    const result = await handleSetup({ env: "dev" });

    expect(generateXmtpIdentity).not.toHaveBeenCalled();
    expect(generateEncryptionKeyHex).not.toHaveBeenCalled();
    expect(result.publicAddress).toBe(VALID_ADDRESS);

    expect(runTemporaryXmtpClient).toHaveBeenCalledWith(
      expect.objectContaining({
        walletKey: VALID_WALLET_KEY,
        dbEncryptionKey: EXISTING_DB_ENC_KEY,
      }),
    );
  });

  it("generates only dbEncryptionKey when walletKey exists but dbEncryptionKey is missing", async () => {
    setupRuntime({
      walletKey: VALID_WALLET_KEY,
    });

    const result = await handleSetup({ env: "dev" });

    expect(generateXmtpIdentity).not.toHaveBeenCalled();
    expect(generateEncryptionKeyHex).toHaveBeenCalledTimes(1);
    expect(walletAddressFromPrivateKey).toHaveBeenCalledWith(VALID_WALLET_KEY);
    expect(result.publicAddress).toBe(VALID_ADDRESS);

    expect(runTemporaryXmtpClient).toHaveBeenCalledWith(
      expect.objectContaining({
        walletKey: VALID_WALLET_KEY,
        dbEncryptionKey: GENERATED_DB_ENC_KEY,
      }),
    );
  });

  it("generates full identity when no keys exist in config", async () => {
    setupRuntime({});

    const result = await handleSetup({ env: "dev" });

    expect(generateXmtpIdentity).toHaveBeenCalledTimes(1);
    expect(result.publicAddress).toBe(GENERATED_ADDRESS);

    expect(runTemporaryXmtpClient).toHaveBeenCalledWith(
      expect.objectContaining({
        walletKey: GENERATED_WALLET_KEY,
        dbEncryptionKey: GENERATED_DB_ENC_KEY,
      }),
    );
  });

  it("generates full identity when only dbEncryptionKey exists (no walletKey)", async () => {
    setupRuntime({
      dbEncryptionKey: EXISTING_DB_ENC_KEY,
    });

    const result = await handleSetup({ env: "dev" });

    expect(generateXmtpIdentity).toHaveBeenCalledTimes(1);
    expect(result.publicAddress).toBe(GENERATED_ADDRESS);

    expect(runTemporaryXmtpClient).toHaveBeenCalledWith(
      expect.objectContaining({
        walletKey: GENERATED_WALLET_KEY,
        dbEncryptionKey: GENERATED_DB_ENC_KEY,
      }),
    );
  });
});
