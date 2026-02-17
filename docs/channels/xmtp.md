---
summary: "XMTP decentralized messaging via Agent SDK"
read_when:
  - Setting up XMTP channel
  - Working on decentralized messaging
title: "XMTP"
---

# XMTP

**Status:** Optional plugin (disabled by default).

XMTP is a decentralized messaging protocol. This channel enables OpenClaw to send and receive DMs and group messages via the XMTP Agent SDK, using an Ethereum wallet identity. ENS names are resolved automatically for human-readable addressing.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    XMTP DMs default to pairing mode.
  </Card>
  <Card title="Channel troubleshooting" icon="wrench" href="/channels/troubleshooting">
    Cross-channel diagnostics and repair flow.
  </Card>
  <Card title="Gateway configuration" icon="settings" href="/gateway/configuration">
    Full channel config patterns and examples.
  </Card>
</CardGroup>

## Install

### Onboarding (recommended)

The onboarding wizard (`openclaw onboard`) and `openclaw channels add` list optional channel plugins. Selecting XMTP prompts you to install the plugin on demand.

Install defaults:

- **Dev channel + git checkout available:** uses the local plugin path.
- **Stable/Beta:** downloads from npm.

### Manual install

```bash
openclaw plugins install @openclaw/xmtp
```

Use a local checkout (dev workflows):

```bash
openclaw plugins install --link <path-to-openclaw>/extensions/xmtp
```

Restart the Gateway after installing or enabling plugins.

## Quick setup

<Steps>
  <Step title="Choose environment">
    XMTP supports `production` and `dev` environments. Use `production` for real messaging, `dev` for testing.
  </Step>

  <Step title="Generate or provide keys">
    The onboarding wizard can generate random keys automatically. If you have an existing wallet, provide your own.

    Required keys:

    - **Wallet key**: Ethereum private key (hex). Determines your XMTP agent identity.
    - **DB encryption key**: Encryption key for local XMTP message storage.

  </Step>

  <Step title="Configure in openclaw.json">

```json5
{
  channels: {
    xmtp: {
      enabled: true,
      walletKey: "0xYOUR_PRIVATE_KEY",
      dbEncryptionKey: "YOUR_DB_ENCRYPTION_KEY",
      env: "production",
    },
  },
}
```

  </Step>

  <Step title="Set owner address (optional)">
    The owner address is auto-paired and a DM conversation is created on startup.

```json5
{
  channels: {
    xmtp: {
      ownerAddress: "0xYOUR_ADDRESS", // or "name.eth"
    },
  },
}
```

  </Step>

  <Step title="Start gateway and verify">

```bash
openclaw gateway
```

    The agent's public address is logged on startup and backfilled to config automatically. Use `/address` in any channel to print it.

  </Step>
</Steps>

<Note>
Never commit private keys. Use environment variables or a secrets manager for `walletKey` and `dbEncryptionKey`.
</Note>

## Configuration reference

| Key               | Type     | Default                              | Description                                                  |
| ----------------- | -------- | ------------------------------------ | ------------------------------------------------------------ |
| `enabled`         | boolean  | `true`                               | Enable/disable channel                                       |
| `name`            | string   | -                                    | Display name                                                 |
| `walletKey`       | string   | required                             | Wallet private key (hex). Determines agent identity.         |
| `dbEncryptionKey` | string   | required                             | Encryption key for local XMTP storage                        |
| `env`             | string   | `production`                         | XMTP environment: `production` or `dev`                      |
| `debug`           | boolean  | `false`                              | Enable debug logging                                         |
| `dmPolicy`        | string   | `pairing`                            | DM access policy: `pairing`, `allowlist`, `open`, `disabled` |
| `allowFrom`       | string[] | `[]`                                 | Allowed sender addresses or ENS names                        |
| `groupPolicy`     | string   | `open`                               | Group message policy: `open`, `allowlist`, `disabled`        |
| `groups`          | string[] | `[]`                                 | Allowed conversation IDs (`"*"` for all)                     |
| `textChunkLimit`  | integer  | `4000`                               | Outbound text chunk size (chars, min 4000)                   |
| `publicAddress`   | string   | -                                    | Ethereum address (derived from walletKey if not set)         |
| `ownerAddress`    | string   | -                                    | Owner address or ENS name (auto-paired)                      |
| `web3BioApiKey`   | string   | -                                    | API key for ENS resolution via web3.bio                      |
| `pinataApiKey`    | string   | -                                    | Pinata API key for IPFS media upload                         |
| `pinataSecretKey` | string   | -                                    | Pinata secret key for IPFS media upload                      |
| `ipfsGatewayUrl`  | string   | `https://gateway.pinata.cloud/ipfs/` | Custom IPFS gateway URL                                      |
| `markdown.tables` | string   | `code`                               | Table rendering: `off`, `bullets`, `code`                    |

## Access control

<Tabs>
  <Tab title="DM policy">
    `channels.xmtp.dmPolicy` controls direct message access:

    - `pairing` (default): unknown senders get a pairing code.
    - `allowlist`: only addresses in `allowFrom` can DM.
    - `open`: public inbound DMs (requires `allowFrom` to include `"*"`).
    - `disabled`: ignore inbound DMs.

    The owner address (if configured) is always allowed unless DMs are fully disabled.

    `channels.xmtp.allowFrom` accepts Ethereum addresses and ENS names. ENS names are resolved at access-check time via the configured ENS resolver.

    Pairing approval:

```bash
openclaw pairing list xmtp
openclaw pairing approve xmtp <CODE>
```

    Pairing codes expire after 1 hour.

  </Tab>

  <Tab title="Group policy">
    `channels.xmtp.groupPolicy` controls group message handling:

    - `open` (default): all group conversations allowed.
    - `allowlist`: only conversations in `channels.xmtp.groups` are allowed.
    - `disabled`: ignore all group messages.

    Allowlist example:

```json5
{
  channels: {
    xmtp: {
      groupPolicy: "allowlist",
      groups: ["conversation-id-1", "conversation-id-2"],
    },
  },
}
```

    Include `"*"` in `groups` to allow all conversations while keeping the policy set to `allowlist`.

  </Tab>
</Tabs>

## Feature details

<AccordionGroup>
  <Accordion title="ENS resolution">
    XMTP resolves ENS names automatically using the [web3.bio](https://web3.bio) API.

    Resolution applies to:

    - **Sender address**: resolved to ENS name and passed as `SenderName` in the agent context.
    - **Group members**: all member addresses are resolved and formatted with ENS names.
    - **Message content**: ENS names and Ethereum addresses mentioned in text are resolved and injected as `[ENS Context]` blocks.
    - **Outbound targets**: ENS names in `to` fields are resolved to addresses before sending.
    - **Allowlists**: ENS names in `allowFrom` are resolved at access-check time.
    - **Owner address**: `ownerAddress` can be an ENS name; resolved on startup.

    Caching:

    - Results are cached in memory for 5 minutes (bidirectional: name-to-address and address-to-name).
    - Failed network requests are not cached (retried on next lookup).
    - Up to 3 retries with exponential backoff (100ms, 200ms, 400ms).

    The resolver fails open: unresolvable names return `null` and do not block message processing.

    For higher rate limits, provide a `web3BioApiKey`.

  </Accordion>

  <Accordion title="Media attachments">
    XMTP supports media via encrypted remote attachments.

    **Inbound:**

    - Remote attachments are downloaded, decrypted, and saved to the media pipeline.
    - Inline attachments (raw bytes) are saved directly.
    - Multi-attachments are supported.

    **Outbound (requires Pinata IPFS):**

    - Media is downloaded, encrypted via the XMTP Agent SDK, and uploaded to Pinata IPFS.
    - A `RemoteAttachment` is sent referencing the IPFS URL.
    - Maximum file size: 25 MB.
    - If Pinata credentials are not configured, media URLs are sent as plain text fallback.

    Configure Pinata credentials:

```json5
{
  channels: {
    xmtp: {
      pinataApiKey: "YOUR_API_KEY",
      pinataSecretKey: "YOUR_SECRET_KEY",
      ipfsGatewayUrl: "https://gateway.pinata.cloud/ipfs/", // optional
    },
  },
}
```

    The agent prompt automatically indicates whether media sending is available based on Pinata configuration.

  </Accordion>

  <Accordion title="Reactions">
    XMTP supports emoji reactions on messages.

    **Inbound:** reactions are formatted as descriptive text (`[Reaction: <emoji> added/removed to message <ref>]`) and processed through the normal inbound pipeline.

    **Outbound:** use the `react` message action:

```json5
{
  action: "react",
  channel: "xmtp",
  to: "<conversation-id>",
  messageId: "<message-id>",
  emoji: "👍",
}
```

    To remove a reaction, pass `remove: true`.

  </Accordion>

  <Accordion title="Message actions">
    Available message actions when XMTP accounts are configured:

    - `send`: send a text message. Parameters: `to` (address, ENS name, or conversation topic), `message`.
    - `react`: add or remove a reaction. Parameters: `to` (conversation ID), `messageId`, `emoji`, optional `remove`.

    XMTP does not support inline buttons.

  </Accordion>

  <Accordion title="Markdown table rendering">
    XMTP clients have limited markdown table support. The `markdown.tables` config controls how tables are rendered in outbound messages:

    - `code` (default): wrap tables in code blocks.
    - `bullets`: convert tables to bullet lists.
    - `off`: pass tables through unmodified.

  </Accordion>
</AccordionGroup>

## Runtime behavior

- Gateway owns the XMTP connection via the Agent SDK.
- Routing is deterministic: XMTP inbound replies back to XMTP.
- DM and group conversations use conversation-ID-based session keys.
- The agent listens for `text`, `markdown`, `reaction`, `attachment`, `inline-attachment`, and `multi-attachment` events.
- Messages from denied contacts are silently skipped.
- The public address is backfilled to config on first startup if not already set.
- When an `ownerAddress` is configured, a DM conversation is proactively created on startup.

## Commands

- `/address` — prints the XMTP agent's public Ethereum address.

## Troubleshooting

<AccordionGroup>
  <Accordion title="Not receiving messages">

    - Verify `walletKey` and `dbEncryptionKey` are valid.
    - Confirm `enabled` is not `false`.
    - Check Gateway logs for XMTP agent errors: `openclaw logs --follow`.
    - Verify the sender's wallet is registered on the same XMTP environment (`production` vs `dev`).
    - Run `openclaw channels status --probe` to test connectivity.

  </Accordion>

  <Accordion title="DM blocked unexpectedly">

    - Check `dmPolicy` setting.
    - If `allowlist`, verify the sender address is in `allowFrom`.
    - If `pairing`, check for pending pairing requests: `openclaw pairing list xmtp`.
    - Owner address is always allowed (unless `dmPolicy` is `disabled`).
    - ENS names in `allowFrom` require a working ENS resolver.

  </Accordion>

  <Accordion title="ENS resolution not working">

    - Verify outbound HTTPS connectivity to `api.web3.bio`.
    - If rate-limited, configure `web3BioApiKey`.
    - The resolver fails open: unresolvable names do not block messages, but ENS names in allowlists will not match.

  </Accordion>

  <Accordion title="Media upload fails">

    - Verify `pinataApiKey` and `pinataSecretKey` are correct.
    - Check file size is under 25 MB.
    - Verify outbound HTTPS connectivity to `api.pinata.cloud`.
    - Without Pinata credentials, media URLs are sent as plain text.

  </Accordion>

  <Accordion title="Agent address not showing">

    - The public address is derived from `walletKey` and backfilled to config on startup.
    - Use `/address` to check the current address.
    - If not configured, run `openclaw onboard` or set `walletKey` manually.

  </Accordion>
</AccordionGroup>

## Security

- Never commit wallet keys or DB encryption keys.
- Use environment variables for sensitive fields.
- Consider `allowlist` DM policy for production bots.
- Media attachments are encrypted end-to-end via the XMTP protocol.

## Related

- [Pairing](/channels/pairing)
- [Channel routing](/channels/channel-routing)
- [Troubleshooting](/channels/troubleshooting)
