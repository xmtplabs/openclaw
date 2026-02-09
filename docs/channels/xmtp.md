---
summary: "XMTP channel setup and configuration for decentralized E2E encrypted messaging"
read_when:
  - Working on XMTP channel features
  - Setting up XMTP integration
title: "XMTP"
---

# XMTP

The XMTP channel provides decentralized E2E encrypted messaging via the XMTP protocol. OpenClaw uses the XMTP plugin and `@xmtp/agent-sdk` to communicate with the XMTP network.

Status: supported via plugin. Direct messages, group conversations, media (remote attachments). No reactions or threads.

**One-click deploy:** [Deploy on Railway](https://railway.com/deploy/xmtp-openclaw-template?referralCode=UxaXte&utm_medium=integration&utm_source=template&utm_campaign=generic) (OpenClaw + XMTP, then use `/setup` in the browser).

## Requirements

- Wallet private key (or generate one via the configure wizard)
- DB encryption key for local XMTP storage (generated or provided)

## Plugin required

XMTP ships as a plugin and is not bundled with the core install.

> **Note:** The XMTP plugin is currently published under the `@xmtp` scope, not `@openclaw`. Use the install command below until native bundling is available.

Install via CLI (npm registry):

```bash
openclaw plugins install @xmtp/openclaw
```

## Setup

### 1. Configure OpenClaw

Run the configuration wizard:

```bash
openclaw configure
```

When prompted:

1. Choose environment: **Production** or **Dev**
2. Choose keys: **Random** (generate new keys) or **Custom** (enter existing keys)
3. If random: the plugin generates a wallet key and DB encryption key, writes them to config and `~/.openclaw/.env`
4. If custom: enter your wallet private key and DB encryption key

OpenClaw initializes the XMTP client and shows your **public address** (derived from the wallet key). Share this address so others can message your agent.

### 2. Start the agent

```bash
openclaw start
# or with logs:
openclaw start --debug
```

### 3. Manual config (optional)

Add to `~/.openclaw/openclaw.json`:

```json
{
  "channels": {
    "xmtp": {
      "enabled": true,
      "walletKey": "<hex-private-key>",
      "dbEncryptionKey": "<encryption-key>",
      "env": "production"
    }
  }
}
```

## Configuration

| Field             | Type    | Default      | Description                                                   |
| ----------------- | ------- | ------------ | ------------------------------------------------------------- |
| `enabled`         | boolean | `true`       | Enable/disable XMTP                                           |
| `walletKey`       | string  | -            | Wallet private key (hex or env var name)                      |
| `dbEncryptionKey` | string  | -            | DB encryption key for local XMTP storage                      |
| `env`             | string  | `production` | XMTP environment (production/dev)                             |
| `debug`           | boolean | `false`      | Enable debug logging                                          |
| `dmPolicy`        | string  | `pairing`    | DM access policy                                              |
| `allowFrom`       | array   | -            | Allowlist of addresses (when dmPolicy is allowlist)           |
| `groupPolicy`     | string  | `open`       | How group messages are handled                                |
| `groups`          | array   | -            | Allowlist of conversation IDs (when groupPolicy is allowlist) |
| `textChunkLimit`  | number  | 4000         | Outbound text chunk size (chars)                              |
| `name`            | string  | -            | Optional display name for this account                        |

For multiple XMTP identities, use `channels.xmtp.accounts.<id>` with the same fields per account.

## DM Policies

- `pairing` (default): Unknown senders get a pairing code; owner approves
- `allowlist`: Only allow senders in `allowFrom`
- `open`: Accept all incoming DMs
- `disabled`: Ignore all DMs

## Group Policies

- **`open`** (default): Accept messages from all groups. The `groups` array is ignored.
- **`disabled`**: Ignore all group messages.
- **`allowlist`**: Only accept messages from conversations listed in `groups`. Set `groups` to `["*"]` to allow all, or list specific conversation IDs.

Example (allowlist only; `groups` is unused when policy is `open` or `disabled`):

```json
{
  "channels": {
    "xmtp": {
      "groupPolicy": "allowlist",
      "groups": ["*"]
    }
  }
}
```

## Wallet-based identity

The XMTP plugin uses one identity per account (derived from the wallet key). The agent-sdk reads credentials from environment variables: `XMTP_WALLET_KEY`, `XMTP_DB_ENCRYPTION_KEY`, `XMTP_ENV`, `XMTP_DB_DIRECTORY`. The plugin writes keys to `~/.openclaw/.env` for `Agent.createFromEnv()`.

## Test your agent

Use [xmtp.chat](https://xmtp.chat/) — connect with a wallet, start a new conversation, enter your agent's XMTP address, and send a message.

## Troubleshooting

### Not configured

Ensure `walletKey` and `dbEncryptionKey` are set. Run `openclaw configure` to set up XMTP.

### Connection issues

If you see XMTP connection errors:

1. Check your network connectivity
2. Try setting `env: "dev"` for testing
3. Enable `debug: true` for detailed logs

## Capabilities

| Feature             | Supported    |
| ------------------- | ------------ |
| Group conversations | Yes          |
| Direct messages     | Yes          |
| Reactions           | No           |
| Threads             | No           |
| Media/attachments   | Yes (remote) |
| E2E encryption      | Yes (XMTP)   |
