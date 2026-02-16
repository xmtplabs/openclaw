# XMTP Channel Documentation Design

## Goal

Write channel documentation for the XMTP extension at `docs/channels/xmtp.md`, following established conventions from existing channel docs (Discord, Telegram, Nostr).

## Approach

Hybrid style: Nostr-level conciseness with targeted Mintlify components (`<Steps>`, `<Tabs>`, `<AccordionGroup>`) for features that need expansion.

## Document Structure

1. **Frontmatter + header**: summary, read_when, title. Status line. Brief XMTP description. `<CardGroup>` with links to Pairing, Troubleshooting, Gateway configuration.

2. **Install**: Onboarding wizard, manual `openclaw plugins install`, local dev link.

3. **Quick setup** (`<Steps>`): Choose env, generate/provide keys, configure JSON, set owner address, start gateway.

4. **Configuration reference** (table): All fields from Zod schema — walletKey, dbEncryptionKey, env, dmPolicy, allowFrom, groupPolicy, groups, textChunkLimit, ownerAddress, publicAddress, web3BioApiKey, pinataApiKey, pinataSecretKey, ipfsGatewayUrl, debug, markdown.

5. **Access control** (`<Tabs>`): DM policy tab (pairing/allowlist/open/disabled, owner auto-allow, ENS in allowlist). Group policy tab (open/allowlist/disabled, conversation ID allowlist).

6. **Feature details** (`<AccordionGroup>`): ENS resolution, media attachments (inbound + outbound via Pinata IPFS), reactions, message actions, markdown tables.

7. **Runtime behavior**: Gateway ownership, deterministic routing, session keys.

8. **Commands**: `/address` command.

9. **Troubleshooting** (`<AccordionGroup>`): Common issues.

10. **Related links**: Pairing, Channel routing, Troubleshooting.

## Source files referenced

- `extensions/xmtp/openclaw.plugin.json` — plugin manifest
- `extensions/xmtp/src/config-schema.ts` — Zod config schema
- `extensions/xmtp/src/channel.ts` — channel adapter
- `extensions/xmtp/src/dm-policy.ts` — DM/group policy
- `extensions/xmtp/src/outbound.ts` — outbound + IPFS
- `extensions/xmtp/src/gateway-lifecycle.ts` — start/stop + ENS
- `extensions/xmtp/src/actions.ts` — message actions (send, react)
- `extensions/xmtp/src/lib/ens-resolver.ts` — ENS resolver
- `extensions/xmtp/src/setup.ts` — setup flow
- `extensions/xmtp/src/onboarding.ts` — onboarding wizard
- `extensions/xmtp/src/xmtp-commands.ts` — /address command
