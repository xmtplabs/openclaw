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
