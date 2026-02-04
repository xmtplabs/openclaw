import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { convosPlugin } from "./src/channel.js";
import { setConvosRuntime } from "./src/runtime.js";
import { setupConvosWithInvite } from "./src/setup.js";
import type { ConvosSDKClient } from "./src/sdk-client.js";

// Module-level state for setup agent (accepts join requests during setup flow)
let setupAgent: ConvosSDKClient | null = null;
let setupJoinState = { joined: false, joinerInboxId: null as string | null };
let setupCleanupTimer: ReturnType<typeof setTimeout> | null = null;

async function cleanupSetupAgent() {
  if (setupCleanupTimer) {
    clearTimeout(setupCleanupTimer);
    setupCleanupTimer = null;
  }
  if (setupAgent) {
    try {
      await setupAgent.stop();
    } catch {
      // Ignore cleanup errors
    }
    setupAgent = null;
  }
}

const plugin = {
  id: "convos",
  name: "Convos",
  description: "E2E encrypted messaging via XMTP",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setConvosRuntime(api.runtime);
    api.registerChannel({ plugin: convosPlugin });

    // Register convos.setup gateway method for web UI
    // Creates conversation and keeps agent running to accept join requests
    api.registerGatewayMethod("convos.setup", async ({ params, respond }) => {
      try {
        // Stop any existing setup agent first
        await cleanupSetupAgent();
        setupJoinState = { joined: false, joinerInboxId: null };

        const result = await setupConvosWithInvite({
          accountId:
            typeof (params as { accountId?: unknown }).accountId === "string"
              ? (params as { accountId?: string }).accountId
              : undefined,
          env:
            typeof (params as { env?: unknown }).env === "string"
              ? ((params as { env?: string }).env as "production" | "dev")
              : undefined,
          name:
            typeof (params as { name?: unknown }).name === "string"
              ? (params as { name?: string }).name
              : undefined,
          // Keep agent running to accept join requests
          keepRunning: true,
          onInvite: async (ctx) => {
            console.log(`[convos-setup] Join request from ${ctx.joinerInboxId}`);
            try {
              await ctx.accept();
              setupJoinState = { joined: true, joinerInboxId: ctx.joinerInboxId };
              console.log(`[convos-setup] Accepted join from ${ctx.joinerInboxId}`);
              // Auto-cleanup after successful join (give it a moment)
              setTimeout(() => cleanupSetupAgent(), 2000);
            } catch (err) {
              console.error(`[convos-setup] Failed to accept join:`, err);
            }
          },
        });

        // Store the running client
        if (result.client) {
          setupAgent = result.client;
          console.log("[convos-setup] Agent kept running to accept join requests");

          // Auto-cleanup after 5 minutes if no one joins
          setupCleanupTimer = setTimeout(async () => {
            console.log("[convos-setup] Timeout - stopping setup agent");
            await cleanupSetupAgent();
          }, 5 * 60 * 1000);
        }

        respond(
          true,
          {
            inviteUrl: result.inviteUrl,
            conversationId: result.conversationId,
          },
          undefined,
        );
      } catch (err) {
        await cleanupSetupAgent();
        respond(false, undefined, {
          code: -1,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // Register convos.setup.status to check join state
    api.registerGatewayMethod("convos.setup.status", async ({ respond }) => {
      respond(
        true,
        {
          active: setupAgent !== null,
          joined: setupJoinState.joined,
          joinerInboxId: setupJoinState.joinerInboxId,
        },
        undefined,
      );
    });
  },
};

export default plugin;
