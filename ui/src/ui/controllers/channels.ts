import type { ChannelsState } from "./channels.types.ts";
import { ChannelsStatusSnapshot } from "../types.ts";

export type { ChannelsState };

export async function loadChannels(state: ChannelsState, probe: boolean) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.channelsLoading) {
    return;
  }
  state.channelsLoading = true;
  state.channelsError = null;
  try {
    const res = await state.client.request<ChannelsStatusSnapshot | null>("channels.status", {
      probe,
      timeoutMs: 8000,
    });
    state.channelsSnapshot = res;
    state.channelsLastSuccess = Date.now();
  } catch (err) {
    state.channelsError = String(err);
  } finally {
    state.channelsLoading = false;
  }
}

export async function startWhatsAppLogin(state: ChannelsState, force: boolean) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; qrDataUrl?: string }>(
      "web.login.start",
      {
        force,
        timeoutMs: 30000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginQrDataUrl = res.qrDataUrl ?? null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function waitWhatsAppLogin(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    const res = await state.client.request<{ message?: string; connected?: boolean }>(
      "web.login.wait",
      {
        timeoutMs: 120000,
      },
    );
    state.whatsappLoginMessage = res.message ?? null;
    state.whatsappLoginConnected = res.connected ?? null;
    if (res.connected) {
      state.whatsappLoginQrDataUrl = null;
    }
  } catch (err) {
    state.whatsappLoginMessage = String(err);
    state.whatsappLoginConnected = null;
  } finally {
    state.whatsappBusy = false;
  }
}

export async function logoutWhatsApp(state: ChannelsState) {
  if (!state.client || !state.connected || state.whatsappBusy) {
    return;
  }
  state.whatsappBusy = true;
  try {
    await state.client.request("channels.logout", { channel: "whatsapp" });
    state.whatsappLoginMessage = "Logged out.";
    state.whatsappLoginQrDataUrl = null;
    state.whatsappLoginConnected = null;
  } catch (err) {
    state.whatsappLoginMessage = String(err);
  } finally {
    state.whatsappBusy = false;
  }
}

// Track active polling interval
let convosJoinPollInterval: ReturnType<typeof setInterval> | null = null;
let convosJoinPollTimeout: ReturnType<typeof setTimeout> | null = null;

function stopConvosJoinPolling() {
  if (convosJoinPollInterval) {
    clearInterval(convosJoinPollInterval);
    convosJoinPollInterval = null;
  }
  if (convosJoinPollTimeout) {
    clearTimeout(convosJoinPollTimeout);
    convosJoinPollTimeout = null;
  }
}

export async function setupConvos(state: ChannelsState) {
  if (!state.client || !state.connected || state.convosBusy) {
    return;
  }

  // Stop any existing polling
  stopConvosJoinPolling();

  state.convosBusy = true;
  state.convosMessage = "Setting up Convos...";
  state.convosInviteUrl = null;
  state.convosJoined = false;

  try {
    const res = await state.client.request<{ inviteUrl?: string; conversationId?: string }>(
      "convos.setup",
      {
        timeoutMs: 60000,
      },
    );
    state.convosInviteUrl = res.inviteUrl ?? null;
    state.convosMessage = res.inviteUrl
      ? "Waiting for you to join via the Convos app..."
      : "Setup completed.";

    // Start polling for join status if we got an invite URL
    if (res.inviteUrl && state.client) {
      const client = state.client;

      convosJoinPollInterval = setInterval(async () => {
        try {
          const status = await client.request<{
            active?: boolean;
            joined?: boolean;
            joinerInboxId?: string | null;
          }>("convos.setup.status", { timeoutMs: 5000 });

          if (status.joined) {
            stopConvosJoinPolling();
            state.convosJoined = true;
            state.convosMessage = "Connected! You can now message through Convos.";
          }
        } catch {
          // Ignore polling errors
        }
      }, 3000);

      // Stop polling after 5 minutes
      convosJoinPollTimeout = setTimeout(() => {
        stopConvosJoinPolling();
        if (!state.convosJoined && state.convosInviteUrl) {
          state.convosMessage = "Invite still active. Join via the link above.";
        }
      }, 5 * 60 * 1000);
    }
  } catch (err) {
    state.convosMessage = `Setup failed: ${String(err)}`;
    state.convosInviteUrl = null;
  } finally {
    state.convosBusy = false;
  }
}
