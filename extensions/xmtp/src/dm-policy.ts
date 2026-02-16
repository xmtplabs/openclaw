/**
 * XMTP DM and group access control.
 * Pure policy evaluation separated from side effects (pairing replies).
 */

import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk";
import type { ResolvedXmtpAccount } from "./accounts.js";
import { getResolverForAccount, isEnsName } from "./lib/ens-resolver.js";
import { getClientForAccount } from "./outbound.js";

const CHANNEL_ID = "xmtp";

// ---------------------------------------------------------------------------
// Address normalization
// ---------------------------------------------------------------------------

export function normalizeXmtpAddress(raw: string): string {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("xmtp:")) {
    s = s.slice("xmtp:".length).trim();
  }
  return s;
}

// ---------------------------------------------------------------------------
// Group policy
// ---------------------------------------------------------------------------

export function isGroupAllowed(params: {
  account: ResolvedXmtpAccount;
  conversationId: string;
}): boolean {
  const { account, conversationId } = params;
  const policy = account.config.groupPolicy ?? "open";
  if (policy === "open") return true;
  if (policy === "disabled") return false;
  const groups = account.config.groups ?? [];
  return groups.includes("*") || groups.includes(conversationId);
}

// ---------------------------------------------------------------------------
// DM policy evaluation (pure — no side effects)
// ---------------------------------------------------------------------------

export type DmAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "disabled" }
  | { allowed: false; reason: "blocked"; dmPolicy: string }
  | { allowed: false; reason: "pairing"; code: string | undefined; created: boolean };

export async function evaluateDmAccess(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  runtime: PluginRuntime;
}): Promise<DmAccessDecision> {
  const { account, sender, runtime } = params;
  const dmPolicy = account.config.dmPolicy ?? "pairing";

  if (dmPolicy === "open") {
    return { allowed: true };
  }

  if (dmPolicy === "disabled") {
    return { allowed: false, reason: "disabled" };
  }

  const normalizedSender = normalizeXmtpAddress(sender);

  // Owner is always allowed (unless DMs are fully disabled)
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

  // "pairing" or "allowlist" — check combined allow lists
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

  if (allowed) {
    return { allowed: true };
  }

  if (dmPolicy === "pairing") {
    const { code, created } = await runtime.channel.pairing.upsertPairingRequest({
      channel: CHANNEL_ID,
      id: sender,
      meta: { address: sender },
    });
    return { allowed: false, reason: "pairing", code, created };
  }

  return { allowed: false, reason: "blocked", dmPolicy };
}

// ---------------------------------------------------------------------------
// Pairing reply (side effect, isolated for testability)
// ---------------------------------------------------------------------------

export async function sendPairingReply(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  code: string;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
}): Promise<void> {
  const { account, sender, conversationId, code, runtime, log } = params;
  try {
    const reply = runtime.channel.pairing.buildPairingReply({
      channel: CHANNEL_ID,
      idLine: `Your address: ${sender}`,
      code,
    });
    const agent = getClientForAccount(account.accountId);
    if (agent) {
      const conversation = await agent.client.conversations.getConversationById(conversationId);
      if (conversation) {
        await conversation.sendText(reply);
      }
    }
  } catch (err) {
    log?.error(
      `[${account.accountId}] Pairing reply failed for ${sender.slice(0, 12)}: ${String(err)}`,
    );
  }
}
