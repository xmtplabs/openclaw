import {
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import type { DmPolicy } from "./config-types.js";
import { resolveConvosAccount, listConvosAccountIds, type CoreConfig } from "./accounts.js";
import { resolveConvosDbPath } from "./lib/convos-client.js";
import { getClientForAccount } from "./outbound.js";
import { getConvosRuntime } from "./runtime.js";
import { ConvosSDKClient } from "./sdk-client.js";

const channel = "convos" as const;

type ConvosOnboardingAdapter = ChannelOnboardingAdapter & {
  verifyClient?: (params: {
    cfg: OpenClawConfig;
    prompter: { note: (body: string, title?: string) => Promise<void> };
  }) => Promise<void>;
};

// Convos invite URLs can be:
// - Full URL: https://convos.app/join/SLUG or convos://join/SLUG
// - V2 URL: https://*.convos.org/...?i=PAYLOAD or https://convos.app/...?i=PAYLOAD
// - Raw slug: base64-encoded string with asterisks for iMessage compatibility
const INVITE_URL_PATTERNS = [
  /^https?:\/\/convos\.app\/join\/(.+)$/i,
  /^convos:\/\/join\/(.+)$/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)*convos\.(?:app|org)\/.*[?&]i=(.+)$/i,
];

function extractInviteSlug(input: string): string {
  const trimmed = input.trim();
  for (const pattern of INVITE_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const slug = match[1];
      // ?i= pattern may capture trailing query params; strip after first &
      const end = slug.indexOf("&");
      return end === -1 ? slug : slug.slice(0, end);
    }
  }
  // Assume it's a raw slug
  return trimmed;
}

function isValidInviteInput(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) {
    return false;
  }
  // Check if it's a URL or a slug (base64-ish with asterisks)
  for (const pattern of INVITE_URL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  // Raw slug: should be base64 characters possibly with asterisks
  return /^[A-Za-z0-9+/=*_-]+$/.test(trimmed) && trimmed.length > 20;
}

function setConvosDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      convos: {
        ...(cfg.channels as CoreConfig["channels"])?.convos,
        dmPolicy,
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "Convos",
  channel,
  policyKey: "channels.convos.dmPolicy",
  allowFromKey: "channels.convos.allowFrom",
  getCurrent: (cfg) => (cfg.channels as CoreConfig["channels"])?.convos?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setConvosDmPolicy(cfg, policy),
};

export const convosOnboardingAdapter: ConvosOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const configured = listConvosAccountIds(cfg as CoreConfig).some(
      (accountId) => resolveConvosAccount({ cfg: cfg as CoreConfig, accountId }).configured,
    );
    const account = resolveConvosAccount({ cfg: cfg as CoreConfig });
    const ownerConversation = (cfg.channels as CoreConfig["channels"])?.convos?.ownerConversationId;

    return {
      channel,
      configured,
      statusLines: [
        `Convos: ${configured ? "configured" : "needs setup"}`,
        `Environment: ${account.env}`,
        ownerConversation ? `Owner conversation: ${ownerConversation.slice(0, 8)}...` : "",
      ].filter(Boolean),
      selectionHint: configured ? "ready" : "paste invite link",
      quickstartScore: 0, // Requires manual invite flow
    };
  },

  configure: async (ctx) => {
    const { cfg, prompter } = ctx;
    const createNewIdentity = (ctx as { createNewIdentity?: boolean }).createNewIdentity;
    let next = cfg;
    const account = resolveConvosAccount({ cfg: next as CoreConfig });

    // Check for existing configuration (skip when creating new identity)
    if (account.privateKey && account.ownerConversationId && !createNewIdentity) {
      const action = await prompter.select({
        message: "Convos already configured.",
        options: [
          { value: "generate" as const, label: "Generate new one" },
          { value: "check" as const, label: "Check our current one" },
          { value: "skip" as const, label: "Skip" },
        ],
        initialValue: "skip",
      });
      if (action === "check") {
        const existing = getClientForAccount(account.accountId);
        if (existing?.isRunning()) {
          await prompter.note(
            `Convos client verified (already running).\n\nInbox ID: ${existing.getInboxId()}`,
            "Verify client",
          );
          return { cfg: next };
        }
        const runtime = getConvosRuntime();
        const stateDir = runtime.state.resolveStateDir();
        const dbPath = resolveConvosDbPath({
          stateDir,
          env: account.env,
          accountId: account.accountId,
          privateKey: account.privateKey,
        });
        const client = await ConvosSDKClient.create({
          privateKey: account.privateKey,
          env: account.env,
          dbPath,
          debug: account.debug,
        });
        try {
          await client.start();
          const inboxId = client.getInboxId();
          await prompter.note(`Convos client verified.\n\nInbox ID: ${inboxId}`, "Verify client");
        } catch (err) {
          await prompter.note(
            `Client verification failed: ${err instanceof Error ? err.message : String(err)}`,
            "Verify client",
          );
        } finally {
          await client.stop();
        }
        return { cfg: next };
      }
      if (action === "skip") {
        return { cfg: next };
      }
    }

    // Explain the invite flow
    await prompter.note(
      [
        "To connect OpenClaw to Convos:",
        "",
        "1. Open the Convos iOS app",
        "2. Open a conversation (or create one)",
        '3. Tap the "+" button',
        "4. Tap the share button on the QR code",
        '5. Tap "Copy" (or AirDrop to your Mac)',
        "6. Paste the invite link below",
        "",
        "OpenClaw will join this conversation as your control channel.",
      ].join("\n"),
      "Convos Setup",
    );

    // Prompt for invite link
    const inviteInput = await prompter.text({
      message: "Paste Convos invite link or slug",
      placeholder: "https://convos.app/join/... or https://...convos.org/v2?i=... or raw slug",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) {
          return "Required";
        }
        if (!isValidInviteInput(raw)) {
          return "Invalid invite format. Paste the full URL or slug.";
        }
        return undefined;
      },
    });

    const inviteSlug = extractInviteSlug(String(inviteInput));

    // Join the conversation using SDK client
    await prompter.note("Creating XMTP identity and joining conversation...", "Convos");

    let client: ConvosSDKClient | undefined;
    try {
      // Create a new SDK client (will generate a new private key)
      client = await ConvosSDKClient.create({
        env: account.env,
        debug: account.debug,
      });

      const result = await client.joinConversation(inviteSlug);

      if (!result.conversationId) {
        await prompter.note(
          result.status === "waiting_for_acceptance"
            ? "Join request sent. The conversation owner needs to approve your request in the Convos iOS app."
            : "Failed to join conversation. The invite may be invalid or expired.",
          "Convos",
        );

        // Still save the private key so we can retry later
        next = {
          ...next,
          channels: {
            ...next.channels,
            convos: {
              ...(next.channels as CoreConfig["channels"])?.convos,
              enabled: true,
              privateKey: client.getPrivateKey(),
              env: account.env,
            },
          },
        };

        return { cfg: next };
      }

      // Save privateKey and ownerConversationId
      next = {
        ...next,
        channels: {
          ...next.channels,
          convos: {
            ...(next.channels as CoreConfig["channels"])?.convos,
            enabled: true,
            privateKey: client.getPrivateKey(),
            env: account.env,
            ownerConversationId: result.conversationId,
          },
        },
      };

      await prompter.note(
        [
          "Successfully joined conversation!",
          "",
          `Conversation ID: ${result.conversationId}`,
          "",
          "This is now your owner channel. OpenClaw will:",
          "- Send status updates here",
          "- Ask for approvals here",
          "- Communicate with you here",
        ].join("\n"),
        "Convos Connected",
      );
    } catch (err) {
      await prompter.note(
        `Failed to join: ${err instanceof Error ? err.message : String(err)}`,
        "Convos Error",
      );
    } finally {
      // Stop the temporary client
      if (client) {
        await client.stop();
      }
    }

    return { cfg: next };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      convos: {
        ...(cfg.channels as CoreConfig["channels"])?.convos,
        enabled: false,
      },
    },
  }),

  verifyClient: async ({ cfg, prompter }) => {
    const account = resolveConvosAccount({ cfg: cfg as CoreConfig });
    if (!account.privateKey) {
      await prompter.note("Convos not configured. Run configure first.", "Verify client");
      return;
    }
    const existing = getClientForAccount(account.accountId);
    if (existing?.isRunning()) {
      await prompter.note(
        `Convos client verified (already running).\n\nInbox ID: ${existing.getInboxId()}`,
        "Verify client",
      );
      return;
    }
    const runtime = getConvosRuntime();
    const stateDir = runtime.state.resolveStateDir();
    const dbPath = resolveConvosDbPath({
      stateDir,
      env: account.env,
      accountId: account.accountId,
      privateKey: account.privateKey,
    });
    const client = await ConvosSDKClient.create({
      privateKey: account.privateKey,
      env: account.env,
      dbPath,
      debug: account.debug,
    });
    try {
      await client.start();
      const inboxId = client.getInboxId();
      await prompter.note(`Convos client verified.\n\nInbox ID: ${inboxId}`, "Verify client");
    } catch (err) {
      await prompter.note(
        `Client verification failed: ${err instanceof Error ? err.message : String(err)}`,
        "Verify client",
      );
    } finally {
      await client.stop();
    }
  },
};
