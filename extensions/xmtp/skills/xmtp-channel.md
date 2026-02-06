---
name: xmtp-channel
description: How to use the XMTP channel for decentralized E2E encrypted messaging
read_when:
  - Working with XMTP channel
  - Sending or receiving messages via XMTP
  - Understanding XMTP agent identity and addressing
---

# XMTP Channel Guide

The XMTP channel provides decentralized E2E encrypted messaging via the XMTP protocol. OpenClaw uses the XMTP plugin and `@xmtp/agent-sdk` to communicate with the XMTP network.

## Architecture Overview

### SDK-Based Implementation

- Runs in-process within the gateway
- Uses `Agent.createFromEnv()` with keys from config / `~/.openclaw/.env`
- One identity per account (derived from wallet key)
- Local DB path: `~/.openclaw/xmtp/<accountId>/` (or `XMTP_DB_DIRECTORY`)

### Wallet-Based Identity

The agent's public address is the Ethereum address derived from the wallet private key. Anyone can message the agent by that address from any XMTP client (Converse, xmtp.chat, etc.). No invite URL is required for DMs; the agent receives messages automatically once the gateway is running.

## Slash command

| Command    | Args | Description                                                                                                     |
| ---------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| `/address` | None | Print the XMTP public agent address (Ethereum address). Use this to share with others so they can DM the agent. |

Requires authorization. If XMTP is not configured, the command replies with a short error message.

## Message Targeting

- **Direct messages**: Target by the peer's Ethereum address (e.g. `0x1234...`). The agent creates or reuses a DM conversation by address.
- **Group messages**: Target by conversation ID (topic/id from the SDK). The agent must already be in the group to send.
- Outbound actions use `to` as conversation ID or address; the plugin resolves the conversation via `agent.client.conversations.getConversationById(to)` then `conversation.sendText(text)`.

## Capabilities

| Feature             | Supported    |
| ------------------- | ------------ |
| Group conversations | Yes          |
| Direct messages     | Yes          |
| Reactions           | No           |
| Threads             | No           |
| Media/attachments   | Yes (remote) |
| E2E encryption      | Yes (XMTP)   |

## Configuration Reference

```json
{
  "channels": {
    "xmtp": {
      "enabled": true,
      "walletKey": "0x...",
      "dbEncryptionKey": "<hex>",
      "env": "production",
      "dmPolicy": "pairing",
      "groupPolicy": "open"
    }
  }
}
```

Key fields:

- `walletKey`: Wallet private key (hex). Public address is derived from this.
- `dbEncryptionKey`: Encryption key for local XMTP DB.
- `env`: XMTP environment (`production` or `dev`).
- `dmPolicy`: Who can DM the agent (pairing / allowlist / open / disabled).
- `groupPolicy`: Which groups can message the agent (open / disabled / allowlist).

## Error Handling

- **Conversation not found**: The agent may not yet have a conversation with that address/ID; for DMs the other party must message the agent first, or use the send action with an existing conversation ID.
- **Agent not available**: Gateway not started or XMTP channel not running; start the gateway with XMTP enabled.
