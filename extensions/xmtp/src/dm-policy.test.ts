/**
 * Unit tests for dm-policy.ts — pure DM/group access control logic.
 * Tests evaluateDmAccess decisions and sendPairingReply side effects independently.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  evaluateDmAccess,
  isGroupAllowed,
  normalizeXmtpAddress,
  sendPairingReply,
} from "./dm-policy.js";
import { setClientForAccount } from "./outbound.js";
import {
  createTestAccount,
  makeFakeAgent,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

// ---------------------------------------------------------------------------
// normalizeXmtpAddress
// ---------------------------------------------------------------------------

describe("normalizeXmtpAddress", () => {
  it("strips xmtp: prefix", () => {
    expect(normalizeXmtpAddress("xmtp:0xABC")).toBe("0xABC");
  });

  it("strips xmtp: prefix case-insensitively", () => {
    expect(normalizeXmtpAddress("XMTP:0xABC")).toBe("0xABC");
  });

  it("trims whitespace", () => {
    expect(normalizeXmtpAddress("  0xABC  ")).toBe("0xABC");
  });

  it("handles combined prefix and whitespace", () => {
    expect(normalizeXmtpAddress("  xmtp:  0xABC  ")).toBe("0xABC");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeXmtpAddress("")).toBe("");
  });

  it("passes through normal addresses unchanged", () => {
    expect(normalizeXmtpAddress("0xAbCdEf1234567890abcdef1234567890AbCdEf12")).toBe(
      "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
    );
  });
});

// ---------------------------------------------------------------------------
// isGroupAllowed
// ---------------------------------------------------------------------------

describe("isGroupAllowed", () => {
  it("open policy allows any group", () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, groupPolicy: "open" });
    expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
  });

  it("disabled policy blocks all groups", () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS, groupPolicy: "disabled" });
    expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(false);
  });

  it("allowlist policy allows listed group", () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      groupPolicy: "allowlist",
      groups: ["group-123"],
    });
    expect(isGroupAllowed({ account, conversationId: "group-123" })).toBe(true);
  });

  it("allowlist policy blocks unlisted group", () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      groupPolicy: "allowlist",
      groups: ["group-123"],
    });
    expect(isGroupAllowed({ account, conversationId: "group-456" })).toBe(false);
  });

  it("allowlist with wildcard allows all groups", () => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      groupPolicy: "allowlist",
      groups: ["*"],
    });
    expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
  });

  it("defaults to open when groupPolicy not set", () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    // groupPolicy defaults to "open" in createTestAccountConfig
    account.config.groupPolicy = undefined;
    expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateDmAccess
// ---------------------------------------------------------------------------

function makeMockRuntime(overrides?: {
  storeAllowFrom?: string[];
  pairingResult?: { code: string; created: boolean };
}) {
  const readAllowFromStore = vi.fn(async () => overrides?.storeAllowFrom ?? []);
  const upsertPairingRequest = vi.fn(
    async () => overrides?.pairingResult ?? { code: "TESTCODE", created: true },
  );
  return {
    runtime: {
      channel: {
        pairing: {
          readAllowFromStore,
          upsertPairingRequest,
        },
      },
    } as any,
    mocks: { readAllowFromStore, upsertPairingRequest },
  };
}

describe("evaluateDmAccess", () => {
  describe("dmPolicy: open", () => {
    it("allows any sender", async () => {
      const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("dmPolicy: disabled", () => {
    it("blocks all senders", async () => {
      const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "disabled" });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: false, reason: "disabled" });
    });
  });

  describe("dmPolicy: allowlist", () => {
    it("allows listed address from config", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [TEST_SENDER_ADDRESS],
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("allows listed address from store", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [],
      });
      const { runtime } = makeMockRuntime({ storeAllowFrom: [TEST_SENDER_ADDRESS] });

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("blocks unlisted address", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["0xOther"],
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
    });

    it("allows wildcard *", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["*"],
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("matches addresses case-insensitively", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [TEST_SENDER_ADDRESS.toUpperCase()],
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({
        account,
        sender: TEST_SENDER_ADDRESS.toLowerCase(),
        runtime,
      });

      expect(result).toEqual({ allowed: true });
    });

    it("strips xmtp: prefix when matching", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [`xmtp:${TEST_SENDER_ADDRESS}`],
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("ownerAddress auto-allow", () => {
    it("allows owner under pairing policy", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
        ownerAddress: TEST_SENDER_ADDRESS,
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("allows owner under allowlist policy", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [],
        ownerAddress: TEST_SENDER_ADDRESS,
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("does NOT allow owner when dmPolicy is disabled", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "disabled",
        ownerAddress: TEST_SENDER_ADDRESS,
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: false, reason: "disabled" });
    });

    it("matches owner address case-insensitively", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
        ownerAddress: TEST_SENDER_ADDRESS.toUpperCase(),
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({
        account,
        sender: TEST_SENDER_ADDRESS.toLowerCase(),
        runtime,
      });

      expect(result).toEqual({ allowed: true });
    });

    it("normalizes xmtp: prefix on owner address", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
        ownerAddress: `xmtp:${TEST_SENDER_ADDRESS}`,
      });
      const { runtime } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("behaves normally when no owner is set", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({
        allowed: false,
        reason: "pairing",
        code: "TESTCODE",
        created: true,
      });
      expect(mocks.upsertPairingRequest).toHaveBeenCalled();
    });
  });

  describe("dmPolicy: pairing", () => {
    it("returns pairing decision with code for unknown sender", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({
        allowed: false,
        reason: "pairing",
        code: "TESTCODE",
        created: true,
      });
      expect(mocks.upsertPairingRequest).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "xmtp", id: TEST_SENDER_ADDRESS }),
      );
    });

    it("returns created=false on duplicate pairing request", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime } = makeMockRuntime({
        pairingResult: { code: "TESTCODE", created: false },
      });

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({
        allowed: false,
        reason: "pairing",
        code: "TESTCODE",
        created: false,
      });
    });

    it("allows paired sender found in store", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime } = makeMockRuntime({ storeAllowFrom: [TEST_SENDER_ADDRESS] });

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("defaults to pairing when dmPolicy is not set", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        allowFrom: [],
      });
      account.config.dmPolicy = undefined;
      const { runtime, mocks } = makeMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({
        allowed: false,
        reason: "pairing",
        code: "TESTCODE",
        created: true,
      });
      expect(mocks.upsertPairingRequest).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// sendPairingReply
// ---------------------------------------------------------------------------

describe("sendPairingReply", () => {
  beforeEach(() => {
    setClientForAccount("default", null);
  });

  it("sends pairing code reply via conversation", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    const { agent, sentMessages } = makeFakeAgent();
    setClientForAccount("default", agent as any);

    const buildPairingReply = vi.fn(
      ({ code }: { channel: string; idLine: string; code: string }) => `Code: ${code}`,
    );
    const runtime = {
      channel: { pairing: { buildPairingReply } },
    } as any;

    await sendPairingReply({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-123",
      code: "ABC123",
      runtime,
      log: { info: vi.fn(), error: vi.fn() } as any,
    });

    expect(buildPairingReply).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "xmtp", code: "ABC123" }),
    );
    expect(sentMessages).toContain("Code: ABC123");
  });

  it("does nothing when no agent is available", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    const buildPairingReply = vi.fn(() => "code");
    const runtime = {
      channel: { pairing: { buildPairingReply } },
    } as any;

    // Should not throw even with no agent
    await sendPairingReply({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-123",
      code: "ABC123",
      runtime,
    });

    expect(buildPairingReply).toHaveBeenCalled();
  });

  it("logs error on failure", async () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    const buildPairingReply = vi.fn(() => {
      throw new Error("boom");
    });
    const runtime = {
      channel: { pairing: { buildPairingReply } },
    } as any;
    const log = { info: vi.fn(), error: vi.fn() };

    await sendPairingReply({
      account,
      sender: TEST_SENDER_ADDRESS,
      conversationId: "convo-123",
      code: "ABC123",
      runtime,
      log: log as any,
    });

    expect(log.error).toHaveBeenCalledWith(expect.stringContaining("Pairing reply failed"));
  });
});
