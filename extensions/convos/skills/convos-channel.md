---
name: convos-channel
description: How to use Convos for E2E encrypted messaging via XMTP
read_when:
  - Working with Convos channel
  - Creating or managing XMTP conversations
  - Inviting users to conversations
  - Understanding Convos architecture
---

# Convos Channel Guide

Convos provides E2E encrypted messaging via XMTP using the convos-node-sdk. This guide explains how OpenClaw can use Convos to communicate with users.

## Architecture Overview

### SDK-Based Implementation

OpenClaw uses convos-node-sdk directly (no external daemon required):

- Runs in-process within the gateway
- Cross-platform (macOS, Linux, Windows)
- Private keys stored in config file

### Per-Conversation Identity

Each Convos conversation has its own unique XMTP inbox identity. This means:

- No single identity is reused across conversations
- Cross-conversation correlation/tracking is impossible
- Each conversation is cryptographically isolated
- Compromising one conversation doesn't affect others

### Owner Channel

When OpenClaw is connected to Convos, there's a special "owner conversation" where you communicate with OpenClaw's operator. This conversation is set during onboarding when the owner pastes an invite link.

The owner conversation ID is stored in `channels.convos.ownerConversationId`.

## Slash commands

When the gateway is running, operators can use these commands from any channel (e.g. Convos, Telegram):

| Command   | Args          | Description                                                                                 |
| --------- | ------------- | ------------------------------------------------------------------------------------------- |
| `/invite` | Optional name | Create a new Convos conversation and get an invite link. Reply with the URL to share.       |
| `/join`   | Required URL  | Join a Convos conversation via invite URL. Use the full invite link (e.g. from Convos app). |

Both commands require authorization. If Convos is not configured or not running, the command replies with a short error message.

## Conversation Operations

### Listing Conversations

Use the SDK client to list available conversations:

```
client.listConversations() → [{ id, displayName, memberCount, ... }]
```

### Creating New Conversations

OpenClaw can create new conversations for specific purposes:

```
client.createConversation(name?) → { conversationId, inviteSlug }
```

Use cases:

- Creating a dedicated conversation for a project/topic
- Separating concerns (work vs personal vs alerts)
- Onboarding new users with fresh conversations

### Generating Invites

To invite someone to a conversation:

```
client.getInvite(conversationId) → { inviteSlug }
```

The invite URL format is: `https://convos.app/join/<slug>`

Invites are:

- Cryptographically signed by the conversation creator
- Revocable by updating the conversation's invite tag
- Optionally time-limited or single-use

### Sending Messages

```
client.sendMessage(conversationId, message) → { success }
```

### Adding Reactions

```
client.react(conversationId, messageId, emoji, remove?) → { success, action }
```

## Communication Guidelines

### Owner Channel

The owner conversation (`ownerConversationId`) is your primary communication channel with the operator. Use it for:

- Status updates and notifications
- Requesting approvals for actions
- Reporting errors or issues
- Asking clarifying questions

### Creating Purpose-Specific Conversations

When the operator asks you to communicate with others or manage different topics:

1. Create a new conversation with a descriptive name
2. Generate an invite link
3. Share the invite with the intended recipients
4. Use that conversation for its designated purpose

Example workflow:

```
"I need you to coordinate with my team on Project X"

1. Create conversation: client.createConversation("Project X Coordination")
2. Get invite: client.getInvite(newConversationId)
3. Reply: "I've created a conversation for Project X.
   Share this invite link with your team: https://convos.app/join/..."
4. Use that conversation for all Project X discussions
```

### Privacy Considerations

- Each conversation has an isolated identity - users in one conversation cannot link you to another
- Display names and avatars are per-conversation (no global profile)
- The owner can configure different personas in different conversations

## Message Targeting

When sending messages via Convos:

- Target by conversation ID (32-char hex): `a3aa5c564c072b6be8478409d72aa091`
- The ID is returned when creating or listing conversations
- To reply in the owner channel, use the `ownerConversationId` from config

## Error Handling

Common scenarios:

- **Invalid invite**: The invite may be expired or revoked
- **Join pending**: Some joins require approval from the conversation creator
- **Connection issues**: Check network, try `env: "dev"` for testing

## Configuration Reference

```json
{
  "channels": {
    "convos": {
      "enabled": true,
      "privateKey": "0x...",
      "env": "production",
      "ownerConversationId": "abc123...",
      "dmPolicy": "pairing"
    }
  }
}
```

Key fields:

- `privateKey`: XMTP identity key (hex, auto-generated on first run)
- `env`: XMTP environment (production/dev)
- `ownerConversationId`: The conversation for operator communication
- `dmPolicy`: Sender access policy (pairing/allowlist/open/disabled). Controls who can message the agent in group conversations.
