---
summary: "XMTP channel for decentralized messaging"
read_when:
  - You want OpenClaw to receive DMs via XMTP
  - You're setting up decentralized or wallet-based messaging
title: "XMTP"
---

# XMTP

**Status:** Community plugin (install separately).

XMTP is a decentralized messaging protocol. This channel connects OpenClaw to XMTP apps (e.g. Converse, Coinbase Wallet) so the gateway can receive and send messages over XMTP.

## Install

Install the community plugin from npm:

```bash
npm install xmtp-openclaw-channel
# or
yarn add xmtp-openclaw-channel
pnpm add xmtp-openclaw-channel
```

Add the plugin to OpenClaw so it is loaded at runtime. For example, add the plugin path to your config:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/your/node_modules/xmtp-openclaw-channel/dist"]
    }
  }
}
```

Or point at the package root if your loader resolves `index.js` from the package:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/your/node_modules/xmtp-openclaw-channel"]
    }
  }
}
```

Restart the Gateway after installing or changing plugin paths.

## Register the channel

The plugin exposes a default export that registers the XMTP channel with the OpenClaw API. OpenClaw's plugin loader will call it when the plugin is loaded; ensure the plugin is in `plugins.load.paths` (or equivalent) and that the built output includes `dist/openclaw.plugin.json` (run `yarn build` or `npm run build` in the package if you installed from source).

## Configuration

Configure the XMTP channel under `channels.xmtp`:

```json
{
  "channels": {
    "xmtp": {
      "enabled": true,
      "accounts": {
        "default": {
          "walletKey": "0x...",
          "dbEncryptionKey": "0x...",
          "env": "production"
        }
      },
      "dmPolicy": "pairing"
    }
  }
}
```

| Key                 | Type   | Default       | Description                                    |
| ------------------- | ------ | ------------- | ---------------------------------------------- |
| `enabled`           | boolean| `true`        | Enable/disable the channel                     |
| `accounts`          | object | required      | Map of account id → config                     |
| `accounts.<id>.walletKey` | string | required | Ethereum private key for the XMTP agent wallet |
| `accounts.<id>.dbEncryptionKey` | string | required | Key for encrypting the local XMTP database     |
| `accounts.<id>.env` | string | `"production"` | `dev` or `production`                         |
| `dmPolicy`          | string | `pairing`     | DM access policy                               |

Use environment variables for secrets (e.g. `"walletKey": "${XMTP_WALLET_KEY}"`).

## Features

- **DMs:** Direct conversations with wallet addresses.
- **Groups:** XMTP group support (MLS).
- **Text:** Inbound text forwarded to the gateway; outbound via the channel send pipeline.
- **Media:** Optional outbound via remote attachments where supported.

## Dependencies

- `@xmtp/agent-sdk` — provided by the plugin.
- Node 22+.

If the Gateway reports missing `viem` or `ethers`, install them in the **OpenClaw app** (not in the plugin package); they are required by OpenClaw's blockchain tooling.

## Troubleshooting

### Plugin manifest not found

OpenClaw looks for `openclaw.plugin.json` in the plugin root (e.g. `dist/openclaw.plugin.json`). Build the plugin so `dist/` contains the manifest: run `yarn build` or `npm run build` in the plugin directory.

### Unknown channel id: xmtp

The plugin manifest must list the channel, e.g. `"channels": ["xmtp"]`. Rebuild the plugin so the manifest is up to date.

### Module resolution (Yarn PnP)

If using Yarn 4 with Plug'n'Play, set `nodeLinker: node-modules` in the plugin's `.yarnrc.yml` and run `yarn install` so dependencies are laid out on disk for the OpenClaw loader.

## Security

- Never commit wallet or encryption keys.
- Use environment variables or a secrets manager for `walletKey` and `dbEncryptionKey`.
- Prefer `dmPolicy: "pairing"` or an allowlist for production.
