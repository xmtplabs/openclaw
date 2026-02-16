# ENS Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add ENS name resolution to the XMTP extension so addresses are enriched with human-readable names throughout the system.

**Architecture:** A standalone `lib/ens-resolver.ts` module wraps the web3.bio API with in-memory caching. It's instantiated per-account at gateway startup and used by inbound pipeline, DM policy, outbound, and lifecycle code. The existing `GroupMembers` and `SenderName` context fields carry resolved names to the agent.

**Tech Stack:** web3.bio REST API, vitest, existing XMTP extension patterns (module-level maps, test-utils helpers)

**Design doc:** `docs/plans/2026-02-15-ens-resolution-design.md`

---

### Task 1: ENS Resolver — Pure Extraction Helpers

**Files:**

- Create: `extensions/xmtp/src/lib/ens-resolver.ts`
- Create: `extensions/xmtp/src/lib/ens-resolver.test.ts`

**Step 1: Write the failing tests for extraction helpers**

In `extensions/xmtp/src/lib/ens-resolver.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractEnsNames, extractEthAddresses, isEnsName, isEthAddress } from "./ens-resolver.js";

describe("isEnsName", () => {
  it("returns true for simple .eth name", () => {
    expect(isEnsName("nick.eth")).toBe(true);
  });

  it("returns true for subdomain .eth name", () => {
    expect(isEnsName("pay.nick.eth")).toBe(true);
  });

  it("returns false for bare string", () => {
    expect(isEnsName("nick")).toBe(false);
  });

  it("returns false for ethereum address", () => {
    expect(isEnsName("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isEnsName("")).toBe(false);
  });
});

describe("isEthAddress", () => {
  it("returns true for valid checksum address", () => {
    expect(isEthAddress("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")).toBe(true);
  });

  it("returns true for lowercase address", () => {
    expect(isEthAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045")).toBe(true);
  });

  it("returns false for short hex", () => {
    expect(isEthAddress("0xd8da6b")).toBe(false);
  });

  it("returns false for ENS name", () => {
    expect(isEthAddress("vitalik.eth")).toBe(false);
  });
});

describe("extractEnsNames", () => {
  it("extracts .eth names from text", () => {
    expect(extractEnsNames("send 1 ETH to nick.eth please")).toEqual(["nick.eth"]);
  });

  it("extracts multiple names", () => {
    const result = extractEnsNames("nick.eth and vitalik.eth are friends");
    expect(result).toEqual(["nick.eth", "vitalik.eth"]);
  });

  it("extracts subdomain names", () => {
    expect(extractEnsNames("check pay.nick.eth")).toEqual(["pay.nick.eth"]);
  });

  it("deduplicates", () => {
    expect(extractEnsNames("nick.eth sent to nick.eth")).toEqual(["nick.eth"]);
  });

  it("returns empty array for no matches", () => {
    expect(extractEnsNames("no names here")).toEqual([]);
  });

  it("filters parent when subdomain present", () => {
    const result = extractEnsNames("pay.nick.eth and nick.eth");
    expect(result).toEqual(["pay.nick.eth"]);
  });
});

describe("extractEthAddresses", () => {
  it("extracts addresses from text", () => {
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(extractEthAddresses(`send to ${addr}`)).toEqual([addr]);
  });

  it("extracts multiple addresses", () => {
    const a1 = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    const a2 = "0x1234567890abcdef1234567890abcdef12345678";
    expect(extractEthAddresses(`${a1} and ${a2}`)).toEqual([a1, a2]);
  });

  it("deduplicates", () => {
    const addr = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
    expect(extractEthAddresses(`${addr} ${addr}`)).toEqual([addr]);
  });

  it("returns empty for no matches", () => {
    expect(extractEthAddresses("no addresses")).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: FAIL — module not found

**Step 3: Write the extraction helpers**

In `extensions/xmtp/src/lib/ens-resolver.ts`:

```typescript
/**
 * ENS name resolution via web3.bio API with in-memory caching.
 */

// ---------------------------------------------------------------------------
// Pure helpers (no network)
// ---------------------------------------------------------------------------

/** Check if a string looks like an ENS name (e.g. nick.eth, pay.nick.eth). */
export function isEnsName(s: string): boolean {
  return /^[\w.-]+\.eth$/i.test(s);
}

/** Check if a string is a valid Ethereum address (0x + 40 hex chars). */
export function isEthAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

/** Extract ENS names from message text. Deduplicates and filters parents when subdomains are present. */
export function extractEnsNames(text: string): string[] {
  const matches = text.match(/\b[\w-]+(?:\.[\w-]+)*\.eth\b/g);
  if (!matches) return [];
  const unique = [...new Set(matches)];
  // Filter out parent domains when subdomains exist
  return unique.filter(
    (name) => !unique.some((other) => other !== name && other.endsWith(`.${name}`)),
  );
}

/** Extract Ethereum addresses (0x + 40 hex) from message text. Deduplicates. */
export function extractEthAddresses(text: string): string[] {
  const matches = text.match(/\b0x[0-9a-fA-F]{40}\b/g);
  if (!matches) return [];
  return [...new Set(matches)];
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/lib/ens-resolver.ts extensions/xmtp/src/lib/ens-resolver.test.ts
git commit -m "feat(xmtp): add ENS extraction helpers (isEnsName, isEthAddress, extractEnsNames, extractEthAddresses)"
```

---

### Task 2: ENS Resolver — API Resolution with Caching

**Files:**

- Modify: `extensions/xmtp/src/lib/ens-resolver.ts`
- Modify: `extensions/xmtp/src/lib/ens-resolver.test.ts`

**Step 1: Write failing tests for the resolver**

Append to `extensions/xmtp/src/lib/ens-resolver.test.ts`:

```typescript
import { vi, beforeEach } from "vitest";
import { createEnsResolver } from "./ens-resolver.js";

// Update the import at top to include vi, beforeEach

describe("createEnsResolver", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  function mockFetchResponse(body: unknown, ok = true) {
    mockFetch.mockResolvedValueOnce({
      ok,
      json: async () => body,
    });
  }

  describe("resolveEnsName (forward: name → address)", () => {
    it("resolves an ENS name to an address", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });

      const result = await resolver.resolveEnsName("vitalik.eth");

      expect(result).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.web3.bio/ns/ens/vitalik.eth",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("returns null on API failure", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({}, false);

      const result = await resolver.resolveEnsName("nonexistent.eth");

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      const resolver = createEnsResolver();
      mockFetch.mockRejectedValueOnce(new Error("network error"));

      const result = await resolver.resolveEnsName("broken.eth");

      expect(result).toBeNull();
    });

    it("passes API key header when configured", async () => {
      const resolver = createEnsResolver("my-api-key");
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });

      await resolver.resolveEnsName("vitalik.eth");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-KEY": "Bearer my-api-key",
          }),
        }),
      );
    });

    it("omits API key header when not configured", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      });

      await resolver.resolveEnsName("vitalik.eth");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-API-KEY"]).toBeUndefined();
    });
  });

  describe("resolveAddress (reverse: address → name)", () => {
    it("resolves an address to an ENS name", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        name: "vitalik.eth",
      });

      const result = await resolver.resolveAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

      expect(result).toBe("vitalik.eth");
    });

    it("returns null when no name found", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({}, false);

      const result = await resolver.resolveAddress("0x0000000000000000000000000000000000000000");

      expect(result).toBeNull();
    });
  });

  describe("caching", () => {
    it("caches forward resolution results", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });

      await resolver.resolveEnsName("vitalik.eth");
      const result = await resolver.resolveEnsName("vitalik.eth");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
    });

    it("populates reverse cache from forward resolution", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });

      await resolver.resolveEnsName("vitalik.eth");
      const result = await resolver.resolveAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBe("vitalik.eth");
    });

    it("expires cache entries after TTL", async () => {
      vi.useFakeTimers();
      const resolver = createEnsResolver();
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });

      await resolver.resolveEnsName("vitalik.eth");
      vi.advanceTimersByTime(5 * 60 * 1000 + 1); // 5 min + 1ms
      await resolver.resolveEnsName("vitalik.eth");

      expect(mockFetch).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe("resolveAll", () => {
    it("batch-resolves mixed names and addresses", async () => {
      const resolver = createEnsResolver();
      // Forward: name → address
      mockFetchResponse({
        address: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
        identity: "vitalik.eth",
      });
      // Reverse: address → name
      mockFetchResponse({
        address: "0x1234567890abcdef1234567890abcdef12345678",
        name: "nick.eth",
      });

      const result = await resolver.resolveAll([
        "vitalik.eth",
        "0x1234567890abcdef1234567890abcdef12345678",
      ]);

      expect(result.get("vitalik.eth")).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
      expect(result.get("0x1234567890abcdef1234567890abcdef12345678")).toBe("nick.eth");
    });

    it("returns null for unresolvable identifiers", async () => {
      const resolver = createEnsResolver();
      mockFetchResponse({}, false);

      const result = await resolver.resolveAll(["unknown.eth"]);

      expect(result.get("unknown.eth")).toBeNull();
    });

    it("returns empty map for empty input", async () => {
      const resolver = createEnsResolver();

      const result = await resolver.resolveAll([]);

      expect(result.size).toBe(0);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: FAIL — createEnsResolver not exported

**Step 3: Implement the resolver**

Append to `extensions/xmtp/src/lib/ens-resolver.ts`:

```typescript
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnsResolver = {
  resolveEnsName: (name: string) => Promise<string | null>;
  resolveAddress: (address: string) => Promise<string | null>;
  resolveAll: (identifiers: string[]) => Promise<Map<string, string | null>>;
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

type CacheEntry = { value: string | null; expiresAt: number };

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Resolver factory
// ---------------------------------------------------------------------------

const WEB3_BIO_NS_URL = "https://api.web3.bio/ns/ens";

export function createEnsResolver(apiKey?: string): EnsResolver {
  const cache = new Map<string, CacheEntry>();

  function getCached(key: string): string | null | undefined {
    const entry = cache.get(key.toLowerCase());
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      cache.delete(key.toLowerCase());
      return undefined;
    }
    return entry.value;
  }

  function setCache(key: string, value: string | null): void {
    cache.set(key.toLowerCase(), { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  function buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) {
      headers["X-API-KEY"] = `Bearer ${apiKey}`;
    }
    return headers;
  }

  async function resolveEnsName(name: string): Promise<string | null> {
    const cached = getCached(name);
    if (cached !== undefined) return cached;

    try {
      const response = await fetch(`${WEB3_BIO_NS_URL}/${encodeURIComponent(name)}`, {
        method: "GET",
        headers: buildHeaders(),
      });
      if (!response.ok) {
        setCache(name, null);
        return null;
      }
      const data = (await response.json()) as { address?: string; identity?: string };
      const address = data.address ?? null;
      setCache(name, address);
      // Bidirectional: also cache reverse
      if (address) {
        setCache(address, data.identity ?? name);
      }
      return address;
    } catch {
      setCache(name, null);
      return null;
    }
  }

  async function resolveAddress(address: string): Promise<string | null> {
    const cached = getCached(address);
    if (cached !== undefined) return cached;

    try {
      const response = await fetch(`${WEB3_BIO_NS_URL}/${encodeURIComponent(address)}`, {
        method: "GET",
        headers: buildHeaders(),
      });
      if (!response.ok) {
        setCache(address, null);
        return null;
      }
      const data = (await response.json()) as { address?: string; name?: string };
      const name = data.name ?? null;
      setCache(address, name);
      // Bidirectional: also cache forward
      if (name) {
        setCache(name, data.address ?? address);
      }
      return name;
    } catch {
      setCache(address, null);
      return null;
    }
  }

  async function resolveAll(identifiers: string[]): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    if (identifiers.length === 0) return results;

    await Promise.all(
      identifiers.map(async (id) => {
        if (isEnsName(id)) {
          results.set(id, await resolveEnsName(id));
        } else if (isEthAddress(id)) {
          results.set(id, await resolveAddress(id));
        } else {
          results.set(id, null);
        }
      }),
    );

    return results;
  }

  return { resolveEnsName, resolveAddress, resolveAll };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/lib/ens-resolver.ts extensions/xmtp/src/lib/ens-resolver.test.ts
git commit -m "feat(xmtp): add ENS resolver with web3.bio API integration and caching"
```

---

### Task 3: ENS Resolver — Instance Management

**Files:**

- Modify: `extensions/xmtp/src/lib/ens-resolver.ts`
- Modify: `extensions/xmtp/src/lib/ens-resolver.test.ts`

**Step 1: Write failing tests for instance management**

Append to `extensions/xmtp/src/lib/ens-resolver.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: FAIL — getResolverForAccount not exported

**Step 3: Add instance management to ens-resolver.ts**

Append to `extensions/xmtp/src/lib/ens-resolver.ts`:

```typescript
// ---------------------------------------------------------------------------
// Per-account resolver storage (mirrors outbound.ts agent pattern)
// ---------------------------------------------------------------------------

const resolvers = new Map<string, EnsResolver>();

export function getResolverForAccount(accountId: string): EnsResolver | null {
  return resolvers.get(accountId) ?? null;
}

export function setResolverForAccount(accountId: string, resolver: EnsResolver | null): void {
  if (resolver) {
    resolvers.set(accountId, resolver);
  } else {
    resolvers.delete(accountId);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/lib/ens-resolver.ts extensions/xmtp/src/lib/ens-resolver.test.ts
git commit -m "feat(xmtp): add per-account ENS resolver instance management"
```

---

### Task 4: Configuration — Add web3BioApiKey

**Files:**

- Modify: `extensions/xmtp/src/config-types.ts:9-42` (add field to XMTPAccountConfig)
- Modify: `extensions/xmtp/src/config-schema.ts:14-65` (add to Zod schema)

**Step 1: Add to config-types.ts**

Add after the `ownerAddress` field (line 41):

```typescript
  /** web3.bio API key for ENS resolution (optional, improves rate limits). */
  web3BioApiKey?: string;
```

**Step 2: Add to config-schema.ts**

Add after the `ownerAddress` field (line 64):

```typescript
  /** web3.bio API key for ENS resolution. */
  web3BioApiKey: z.string().optional(),
```

**Step 3: Run existing tests to verify nothing breaks**

Run: `npx vitest run extensions/xmtp/src/`
Expected: All existing tests still PASS

**Step 4: Commit**

```bash
git add extensions/xmtp/src/config-types.ts extensions/xmtp/src/config-schema.ts
git commit -m "feat(xmtp): add web3BioApiKey config field for ENS resolution"
```

---

### Task 5: Onboarding — Accept ENS Names for ownerAddress

**Files:**

- Modify: `extensions/xmtp/src/onboarding.ts:167-176` (update validator)

**Step 1: Update the ownerAddress validator**

Import `isEnsName` and update the validator. Change lines 167-176 in `onboarding.ts`:

```typescript
import { isEnsName } from "./lib/ens-resolver.js";
```

Update the validator:

```typescript
const ownerAddr = await prompter.text({
  message: "Owner wallet address or ENS name (auto-paired, press Enter to skip)",
  placeholder: "0x... or name.eth",
  validate: (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return undefined; // optional
    if (isEnsName(raw)) return undefined; // ENS name accepted
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return "Invalid Ethereum address or ENS name";
    return undefined;
  },
});
```

**Step 2: Run existing tests to verify nothing breaks**

Run: `npx vitest run extensions/xmtp/src/`
Expected: All PASS

**Step 3: Commit**

```bash
git add extensions/xmtp/src/onboarding.ts
git commit -m "feat(xmtp): accept ENS names for ownerAddress in onboarding"
```

---

### Task 6: Gateway Lifecycle — Create Resolver at Startup, Resolve ownerAddress

**Files:**

- Modify: `extensions/xmtp/src/gateway-lifecycle.ts:49-113` (startAccount) and `gateway-lifecycle.ts:33-43` (stopAgent)
- Modify: `extensions/xmtp/src/gateway-lifecycle.test.ts` (add tests)

**Step 1: Write failing tests**

Add a new describe block in `gateway-lifecycle.test.ts`:

```typescript
import { getResolverForAccount, setResolverForAccount, isEnsName } from "./lib/ens-resolver.js";
```

```typescript
describe("ENS resolution at startup", () => {
  beforeEach(() => {
    setResolverForAccount("default", null);
  });

  it("creates and stores ENS resolver on startup", async () => {
    // After startAccount, a resolver should be stored for the account
    // (test by checking getResolverForAccount after start)
    // This test needs the existing startAccount mock setup pattern
  });

  it("resolves ENS ownerAddress before creating DM", async () => {
    // When ownerAddress is "nick.eth", it should resolve to an address
    // before calling createDmWithAddress
  });

  it("clears resolver on stop", async () => {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);

    await stopAgent("default");

    expect(getResolverForAccount("default")).toBeNull();
  });
});
```

Note: Adapt these tests to match the existing test patterns in `gateway-lifecycle.test.ts`. The exact mock setup will follow the existing patterns (vi.mock for modules, makeFakeAgent for the agent).

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/gateway-lifecycle.test.ts`
Expected: FAIL

**Step 3: Modify startAccount in gateway-lifecycle.ts**

Add imports:

```typescript
import {
  createEnsResolver,
  getResolverForAccount,
  setResolverForAccount,
  isEnsName,
} from "./lib/ens-resolver.js";
```

In `startAccount`, after `createAgentFromAccount` and before `backfillPublicAddress`:

```typescript
// Create ENS resolver for this account
const ensResolver = createEnsResolver(account.config.web3BioApiKey);
setResolverForAccount(account.accountId, ensResolver);
```

Replace the ownerAddress DM creation block (around lines 95-102):

```typescript
if (account.ownerAddress) {
  try {
    let ownerAddr = account.ownerAddress;
    if (isEnsName(ownerAddr)) {
      const resolved = await ensResolver.resolveEnsName(ownerAddr);
      if (resolved) {
        ownerAddr = resolved;
        log?.info(
          `[${account.accountId}] Resolved owner ENS ${account.ownerAddress} → ${ownerAddr.slice(0, 12)}...`,
        );
      } else {
        log?.warn?.(`[${account.accountId}] Could not resolve owner ENS: ${account.ownerAddress}`);
      }
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(ownerAddr)) {
      await agent.createDmWithAddress(ownerAddr as `0x${string}`);
      log?.info(`[${account.accountId}] Owner DM ready (${ownerAddr.slice(0, 12)}...)`);
    }
  } catch (err) {
    log?.warn?.(`[${account.accountId}] Could not create owner DM: ${String(err)}`);
  }
}
```

In `stopAgent`, add resolver cleanup:

```typescript
export async function stopAgent(accountId: string, log?: RuntimeLogger): Promise<void> {
  setResolverForAccount(accountId, null); // Clean up resolver
  const agent = getClientForAccount(accountId);
  // ... rest unchanged
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/gateway-lifecycle.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/gateway-lifecycle.ts extensions/xmtp/src/gateway-lifecycle.test.ts
git commit -m "feat(xmtp): create ENS resolver at startup, resolve ownerAddress ENS names"
```

---

### Task 7: DM Policy — Resolve ENS Names in ownerAddress and allowFrom

**Files:**

- Modify: `extensions/xmtp/src/dm-policy.ts:50-100` (evaluateDmAccess)
- Modify: `extensions/xmtp/src/dm-policy.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `dm-policy.test.ts`:

```typescript
import { setResolverForAccount, createEnsResolver } from "./lib/ens-resolver.js";
import { vi, beforeEach } from "vitest";

describe("ENS resolution in evaluateDmAccess", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    setResolverForAccount("default", null);
  });

  function mockResolve(name: string, address: string) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ address, identity: name }),
    });
  }

  it("allows sender when ownerAddress is an ENS name that resolves to sender", async () => {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);
    mockResolve("owner.eth", TEST_SENDER_ADDRESS);

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "pairing",
      ownerAddress: "owner.eth",
    });
    const { runtime } = makeMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

    expect(result).toEqual({ allowed: true });
  });

  it("allows sender when allowFrom contains ENS name that resolves to sender", async () => {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);
    mockResolve("friend.eth", TEST_SENDER_ADDRESS);

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["friend.eth"],
    });
    const { runtime } = makeMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

    expect(result).toEqual({ allowed: true });
  });

  it("blocks sender when ENS name resolves to different address", async () => {
    const resolver = createEnsResolver();
    setResolverForAccount("default", resolver);
    mockResolve("other.eth", "0x0000000000000000000000000000000000000000");

    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["other.eth"],
    });
    const { runtime } = makeMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

    expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
  });

  it("works without resolver (graceful degradation)", async () => {
    // No resolver set — ENS names in allowFrom simply don't match
    const account = createTestAccount({
      address: TEST_OWNER_ADDRESS,
      dmPolicy: "allowlist",
      allowFrom: ["friend.eth"],
    });
    const { runtime } = makeMockRuntime();

    const result = await evaluateDmAccess({ account, sender: TEST_SENDER_ADDRESS, runtime });

    expect(result).toEqual({ allowed: false, reason: "blocked", dmPolicy: "allowlist" });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/dm-policy.test.ts`
Expected: FAIL — ENS names not resolved

**Step 3: Modify evaluateDmAccess in dm-policy.ts**

Add imports:

```typescript
import { getResolverForAccount, isEnsName } from "./lib/ens-resolver.js";
```

Update `evaluateDmAccess` to resolve ENS names. After the `dmPolicy === "disabled"` check:

For the owner check (around lines 69-74), wrap with ENS resolution:

```typescript
if (account.ownerAddress) {
  let ownerAddr = normalizeXmtpAddress(account.ownerAddress);
  if (isEnsName(ownerAddr)) {
    const resolver = getResolverForAccount(account.accountId);
    const resolved = resolver ? await resolver.resolveEnsName(ownerAddr) : null;
    if (resolved) ownerAddr = resolved;
  }
  if (ownerAddr && normalizedSender.toLowerCase() === ownerAddr.toLowerCase()) {
    return { allowed: true };
  }
}
```

For the allowFrom check (around lines 77-88), resolve ENS entries:

```typescript
const configAllow = (account.config.allowFrom ?? []).map((v) => String(v).trim()).filter(Boolean);
const storeAllow = await runtime.channel.pairing.readAllowFromStore(CHANNEL_ID);
const combinedAllow = [...configAllow, ...storeAllow];

// Resolve ENS names in allow list
const resolver = getResolverForAccount(account.accountId);
const resolvedAllow: string[] = [];
for (const entry of combinedAllow) {
  const normalized = normalizeXmtpAddress(entry);
  if (isEnsName(normalized) && resolver) {
    const resolved = await resolver.resolveEnsName(normalized);
    resolvedAllow.push(resolved ?? normalized);
  } else {
    resolvedAllow.push(normalized);
  }
}

const allowed =
  combinedAllow.includes("*") ||
  resolvedAllow.some((entry) => entry.toLowerCase() === normalizedSender.toLowerCase());
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/dm-policy.test.ts`
Expected: All PASS (both old and new tests)

**Step 5: Commit**

```bash
git add extensions/xmtp/src/dm-policy.ts extensions/xmtp/src/dm-policy.test.ts
git commit -m "feat(xmtp): resolve ENS names in ownerAddress and allowFrom during DM access check"
```

---

### Task 8: ENS Context Formatting Helper

**Files:**

- Modify: `extensions/xmtp/src/lib/ens-resolver.ts` (add formatEnsContext, formatGroupMembersWithEns)
- Modify: `extensions/xmtp/src/lib/ens-resolver.test.ts`

**Step 1: Write failing tests**

Append to `ens-resolver.test.ts`:

```typescript
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

    expect(result).toContain("vitalik.eth (0xd8da");
    expect(result).toContain("0x1234567890abcdef");
  });

  it("returns empty string for empty members", () => {
    expect(formatGroupMembersWithEns([], new Map())).toBe("");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: FAIL — functions not exported

**Step 3: Implement formatting helpers**

Append to `ens-resolver.ts`:

```typescript
// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format resolved ENS context as a bracketed context block for the agent.
 * Returns empty string if nothing resolved successfully.
 */
export function formatEnsContext(resolved: Map<string, string | null>): string {
  const entries: string[] = [];
  for (const [id, value] of resolved) {
    if (!value) continue;
    if (isEnsName(id)) {
      entries.push(`${id} = ${value}`);
    } else if (isEthAddress(id)) {
      entries.push(`${value} = ${id}`);
    }
  }
  if (entries.length === 0) return "";
  return `[ENS Context: ${entries.join(", ")}]`;
}

/**
 * Format group member addresses with resolved ENS names.
 * Members with names: "nick.eth (0xd8da…6045)"
 * Members without: "0xd8da6bf269…96045"
 */
export function formatGroupMembersWithEns(
  addresses: string[],
  resolved: Map<string, string | null>,
): string {
  if (addresses.length === 0) return "";
  return addresses
    .map((addr) => {
      const name = resolved.get(addr);
      if (name) return `${name} (${addr.slice(0, 6)}…${addr.slice(-4)})`;
      return addr;
    })
    .join(", ");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/lib/ens-resolver.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/lib/ens-resolver.ts extensions/xmtp/src/lib/ens-resolver.test.ts
git commit -m "feat(xmtp): add ENS context and group member formatting helpers"
```

---

### Task 9: Inbound Pipeline — ENS Context, SenderName, GroupMembers

**Files:**

- Modify: `extensions/xmtp/src/inbound-pipeline.ts:13-24` (add params) and `:61-89` (wire into context)
- Modify: `extensions/xmtp/src/inbound-pipeline.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `inbound-pipeline.test.ts`:

```typescript
describe("ENS enrichment", () => {
  it("prepends ENS context to Body when ensContext is provided", async () => {
    // Set up standard mocks (use existing test setup pattern from this file)
    // Call runInboundPipeline with ensContext: "[ENS Context: nick.eth = 0x1234...]"
    // Verify formatAgentEnvelope received body that starts with the context block
  });

  it("passes SenderName when provided", async () => {
    // Call runInboundPipeline with senderName: "nick.eth"
    // Verify finalizeInboundContext was called with SenderName: "nick.eth"
  });

  it("passes GroupMembers when provided", async () => {
    // Call runInboundPipeline with groupMembers: "nick.eth (0x1234…abcd), 0x5678..."
    // Verify finalizeInboundContext was called with GroupMembers matching
  });

  it("does not add ENS context when not provided", async () => {
    // Call runInboundPipeline without ensContext
    // Verify Body does not contain [ENS Context]
  });
});
```

Note: Adapt to match the exact test patterns in the existing `inbound-pipeline.test.ts` file, using `createMockRuntime()` and `createTestAccount()`.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run extensions/xmtp/src/inbound-pipeline.test.ts`
Expected: FAIL

**Step 3: Modify inbound-pipeline.ts**

Add new optional parameters to `runInboundPipeline`:

```typescript
export async function runInboundPipeline(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  content: string;
  messageId: string | undefined;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  media?: Array<{ path: string; contentType?: string }>;
  deliverReply: (payload: ReplyPayload) => Promise<void>;
  onDeliveryError?: (err: unknown, info: { kind: string }) => void;
  // ENS enrichment
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}): Promise<void> {
```

In the body construction (around line 62), prepend ENS context:

```typescript
const rawBody = runtime.channel.reply.formatAgentEnvelope({
  channel: "XMTP",
  from: params.senderName ?? sender.slice(0, 12),
  timestamp: Date.now(),
  previousTimestamp,
  envelope: envelopeOptions,
  body: content,
});

const body = params.ensContext ? `${params.ensContext}\n${rawBody}` : rawBody;
```

In the context payload (around line 82), add SenderName and GroupMembers:

```typescript
const ctxPayload = runtime.channel.reply.finalizeInboundContext({
  Body: body,
  RawBody: content,
  CommandBody: content,
  From: `xmtp:${sender}`,
  To: `xmtp:${conversationId}`,
  SessionKey: route.sessionKey,
  AccountId: route.accountId,
  ChatType: isDirect ? "direct" : "group",
  ConversationLabel: conversationId.slice(0, 12),
  SenderName: params.senderName,
  SenderId: sender,
  GroupMembers: params.groupMembers,
  Provider: CHANNEL_ID,
  Surface: CHANNEL_ID,
  MessageSid: messageId,
  OriginatingChannel: CHANNEL_ID,
  OriginatingTo: `xmtp:${conversationId}`,
  ...mediaPayload,
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/inbound-pipeline.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/inbound-pipeline.ts extensions/xmtp/src/inbound-pipeline.test.ts
git commit -m "feat(xmtp): wire ENS context, SenderName, GroupMembers into inbound pipeline"
```

---

### Task 10: Gateway Lifecycle Handlers — Resolve Sender, Members, Message Content

**Files:**

- Modify: `extensions/xmtp/src/gateway-lifecycle.ts:193-233` (buildTextHandler) and reaction/attachment handlers
- Modify: `extensions/xmtp/src/gateway-lifecycle.test.ts`

This is the core integration task. The handlers in `buildTextHandler`, `buildReactionHandler`, `buildAttachmentHandler`, `buildInlineAttachmentHandler`, and `buildMultiAttachmentHandler` all need to:

1. Get the ENS resolver for the account
2. Resolve the sender address to an ENS name → `senderName`
3. If group (!isDirect), get members via `conversation.members()`, extract addresses, batch-resolve → `groupMembers`
4. Extract ENS names and addresses from content, resolve → `ensContext`
5. Pass `senderName`, `groupMembers`, `ensContext` to the `handleInbound*` functions

**Step 1: Write failing tests**

Add to `gateway-lifecycle.test.ts`, testing that `buildTextHandler` passes ENS context through:

```typescript
describe("ENS enrichment in text handler", () => {
  it("resolves sender address to ENS name", async () => {
    // Mock resolver, set it for account
    // Build text handler, call it with a message
    // Verify handleInboundMessage was called with senderName
  });

  it("resolves group members when not direct", async () => {
    // Mock conversation.members() to return member list
    // Verify handleInboundMessage was called with groupMembers
  });

  it("extracts and resolves ENS names from message content", async () => {
    // Send message containing "send to vitalik.eth"
    // Verify ensContext is passed through
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Implement ENS resolution in handlers**

Create a shared helper in `gateway-lifecycle.ts` to avoid repeating resolution logic across all handlers:

```typescript
import {
  getResolverForAccount,
  extractEnsNames,
  extractEthAddresses,
  formatEnsContext,
  formatGroupMembersWithEns,
  type EnsResolver,
} from "./lib/ens-resolver.js";
import type { Identifier } from "@xmtp/agent-sdk";
```

```typescript
/** Resolve ENS context for an inbound message. */
async function resolveInboundEns(params: {
  accountId: string;
  sender: string;
  content: string;
  isDirect: boolean;
  conversation?: {
    members?: () => Promise<
      Array<{ accountIdentifiers: Array<{ identifier: string; identifierKind: unknown }> }>
    >;
  };
  log?: RuntimeLogger;
}): Promise<{
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}> {
  const resolver = getResolverForAccount(params.accountId);
  if (!resolver) return {};

  const result: { senderName?: string; groupMembers?: string; ensContext?: string } = {};

  // Resolve sender
  const senderName = await resolver.resolveAddress(params.sender);
  if (senderName) result.senderName = senderName;

  // Resolve message content
  const names = extractEnsNames(params.content);
  const addresses = extractEthAddresses(params.content);
  const identifiers = [...names, ...addresses];
  if (identifiers.length > 0) {
    const resolved = await resolver.resolveAll(identifiers);
    const context = formatEnsContext(resolved);
    if (context) result.ensContext = context;
  }

  // Resolve group members
  if (!params.isDirect && params.conversation?.members) {
    try {
      const members = await params.conversation.members();
      const memberAddresses = members
        .flatMap((m) => m.accountIdentifiers)
        .filter((id) => typeof id.identifier === "string" && /^0x/i.test(id.identifier))
        .map((id) => id.identifier);
      if (memberAddresses.length > 0) {
        const resolved = await resolver.resolveAll(memberAddresses);
        const formatted = formatGroupMembersWithEns(memberAddresses, resolved);
        if (formatted) result.groupMembers = formatted;
      }
    } catch (err) {
      params.log?.warn?.(`ENS group member resolution failed: ${String(err)}`);
    }
  }

  return result;
}
```

Then in `buildTextHandler`, after getting the sender address:

```typescript
const ens = await resolveInboundEns({
  accountId: account.accountId,
  sender,
  content,
  isDirect,
  conversation,
  log,
});

handleInboundMessage({
  account,
  sender,
  conversationId,
  content,
  messageId: msgCtx.message.id,
  isDirect,
  runtime,
  log,
  ...ens,
}).catch((err) => {
  log?.error(`[${account.accountId}] Message handling failed: ${String(err)}`);
});
```

Apply the same pattern to `buildReactionHandler`, `buildAttachmentHandler`, `buildInlineAttachmentHandler`, and `buildMultiAttachmentHandler`.

**Step 4: Update handleInbound\* signatures in channel.ts**

The `handleInboundMessage`, `handleInboundReaction`, `handleInboundAttachment`, `handleInboundInlineAttachment` functions in `channel.ts` need to accept and pass through `senderName`, `groupMembers`, `ensContext`:

```typescript
export async function handleInboundMessage(params: {
  // ... existing params
  senderName?: string;
  groupMembers?: string;
  ensContext?: string;
}) {
  // ... in the runInboundPipeline call:
  await runInboundPipeline({
    // ... existing params
    senderName: params.senderName,
    groupMembers: params.groupMembers,
    ensContext: params.ensContext,
  });
}
```

Same for `handleInboundReaction`, `handleInboundAttachment`, `handleInboundInlineAttachment`.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/`
Expected: All PASS

**Step 6: Commit**

```bash
git add extensions/xmtp/src/gateway-lifecycle.ts extensions/xmtp/src/channel.ts extensions/xmtp/src/gateway-lifecycle.test.ts
git commit -m "feat(xmtp): resolve ENS for sender, group members, and message content on inbound"
```

---

### Task 11: Agent Prompt — ENS Instructions

**Files:**

- Modify: `extensions/xmtp/src/channel.ts:553-573` (agentPrompt.messageToolHints)

**Step 1: Update messageToolHints**

In `channel.ts`, update the `agentPrompt.messageToolHints` function:

```typescript
  agentPrompt: {
    messageToolHints: ({ cfg, accountId }) => {
      const hints = [
        "- XMTP targets are wallet addresses, ENS names, or conversation topics. Use `to=<address or name.eth>` for `action=send`.",
        "- When ENS names are available (in SenderName, GroupMembers, or [ENS Context] blocks), always refer to users by their ENS name (e.g., nick.eth) rather than raw Ethereum addresses.",
        "- Use `action=react` with `to=<conversation>`, `messageId=<id>`, and `emoji=<emoji>` to react to messages.",
      ];
      // ... rest of existing hints (media check)
    },
  },
```

**Step 2: Update messaging target resolver**

In `channel.ts`, update `looksLikeId` in the `messaging.targetResolver`:

```typescript
  messaging: {
    normalizeTarget: normalizeXmtpMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const t = raw.trim();
        if (!t) return false;
        if (t.length === 42 && /^0x[0-9a-fA-F]{40}$/.test(t)) return true;
        if (isEnsName(t)) return true;
        return false;
      },
      hint: "<address, ENS name, or conversation topic>",
    },
  },
```

Add the import for `isEnsName`:

```typescript
import { isEnsName } from "./lib/ens-resolver.js";
```

**Step 3: Run tests**

Run: `npx vitest run extensions/xmtp/src/`
Expected: All PASS

**Step 4: Commit**

```bash
git add extensions/xmtp/src/channel.ts
git commit -m "feat(xmtp): add ENS-aware agent prompt hints and target resolution"
```

---

### Task 12: Outbound — Resolve ENS Targets Before Sending

**Files:**

- Modify: `extensions/xmtp/src/outbound.ts:129-141` (sendText) and `outbound.ts:143-185` (sendMedia)
- Modify: `extensions/xmtp/src/outbound.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `outbound.test.ts`:

```typescript
describe("ENS resolution for outbound", () => {
  it("resolves ENS name to address before sending text", async () => {
    // Set up resolver for account with mock
    // Call sendText with to: "nick.eth"
    // Verify createDmWithAddress was called with resolved address
  });

  it("resolves ENS name to address before sending media", async () => {
    // Similar to above for sendMedia
  });

  it("falls back gracefully when ENS resolution fails", async () => {
    // Set up resolver that returns null
    // Call sendText with to: "unknown.eth"
    // Verify it tries the original value or throws a sensible error
  });
});
```

**Step 2: Run tests to verify they fail**

**Step 3: Modify outbound.ts**

Add imports:

```typescript
import { getResolverForAccount, isEnsName } from "./lib/ens-resolver.js";
```

Add a helper:

```typescript
/** Resolve an ENS name to an address if applicable. */
async function resolveOutboundTarget(to: string, accountId: string): Promise<string> {
  if (!isEnsName(to)) return to;
  const resolver = getResolverForAccount(accountId);
  if (!resolver) return to;
  const resolved = await resolver.resolveEnsName(to);
  return resolved ?? to;
}
```

In `sendText`, before the conversation lookup:

```typescript
  sendText: async ({ cfg, to, text, accountId }) => {
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId });
    const agent = getAgentOrThrow(account.accountId);
    const target = await resolveOutboundTarget(to, account.accountId);
    let conversation = await agent.client.conversations.getConversationById(target);
    if (!conversation && target.startsWith("0x")) {
      conversation = await agent.createDmWithAddress(target as `0x${string}`);
    }
    // ... rest unchanged but use `target` instead of `to`
```

Same pattern for `sendMedia`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run extensions/xmtp/src/outbound.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add extensions/xmtp/src/outbound.ts extensions/xmtp/src/outbound.test.ts
git commit -m "feat(xmtp): resolve ENS names for outbound message targets"
```

---

### Task 13: Full Integration Verification

**Files:** None (test-only)

**Step 1: Run all XMTP extension tests**

Run: `npx vitest run extensions/xmtp/src/`
Expected: All PASS

**Step 2: Run the full test suite**

Run: `npm test`
Expected: All PASS

**Step 3: Type check**

Run: `npx tsc --noEmit` (or the project's type-check command)
Expected: No errors

**Step 4: Lint**

Run: `npm run lint` (or equivalent)
Expected: Clean

**Step 5: Commit any fixes needed from verification**

If any fixes were needed:

```bash
git add -A
git commit -m "fix(xmtp): address lint/type issues in ENS resolution"
```
