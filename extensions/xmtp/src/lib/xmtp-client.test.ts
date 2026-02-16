import { describe, it, expect } from "vitest";
import type { ResolvedXmtpAccount } from "../accounts.js";
import { createAgentFromAccount } from "./xmtp-client.js";

describe("createAgentFromAccount", () => {
  it("does not mutate process.env", async () => {
    const before = { ...process.env };
    const account: ResolvedXmtpAccount = {
      accountId: "test",
      enabled: true,
      configured: true,
      walletKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      dbEncryptionKey: "a".repeat(64),
      env: "dev",
      debug: false,
      publicAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      config: { env: "dev" },
    };
    // Agent creation may fail without network — that's OK for this test
    try {
      await createAgentFromAccount(account, "/tmp/test-xmtp");
    } catch {
      // expected
    }
    expect(process.env.XMTP_WALLET_KEY).toBe(before.XMTP_WALLET_KEY);
    expect(process.env.XMTP_DB_ENCRYPTION_KEY).toBe(before.XMTP_DB_ENCRYPTION_KEY);
  });
});
