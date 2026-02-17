import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEnsResolver,
  extractEnsNames,
  extractEthAddresses,
  isEnsName,
  isEthAddress,
} from "./ens-resolver.js";

describe("isEnsName", () => {
  it.each([
    ["simple .eth name", "nick.eth", true],
    ["subdomain .eth name", "pay.nick.eth", true],
    ["bare string", "nick", false],
    ["ethereum address", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", false],
    ["empty string", "", false],
  ] as const)("%s → %s", (_desc, input, expected) => {
    expect(isEnsName(input)).toBe(expected);
  });
});

describe("isEthAddress", () => {
  it.each([
    ["valid checksum address", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", true],
    ["lowercase address", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045", true],
    ["short hex", "0xd8da6b", false],
    ["ENS name", "vitalik.eth", false],
  ] as const)("%s → %s", (_desc, input, expected) => {
    expect(isEthAddress(input)).toBe(expected);
  });
});

describe("extractEnsNames", () => {
  it.each([
    ["single name", "send 1 ETH to nick.eth please", ["nick.eth"]],
    ["multiple names", "nick.eth and vitalik.eth are friends", ["nick.eth", "vitalik.eth"]],
    ["subdomain", "check pay.nick.eth", ["pay.nick.eth"]],
    ["deduplicates", "nick.eth sent to nick.eth", ["nick.eth"]],
    ["no matches", "no names here", []],
    ["filters parent when subdomain present", "pay.nick.eth and nick.eth", ["pay.nick.eth"]],
    ["case-insensitive", "send to NICK.ETH please", ["NICK.ETH"]],
  ])("%s", (_desc, input, expected) => {
    expect(extractEnsNames(input as string)).toEqual(expected);
  });
});

describe("extractEthAddresses", () => {
  const A1 = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const A2 = "0x1234567890abcdef1234567890abcdef12345678";

  it.each([
    ["single address", `send to ${A1}`, [A1]],
    ["multiple addresses", `${A1} and ${A2}`, [A1, A2]],
    ["deduplicates", `${A1} ${A1}`, [A1]],
    ["no matches", "no addresses", []],
  ])("%s", (_desc, input, expected) => {
    expect(extractEthAddresses(input)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// createEnsResolver
// ---------------------------------------------------------------------------

describe("createEnsResolver", () => {
  const NICK_ADDRESS = "0xb8c2C29ee19D8307cb7255e1Cd9CbDE883A267d5";
  const NICK_NAME = "nick.eth";

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Helper: mock a successful forward-resolution response. */
  function mockForwardResponse(name: string, address: string) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ address, identity: name }),
    });
  }

  /** Helper: mock a successful reverse-resolution response. */
  function mockReverseResponse(address: string, name: string) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ address, name }),
    });
  }

  /** Helper: mock an empty (no data) response. */
  function mockEmptyResponse() {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
  }

  /** Helper: mock a non-ok HTTP response. */
  function mockHttpError(status = 500) {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status,
      statusText: "Internal Server Error",
    });
  }

  /** Helper: mock a network error (fetch throws). */
  function mockNetworkError() {
    fetchMock.mockRejectedValueOnce(new Error("network error"));
  }

  /** Flush all pending retry sleeps (advance timers for each retry). */
  async function flushRetries() {
    // Retry delays: 100ms, 200ms, 400ms — advance past each.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }
  }

  // -----------------------------------------------------------------------
  // resolveEnsName (forward: name -> address)
  // -----------------------------------------------------------------------

  describe("resolveEnsName (forward: name -> address)", () => {
    it("resolves an ENS name to an address", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      const result = await resolver.resolveEnsName(NICK_NAME);
      expect(result).toBe(NICK_ADDRESS);
      expect(fetchMock).toHaveBeenCalledWith(
        `https://api.web3.bio/ns/ens/${NICK_NAME}`,
        expect.objectContaining({ headers: {} }),
      );
    });

    it("returns null on API failure", async () => {
      mockHttpError();
      mockHttpError();
      mockHttpError();
      const resolver = createEnsResolver();
      const promise = resolver.resolveEnsName(NICK_NAME);
      await flushRetries();
      const result = await promise;
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockNetworkError();
      mockNetworkError();
      mockNetworkError();
      const resolver = createEnsResolver();
      const promise = resolver.resolveEnsName(NICK_NAME);
      await flushRetries();
      const result = await promise;
      expect(result).toBeNull();
    });

    it("passes API key header when configured", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver("my-secret-key");
      await resolver.resolveEnsName(NICK_NAME);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { "X-API-KEY": "Bearer my-secret-key" },
        }),
      );
    });

    it("omits API key header when not configured", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      await resolver.resolveEnsName(NICK_NAME);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: {} }),
      );
    });

    it("retries on failure up to 3 times", async () => {
      mockHttpError();
      mockHttpError();
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      const promise = resolver.resolveEnsName(NICK_NAME);
      await flushRetries();
      const result = await promise;
      expect(result).toBe(NICK_ADDRESS);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("returns null after all retries exhausted", async () => {
      mockNetworkError();
      mockNetworkError();
      mockNetworkError();
      const resolver = createEnsResolver();
      const promise = resolver.resolveEnsName(NICK_NAME);
      await flushRetries();
      const result = await promise;
      expect(result).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });

  // -----------------------------------------------------------------------
  // resolveAddress (reverse: address -> name)
  // -----------------------------------------------------------------------

  describe("resolveAddress (reverse: address -> name)", () => {
    it("resolves an address to an ENS name", async () => {
      mockReverseResponse(NICK_ADDRESS, NICK_NAME);
      const resolver = createEnsResolver();
      const result = await resolver.resolveAddress(NICK_ADDRESS);
      expect(result).toBe(NICK_NAME);
    });

    it("returns null when no name found", async () => {
      mockEmptyResponse();
      const resolver = createEnsResolver();
      const result = await resolver.resolveAddress(NICK_ADDRESS);
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // caching
  // -----------------------------------------------------------------------

  describe("caching", () => {
    it("caches forward resolution results", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      const first = await resolver.resolveEnsName(NICK_NAME);
      const second = await resolver.resolveEnsName(NICK_NAME);
      expect(first).toBe(NICK_ADDRESS);
      expect(second).toBe(NICK_ADDRESS);
      // fetch called only once — second call served from cache
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("populates reverse cache from forward resolution", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      await resolver.resolveEnsName(NICK_NAME);
      // Now reverse lookup should be served from cache (no new fetch)
      const name = await resolver.resolveAddress(NICK_ADDRESS);
      expect(name).toBe(NICK_NAME);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("expires cache entries after TTL", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const resolver = createEnsResolver();
      await resolver.resolveEnsName(NICK_NAME);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Advance past 5-minute TTL
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

      await resolver.resolveEnsName(NICK_NAME);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not cache null from network errors", async () => {
      // First call: all retries fail -> null
      mockNetworkError();
      mockNetworkError();
      mockNetworkError();
      const resolver = createEnsResolver();
      const promise1 = resolver.resolveEnsName(NICK_NAME);
      await flushRetries();
      const result1 = await promise1;
      expect(result1).toBeNull();

      // Second call: succeeds — should NOT be served from cache
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      const result2 = await resolver.resolveEnsName(NICK_NAME);
      expect(result2).toBe(NICK_ADDRESS);
      // 3 retries + 1 successful = 4 total fetch calls
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  // -----------------------------------------------------------------------
  // resolveAll
  // -----------------------------------------------------------------------

  describe("resolveAll", () => {
    it("batch-resolves mixed names and addresses", async () => {
      mockForwardResponse(NICK_NAME, NICK_ADDRESS);
      mockReverseResponse(NICK_ADDRESS, NICK_NAME);
      const resolver = createEnsResolver();
      const results = await resolver.resolveAll([NICK_NAME, NICK_ADDRESS]);
      expect(results.get(NICK_NAME)).toBe(NICK_ADDRESS);
      expect(results.get(NICK_ADDRESS)).toBe(NICK_NAME);
    });

    it("returns null for unresolvable identifiers", async () => {
      mockEmptyResponse();
      const resolver = createEnsResolver();
      const results = await resolver.resolveAll(["unknown.eth"]);
      expect(results.get("unknown.eth")).toBeNull();
    });

    it("returns empty map for empty input", async () => {
      const resolver = createEnsResolver();
      const results = await resolver.resolveAll([]);
      expect(results.size).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// resolver instance management
// ---------------------------------------------------------------------------

import { getResolverForAccount, setResolverForAccount } from "./ens-resolver.js";

describe("resolver instance management", () => {
  beforeEach(() => {
    setResolverForAccount("test", null);
  });

  it("returns null when no resolver set", () => {
    expect(getResolverForAccount("test")).toBeNull();
  });

  it("stores and retrieves resolver by account", () => {
    const resolver = createEnsResolver();
    setResolverForAccount("test", resolver);
    expect(getResolverForAccount("test")).toBe(resolver);
  });

  it("clears resolver when set to null", () => {
    const resolver = createEnsResolver();
    setResolverForAccount("test", resolver);
    setResolverForAccount("test", null);
    expect(getResolverForAccount("test")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatting helpers
// ---------------------------------------------------------------------------

import { formatEnsContext, formatGroupMembersWithEns } from "./ens-resolver.js";

describe("formatEnsContext", () => {
  it("formats resolved names and addresses", () => {
    const resolved = new Map<string, string | null>([
      ["vitalik.eth", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
      ["0x1234567890abcdef1234567890abcdef12345678", "nick.eth"],
    ]);
    const result = formatEnsContext(resolved);
    expect(result).toContain("vitalik.eth = 0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    expect(result).toContain("nick.eth = 0x1234567890abcdef1234567890abcdef12345678");
    expect(result).toMatch(/^\[ENS Context: .+\]$/);
  });

  it("returns empty string when nothing resolved", () => {
    const resolved = new Map<string, string | null>([["unknown.eth", null]]);
    expect(formatEnsContext(resolved)).toBe("");
  });

  it("returns empty string for empty map", () => {
    expect(formatEnsContext(new Map())).toBe("");
  });
});

describe("formatGroupMembersWithEns", () => {
  it("formats members with resolved ENS names", () => {
    const members = [
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      "0x1234567890abcdef1234567890abcdef12345678",
    ];
    const resolved = new Map<string, string | null>([
      ["0xd8da6bf26964af9d7eed9e03e53415d37aa96045", "vitalik.eth"],
      ["0x1234567890abcdef1234567890abcdef12345678", null],
    ]);
    const result = formatGroupMembersWithEns(members, resolved);
    expect(result).toContain("vitalik.eth (0xd8da…6045)");
    expect(result).toContain("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("returns empty string for empty members", () => {
    expect(formatGroupMembersWithEns([], new Map())).toBe("");
  });
});
