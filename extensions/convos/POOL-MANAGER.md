# Convos HTTP API

HTTP endpoints registered by the Convos plugin. All endpoints accept JSON request bodies and return JSON responses. Non-matching HTTP methods return `405`.

## Authentication

All endpoints check for a `poolApiKey` in the OpenClaw config at `channels.convos.poolApiKey`. When set, requests must include:

```
Authorization: Bearer <poolApiKey>
```

When `poolApiKey` is not configured, all requests are allowed without authentication.

Unauthorized requests return `401`:

```json
{ "error": "Unauthorized" }
```

## Constraints

- **One conversation per process.** `/convos/conversation` and `/convos/join` return `409` if the instance is already bound to a conversation.
- **No restart required.** After `/convos/conversation` or `/convos/join`, the instance is immediately live with full message handling.
- **XMTP keys are created lazily.** Enabling the plugin does not create XMTP state. Keys are created on the first `/convos/conversation` or `/convos/join` call.
- **`/convos/setup` endpoints are for the Control UI onboarding flow** (show QR, wait for join, confirm). They are separate from `/convos/conversation`.
- **Setup auto-cleanup.** An active setup instance is automatically stopped after 10 minutes if `/convos/setup/complete` is not called.
- **`instructions` parameter.** When provided to `/convos/conversation` or `/convos/join`, the value is written to `~/.openclaw/workspace/INSTRUCTIONS.md`, which is loaded into the agent system prompt on each invocation.

## Endpoints

| Method | Path                        | Description                                     |
| ------ | --------------------------- | ----------------------------------------------- |
| GET    | `/convos/status`            | Health check                                    |
| POST   | `/convos/conversation`      | Create a new conversation                       |
| POST   | `/convos/join`              | Join an existing conversation via invite URL    |
| POST   | `/convos/conversation/send` | Send a message into the active conversation     |
| POST   | `/convos/rename`            | Rename the conversation and agent profile       |
| POST   | `/convos/lock`              | Lock or unlock the conversation                 |
| POST   | `/convos/explode`           | Destroy the conversation (irreversible)         |
| POST   | `/convos/setup`             | Start onboarding setup flow (Control UI)        |
| GET    | `/convos/setup/status`      | Poll setup join status                          |
| POST   | `/convos/setup/complete`    | Finalize setup and write config                 |
| POST   | `/convos/setup/cancel`      | Cancel an active setup                          |
| POST   | `/convos/reset`             | Re-run setup with a fresh identity (force mode) |

---

### GET /convos/status

Returns instance health. The `streaming` field reflects whether the XMTP child process is alive.

**Response (no conversation bound):**

```json
{ "ready": true, "conversation": null, "streaming": false }
```

**Response (conversation bound, stream alive):**

```json
{ "ready": true, "conversation": { "id": "abc123..." }, "streaming": true }
```

**Response (conversation bound, stream dead):**

```json
{ "ready": true, "conversation": { "id": "abc123..." }, "streaming": false }
```

---

### POST /convos/conversation

Create a new XMTP identity and conversation. Writes config and starts the message stream and join-request processor. Returns `409` if the instance is already bound.

**Request body:**

| Param        | Type   | Default          | Description                                            |
| ------------ | ------ | ---------------- | ------------------------------------------------------ |
| name         | string | `"Convos Agent"` | Conversation display name                              |
| profileName  | string | value of `name`  | Agent profile display name (independent of convo name) |
| profileImage | string | —                | URL for the agent profile image                        |
| description  | string | —                | Conversation description                               |
| imageUrl     | string | —                | Conversation image URL                                 |
| permissions  | string | —                | `"all-members"` or `"admin-only"`                      |
| env          | string | from config      | `"dev"` or `"production"`                              |
| accountId    | string | —                | Account ID (for multi-account setups)                  |
| instructions | string | —                | Written to `INSTRUCTIONS.md` for the agent prompt      |

**Response (`200`):**

```json
{
  "conversationId": "56f2293389ad742e693ddb277464c3d3",
  "inviteUrl": "https://dev.convos.org/v2?i=...",
  "inviteSlug": "..."
}
```

**Response (`409`):**

```json
{
  "error": "Instance already bound to a conversation. Terminate process and provision a new one."
}
```

---

### POST /convos/join

Join an existing conversation via invite URL. Creates an XMTP identity, sends a join request, and waits up to 60 seconds for acceptance. Writes config and starts the message stream on success. Returns `409` if the instance is already bound.

**Request body:**

| Param        | Type   | Default          | Description                                       |
| ------------ | ------ | ---------------- | ------------------------------------------------- |
| inviteUrl    | string | **required**     | Full invite URL or slug                           |
| profileName  | string | `"Convos Agent"` | Agent profile display name                        |
| profileImage | string | —                | URL for the agent profile image                   |
| env          | string | from config      | `"dev"` or `"production"`                         |
| accountId    | string | —                | Account ID (for multi-account setups)             |
| instructions | string | —                | Written to `INSTRUCTIONS.md` for the agent prompt |

**Response (`200` — joined):**

```json
{ "status": "joined", "conversationId": "abc123..." }
```

**Response (`200` — join request not accepted within timeout):**

```json
{ "status": "waiting_for_acceptance" }
```

**Response (`409`):**

```json
{
  "error": "Instance already bound to a conversation. Terminate process and provision a new one."
}
```

---

### POST /convos/conversation/send

Send a text message into the active conversation.

**Request body:**

| Param   | Type   | Default      | Description      |
| ------- | ------ | ------------ | ---------------- |
| message | string | **required** | The message text |

**Response (`200`):**

```json
{ "success": true, "messageId": "msg-id-here" }
```

**Response (`400`):**

```json
{ "error": "No active conversation" }
```

---

### POST /convos/rename

Rename the conversation and update the agent profile name.

**Request body:**

| Param | Type   | Default      | Description  |
| ----- | ------ | ------------ | ------------ |
| name  | string | **required** | The new name |

**Response (`200`):**

```json
{ "ok": true }
```

**Response (`400`):**

```json
{ "error": "No active conversation" }
```

---

### POST /convos/lock

Lock or unlock the conversation.

**Request body:**

| Param  | Type    | Default | Description                  |
| ------ | ------- | ------- | ---------------------------- |
| unlock | boolean | `false` | Set `true` to unlock instead |

**Response (`200`):**

```json
{ "ok": true, "locked": true }
```

**Response (`400`):**

```json
{ "error": "No active conversation" }
```

---

### POST /convos/explode

Destroy the conversation. Irreversible. The instance is unbound after this call.

**Request body:** empty or `{}`

**Response (`200`):**

```json
{ "ok": true, "exploded": true }
```

**Response (`400`):**

```json
{ "error": "No active conversation" }
```

---

### POST /convos/setup

Start the Control UI onboarding flow. Creates a new XMTP identity and conversation, generates a QR code, and starts an instance that accepts join requests. If a setup is already running and `force` is not set, returns the cached response.

**Request body:**

| Param     | Type    | Default        | Description                              |
| --------- | ------- | -------------- | ---------------------------------------- |
| name      | string  | —              | Profile display name                     |
| env       | string  | `"production"` | `"dev"` or `"production"`                |
| accountId | string  | —              | Account ID                               |
| force     | boolean | `false`        | Tear down existing setup and start fresh |

**Response (`200`):**

```json
{
  "inviteUrl": "https://dev.convos.org/v2?i=...",
  "conversationId": "abc123...",
  "qrDataUrl": "data:image/png;base64,..."
}
```

---

### GET /convos/setup/status

Poll whether a user has joined the setup conversation.

**Response (`200` — no join yet):**

```json
{ "active": true, "joined": false, "joinerInboxId": null }
```

**Response (`200` — user joined):**

```json
{ "active": true, "joined": true, "joinerInboxId": "inbox-id-here" }
```

**Response (`200` — no active setup):**

```json
{ "active": false, "joined": false, "joinerInboxId": null }
```

---

### POST /convos/setup/complete

Finalize setup. Writes `identityId`, `ownerConversationId`, `env`, and `enabled` to the OpenClaw config. Adds the joiner's inbox ID to `channels.convos.allowFrom`. Stops and cleans up the setup instance.

**Request body:** empty or `{}`

**Response (`200`):**

```json
{ "saved": true, "conversationId": "abc123..." }
```

**Response (`400`):**

```json
{ "error": "No active setup to complete. Run convos.setup first." }
```

---

### POST /convos/setup/cancel

Cancel an active setup. Stops the setup instance and discards the pending config.

**Request body:** empty or `{}`

**Response (`200`):**

```json
{ "cancelled": true }
```

If no setup was active:

```json
{ "cancelled": false }
```

---

### POST /convos/reset

Re-run setup with a fresh identity. Equivalent to `/convos/setup` with `force: true`.

**Request body:**

| Param     | Type   | Default        | Description               |
| --------- | ------ | -------------- | ------------------------- |
| env       | string | `"production"` | `"dev"` or `"production"` |
| accountId | string | —              | Account ID                |

**Response:** Same as `/convos/setup`.
