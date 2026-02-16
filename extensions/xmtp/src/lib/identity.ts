/**
 * XMTP identity helpers: key generation and wallet address derivation.
 */

import { webcrypto } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export function generateEncryptionKeyHex(): string {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("hex");
}

/** Re-export for onboarding key generation. */
export { generatePrivateKey };

/**
 * Derive Ethereum wallet address from a private key (hex, with or without 0x).
 */
export function walletAddressFromPrivateKey(walletKey: string): string {
  const hexKey = walletKey.startsWith("0x") ? walletKey : `0x${walletKey}`;
  return privateKeyToAccount(hexKey as `0x${string}`).address;
}
