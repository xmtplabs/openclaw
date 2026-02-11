# Convos Pool Manager Integration

How to provision OpenClaw instances with Convos from a pool manager.

## Architecture

Each OpenClaw instance runs exactly one Convos conversation. The pool manager provisions fresh instances, each bound to a single conversation. No setup flow or onboarding is needed.

## Provisioning Flow

### 1. Configure the instance

The pool manager should configure the OpenClaw instance with an API key and enable the Convos plugin. This can be done via CLI commands or by writing the config file directly.

```bash
# Set the AI provider token
openclaw config set auth.profiles.anthropic:default.provider anthropic
openclaw config set auth.profiles.anthropic:default.mode token
# (API key is set via ANTHROPIC_API_KEY env var or openclaw config set)

# Enable convos plugin and set environment
openclaw config set channels.convos.enabled true
openclaw config set channels.convos.env dev
```

Or write `~/.openclaw/openclaw.json` directly:

```json
{
  "auth": {
    "profiles": {
      "anthropic:default": {
        "provider": "anthropic",
        "mode": "token"
      }
    }
  },
  "channels": {
    "convos": {
      "enabled": true,
      "env": "dev"
    }
  }
}
```

### 2. Start the gateway

```bash
openclaw gateway run --port 18789
```

At this point, the Convos plugin is loaded and HTTP routes are available, but no XMTP identity or conversation exists yet.

### 3. Create a conversation

```bash
curl -s -X POST http://localhost:18789/convos/conversation \
  -H 'Content-Type: application/json' \
  -d '{"name":"My Agent","env":"dev"}' | jq .
```

Response:

```json
{
  "conversationId": "56f2293389ad742e693ddb277464c3d3",
  "inviteUrl": "https://dev.convos.org/v2?i=...",
  "inviteSlug": "..."
}
```

This single call does everything:

- Creates a new XMTP identity (private keys stored in `~/.convos/identities/`)
- Creates a new XMTP conversation
- Writes config (`ownerConversationId`, `identityId`, `env`, `enabled`)
- Starts the message stream and join-request processor
- The instance is immediately ready to send and receive messages

### 4. Share the invite

Give the `inviteUrl` to the user. They open it in the Convos iOS app to join the conversation.

### Alternative: Join an existing conversation

If the user already created a conversation and has an invite:

```bash
curl -s -X POST http://localhost:18789/convos/join \
  -H 'Content-Type: application/json' \
  -d '{"inviteUrl":"https://dev.convos.org/v2?i=...","name":"My Agent","env":"dev"}' | jq .
```

## When are XMTP keys created?

XMTP identity and private keys are created lazily on the first `/convos/conversation` or `/convos/join` call. Enabling the plugin does NOT create any XMTP state. The `convos` CLI manages keys internally in `~/.convos/identities/`.

## Important constraints

- **One conversation per process.** Calling `/convos/conversation` or `/convos/join` a second time returns `409`. To provision a new conversation, terminate the process and start a fresh one.
- **No setup flow needed.** The `/convos/setup` endpoints exist for the Control UI onboarding experience (show QR, wait for join, confirm). The pool manager should skip these entirely.
- **No restart needed.** After `/convos/conversation` or `/convos/join`, the instance is immediately live with full message handling. No gateway restart required.

## HTTP API Reference

| Method | Path                        | Description                                       |
| ------ | --------------------------- | ------------------------------------------------- |
| POST   | `/convos/conversation`      | Create a new conversation (returns invite URL)    |
| POST   | `/convos/join`              | Join an existing conversation via invite URL      |
| POST   | `/convos/conversation/send` | Send a message                                    |
| POST   | `/convos/rename`            | Rename the conversation                           |
| POST   | `/convos/lock`              | Lock/unlock the conversation (`{"unlock": true}`) |
| POST   | `/convos/explode`           | Destroy the conversation (irreversible)           |

All endpoints accept JSON bodies. All return JSON responses.

## Request body parameters

### POST /convos/conversation

| Param     | Type   | Default     | Description                           |
| --------- | ------ | ----------- | ------------------------------------- |
| name      | string | "OpenClaw"  | Conversation and profile display name |
| env       | string | from config | "dev" or "production"                 |
| accountId | string | "default"   | Account ID (for multi-account setups) |

### POST /convos/join

| Param     | Type   | Default     | Description           |
| --------- | ------ | ----------- | --------------------- |
| inviteUrl | string | required    | Invite URL or slug    |
| name      | string | "OpenClaw"  | Profile display name  |
| env       | string | from config | "dev" or "production" |
| accountId | string | "default"   | Account ID            |
