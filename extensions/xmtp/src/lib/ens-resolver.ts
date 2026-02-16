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
  const matches = text.match(/\b[\w-]+(?:\.[\w-]+)*\.eth\b/gi);
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

// ---------------------------------------------------------------------------
// ENS Resolver — web3.bio API with caching & retry
// ---------------------------------------------------------------------------

export type EnsResolver = {
  resolveEnsName: (name: string) => Promise<string | null>;
  resolveAddress: (address: string) => Promise<string | null>;
  resolveAll: (identifiers: string[]) => Promise<Map<string, string | null>>;
};

const API_BASE = "https://api.web3.bio/ns/ens";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_RETRIES = 3;
const RETRY_DELAYS = [100, 200, 400];

type CacheEntry = { value: string | null; expiresAt: number };

/**
 * Create an ENS resolver that wraps the web3.bio API.
 *
 * - Retries up to 3 times with exponential backoff on failure.
 * - Caches results in memory for 5 minutes (bidirectional).
 * - Fails open: never throws — returns null on unresolvable names.
 */
export function createEnsResolver(apiKey?: string): EnsResolver {
  const cache = new Map<string, CacheEntry>();

  const headers: Record<string, string> = apiKey ? { "X-API-KEY": `Bearer ${apiKey}` } : {};

  // -- Cache helpers --------------------------------------------------------

  function cacheGet(key: string): string | null | undefined {
    const entry = cache.get(key.toLowerCase());
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      cache.delete(key.toLowerCase());
      return undefined;
    }
    return entry.value;
  }

  function cacheSet(key: string, value: string | null): void {
    cache.set(key.toLowerCase(), {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }

  // -- Fetch with retry -----------------------------------------------------

  async function fetchWithRetry(url: string): Promise<Record<string, unknown> | null> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            continue;
          }
          return null;
        }
        return (await response.json()) as Record<string, unknown>;
      } catch {
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        return null;
      }
    }
    return null;
  }

  // -- Public API -----------------------------------------------------------

  async function resolveEnsName(name: string): Promise<string | null> {
    const cached = cacheGet(name);
    if (cached !== undefined) return cached;

    const data = await fetchWithRetry(`${API_BASE}/${name}`);
    if (data === null) {
      // Network/retry failure — do NOT cache so next call retries.
      return null;
    }

    const address = typeof data.address === "string" ? data.address : null;
    // Cache forward: name -> address
    cacheSet(name, address);
    // Bidirectional: cache reverse too when we have both values
    if (address) {
      cacheSet(address, name);
    }
    return address;
  }

  async function resolveAddress(address: string): Promise<string | null> {
    const cached = cacheGet(address);
    if (cached !== undefined) return cached;

    const data = await fetchWithRetry(`${API_BASE}/${address}`);
    if (data === null) {
      return null;
    }

    const name = typeof data.name === "string" ? data.name : null;
    // Cache reverse: address -> name
    cacheSet(address, name);
    // Bidirectional: cache forward too
    if (name) {
      cacheSet(name, address);
    }
    return name;
  }

  async function resolveAll(identifiers: string[]): Promise<Map<string, string | null>> {
    if (identifiers.length === 0) return new Map();

    const entries = await Promise.all(
      identifiers.map(async (id): Promise<[string, string | null]> => {
        if (isEnsName(id)) {
          return [id, await resolveEnsName(id)];
        }
        if (isEthAddress(id)) {
          return [id, await resolveAddress(id)];
        }
        // Unrecognised format — try forward resolution as a fallback
        return [id, await resolveEnsName(id)];
      }),
    );

    return new Map(entries);
  }

  return { resolveEnsName, resolveAddress, resolveAll };
}
