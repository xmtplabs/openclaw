/**
 * Inbound access control for XMTP messages.
 * Consolidates the group + DM policy checks used by all inbound handlers.
 */

import type { PluginRuntime, RuntimeLogger } from "openclaw/plugin-sdk";
import type { ResolvedXmtpAccount } from "../accounts.js";
import { evaluateDmAccess, isGroupAllowed, sendPairingReply } from "../dm-policy.js";

/**
 * Enforce inbound access control for a message/reaction/attachment.
 *
 * Returns `true` if the message should be processed, `false` if it should be dropped.
 *
 * Handles:
 * - Group allowlist filtering (for non-DM conversations)
 * - DM policy evaluation (open / disabled / allowlist / pairing)
 * - Sending pairing replies for first-time DM senders
 */
export async function enforceInboundAccessControl(params: {
  account: ResolvedXmtpAccount;
  sender: string;
  conversationId: string;
  isDirect: boolean;
  runtime: PluginRuntime;
  log?: RuntimeLogger;
  /** Label for log messages (e.g. "message", "reaction", "attachment"). */
  label?: string;
}): Promise<boolean> {
  const { account, sender, conversationId, isDirect, runtime, log } = params;
  const label = params.label ?? "message";

  // Group access control
  if (!isDirect && !isGroupAllowed({ account, conversationId })) {
    if (account.debug) {
      log?.info(
        `[${account.accountId}] Dropped ${label} from disallowed conversation ${conversationId.slice(0, 12)}`,
      );
    }
    return false;
  }

  // DM access control
  if (isDirect) {
    const decision = await evaluateDmAccess({ account, sender, runtime });
    if (!decision.allowed) {
      if (decision.reason === "pairing" && decision.created && decision.code) {
        await sendPairingReply({
          account,
          sender,
          conversationId,
          code: decision.code,
          runtime,
          log,
        });
      } else if (decision.reason === "blocked" && account.debug) {
        log?.info(
          `[${account.accountId}] Blocked ${label} from ${sender.slice(0, 12)} (dmPolicy=${decision.dmPolicy})`,
        );
      } else if (decision.reason === "disabled" && account.debug) {
        log?.info(
          `[${account.accountId}] Dropped ${label} from ${sender.slice(0, 12)} (dmPolicy=disabled)`,
        );
      } else if (account.debug) {
        log?.info(
          `[${account.accountId}] Dropped ${label} from ${sender.slice(0, 12)} (dm access denied)`,
        );
      }
      return false;
    }
  }

  return true;
}
