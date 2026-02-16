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
import { setResolverForAccount, createEnsResolver } from "./lib/ens-resolver.js";
import { setClientForAccount } from "./outbound.js";
import {
  createMockRuntime,
  createTestAccount,
  makeFakeAgent,
  TEST_OWNER_ADDRESS,
  TEST_SENDER_ADDRESS,
} from "./test-utils/unit-helpers.js";

// ---------------------------------------------------------------------------
// normalizeXmtpAddress
// ---------------------------------------------------------------------------

describe("normalizeXmtpAddress", () => {
  it.each([
    ["strips xmtp: prefix", "xmtp:0xABC", "0xABC"],
    ["strips prefix case-insensitively", "XMTP:0xABC", "0xABC"],
    ["trims whitespace", "  0xABC  ", "0xABC"],
    ["handles combined prefix and whitespace", "  xmtp:  0xABC  ", "0xABC"],
    ["returns empty for empty input", "", ""],
    [
      "passes through normal addresses",
      "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
      "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
    ],
  ])("%s", (_desc, input, expected) => {
    expect(normalizeXmtpAddress(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// isGroupAllowed
// ---------------------------------------------------------------------------

describe("isGroupAllowed", () => {
  it.each([
    ["open allows any group", "open", undefined, "any-group", true],
    ["disabled blocks all groups", "disabled", undefined, "any-group", false],
    ["allowlist allows listed group", "allowlist", ["group-123"], "group-123", true],
    ["allowlist blocks unlisted group", "allowlist", ["group-123"], "group-456", false],
    ["allowlist wildcard allows all", "allowlist", ["*"], "any-group", true],
  ] as const)("%s", (_desc, groupPolicy, groups, conversationId, expected) => {
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      groupPolicy: groupPolicy as any,
      groups: groups as any,
    });
    expect(isGroupAllowed({ account, conversationId })).toBe(expected);
  });

  it("defaults to open when groupPolicy not set", () => {
    const account = createTestAccount({ address: TEST_OWNER_ADDRESS });
    account.config.groupPolicy = undefined;
    expect(isGroupAllowed({ account, conversationId: "any-group" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateDmAccess
// ---------------------------------------------------------------------------

describe("evaluateDmAccess", () => {
  describe("dmPolicy: open", () => {
    it("allows any sender", async () => {
      const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "open" });
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });
  });

  describe("dmPolicy: disabled", () => {
    it("blocks all senders", async () => {
      const account = createTestAccount({ address: TEST_OWNER_ADDRESS, dmPolicy: "disabled" });
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("allows listed address from store", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [],
      });
      const { runtime } = createMockRuntime({ storeAllowFrom: [TEST_SENDER_ADDRESS] });

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("blocks unlisted address", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["0xOther"],
      });
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
    });

    it("allows wildcard *", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: ["*"],
      });
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("matches addresses case-insensitively", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "allowlist",
        allowFrom: [TEST_SENDER_ADDRESS.toUpperCase()],
      });
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("does NOT allow owner when dmPolicy is disabled", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "disabled",
        ownerAddress: TEST_SENDER_ADDRESS,
      });
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

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
      const { runtime } = createMockRuntime();

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("behaves normally when no owner is set", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        dmPolicy: "pairing",
        allowFrom: [],
      });
      const { runtime, mocks } = createMockRuntime();

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
      const { runtime, mocks } = createMockRuntime();

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
      const { runtime } = createMockRuntime({
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
      const { runtime } = createMockRuntime({ storeAllowFrom: [TEST_SENDER_ADDRESS] });

      const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

      expect(result).toEqual({ allowed: true });
    });

    it("defaults to pairing when dmPolicy is not set", async () => {
      const account = createTestAccount({
        address: TEST_OWNER_ADDRESS,
        allowFrom: [],
      });
      account.config.dmPolicy = undefined;
      const { runtime, mocks } = createMockRuntime();

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
// ENS resolution in evaluateDmAccess
// ---------------------------------------------------------------------------

describe("ENS resolution in evaluateDmAccess", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    setResolverForAccount("default", null);
  });

  function setupResolver() {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);
  }

  function mockResolve(address: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ address }),
    });
  }

  it("allows sender when ownerAddress is an ENS name that resolves to sender", async () => {
    setupResolver();
    mockResolve(TEST_SENDER_ADDRESS);

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "pairing",
      ownerAddress: "owner.eth",
    });
    const { runtime } = createMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });
    expect(result).toEqual({ allowed: true });
  });

  it("allows sender when allowFrom contains ENS name that resolves to sender", async () => {
    setupResolver();
    mockResolve(TEST_SENDER_ADDRESS);

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["friend.eth"],
    });
    const { runtime } = createMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });
    expect(result).toEqual({ allowed: true });
  });

  it("blocks sender when ENS name resolves to different address", async () => {
    setupResolver();
    mockResolve("0x0000000000000000000000000000000000000000");

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["other.eth"],
    });
    const { runtime } = createMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });
    expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
  });

  it("works without resolver (graceful degradation)", async () => {
    // No resolver set — ENS names in allowFrom can't be resolved
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["friend.eth"],
    });
    const { runtime } = createMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });
    expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
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
