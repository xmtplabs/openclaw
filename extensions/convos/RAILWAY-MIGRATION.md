# Railway Template Migration: Convos Setup via HTTP API

This document is for the agent updating the `clawdbot-railway-template` repo.
The OpenClaw Convos extension now exposes HTTP endpoints for setup, eliminating
the need for the template to bundle its own XMTP agent logic.

## HTTP API

The Convos plugin registers HTTP routes on the gateway server. All endpoints
accept and return JSON. The gateway listens on `http://127.0.0.1:18789` by
default.

| Endpoint                 | Method | Body                          | Returns                                    | Notes                                                                                                                      |
| ------------------------ | ------ | ----------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `/convos/setup`          | POST   | `{ env?, name?, accountId? }` | `{ inviteUrl, conversationId, qrDataUrl }` | Creates XMTP identity + conversation in memory. `qrDataUrl` is a `data:image/png;base64,...` string ready for `<img src>`. |
| `/convos/setup/status`   | GET    | none                          | `{ active, joined, joinerInboxId }`        | Poll every 3 seconds. `joined` becomes `true` when a user scans the invite and joins.                                      |
| `/convos/setup/complete` | POST   | none                          | `{ saved: true, conversationId }`          | Persists the identity + conversation to config. Triggers a single gateway restart. Call only after `joined === true`.      |

Errors return HTTP 4xx/5xx with `{ error: "message" }`.

The same methods are also available via WebSocket (`ws://127.0.0.1:18789`)
as gateway methods `convos.setup`, `convos.setup.status`, and
`convos.setup.complete` for use by the Control UI.

## New Template Flow

1. **Start the gateway** with minimal config (`gateway.mode=local` pre-set).
   No Convos config needed yet -- the gateway starts without the channel.

2. **Call `POST /convos/setup`** with optional `{ env, name }`.
   - Returns `inviteUrl`, `conversationId`, and `qrDataUrl`.
   - The setup agent stays running in memory to accept join requests.
   - No config is written at this point, so there are no gateway restarts.

3. **Display the QR code** in the `/setup` page.
   - Use `qrDataUrl` directly as an `<img src>` attribute.
   - No client-side QR library needed.
   - Also display `inviteUrl` as a clickable/copyable link.

4. **Poll `GET /convos/setup/status`** every 3 seconds.
   - When `joined === true`, the user has scanned the QR and joined.

5. **Call `POST /convos/setup/complete`** after join is confirmed.
   - This writes the XMTP private key, conversation ID, and environment to config.
   - The gateway restarts once with the complete Convos config.
   - The normal Convos channel picks up the config and starts.

6. **Configure remaining settings** (AI model, API key, etc.) via
   `openclaw config set` or the config RPC, then restart the gateway.

## What to Remove from the Template

- **`convos-setup.js`** (or equivalent) -- all XMTP agent creation logic.
- **`@xmtp/agent-sdk`** and **`convos-node-sdk`** from `package.json` dependencies.
- Any code that calls `openclaw config set channels.convos.privateKey ...` directly.
  Config writes are now handled by `/convos/setup/complete`.

## Example: Calling from the Template Server

```javascript
const GATEWAY = "http://127.0.0.1:18789";

// 1. Start setup
const setupRes = await fetch(`${GATEWAY}/convos/setup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ env: "production", name: "My Bot" }),
});
const setup = await setupRes.json();
// setup.inviteUrl      -- invite link
// setup.qrDataUrl      -- data:image/png;base64,... for <img src>
// setup.conversationId

// 2. Poll for join
const poll = setInterval(async () => {
  const statusRes = await fetch(`${GATEWAY}/convos/setup/status`);
  const status = await statusRes.json();
  if (status.joined) {
    clearInterval(poll);
    // 3. Save config
    await fetch(`${GATEWAY}/convos/setup/complete`, { method: "POST" });
    console.log("Convos configured and running!");
  }
}, 3000);
```

## Architecture Change

**Before (current template):**

1. Template creates its own XMTP agent (duplicated SDK logic)
2. Template saves config via `openclaw config set`
3. Template starts gateway
4. Multiple config writes cause cascading restarts

**After:**

1. Template starts gateway (minimal config)
2. Template calls HTTP endpoints for Convos setup
3. Single config write after join confirmed
4. One clean restart

All Convos SDK logic lives in the OpenClaw extension. The template just calls
HTTP endpoints. Template updates automatically benefit from new Convos features
without code changes.

## Avoiding Restart Cascades

**Do not run `openclaw config set` multiple times in sequence after the gateway
is running.** Each `config set` writes the config file and triggers a gateway
restart via SIGUSR1. Multiple writes in quick succession cause a cascade of
restarts.

Instead, batch all config into a single write:

- Use `openclaw config set key1=val1 key2=val2 ...` (single command)
- Or write the config file once before starting the gateway
- Or use the `config.update` gateway method to batch changes
