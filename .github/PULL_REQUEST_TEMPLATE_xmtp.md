## Add XMTP as a documented channel for the OpenClaw community

Hey everyone — this PR adds **XMTP** to the docs so OpenClaw users can connect the gateway to the XMTP ecosystem (Converse, Coinbase Wallet, and other XMTP-enabled apps).

### What’s XMTP?

XMTP is an open, decentralized messaging protocol. Supporting it in the docs means people can run their OpenClaw gateway over XMTP: DMs, groups (MLS), and optional media, all from a single channel config.

### What this PR does

- **New channel doc** ([docs/channels/xmtp.md](docs/channels/xmtp.md)) — Install from npm, configure `channels.xmtp`, and get going. Same structure as other optional channels (Nostr, Matrix, etc.).
- **Channels index** — XMTP is listed in the supported channels so it’s easy to discover.

The implementation lives in the community package [xmtp-openclaw-channel](https://www.npmjs.com/package/xmtp-openclaw-channel) on npm. This PR is docs-only: no core or extension code changes, just a clear path for the community to use XMTP with OpenClaw.

### Why it’s useful

- **Discovery** — One place to see that XMTP is supported and how to set it up.
- **Consistency** — Same install/config/troubleshooting pattern as other optional channels.
- **Decentralized option** — Another way to use OpenClaw without depending on a single messaging provider.

If this lands, users can add XMTP via npm, drop in `channels.xmtp` config, and start chatting with their gateway from any XMTP app.

---

**Checklist**

- [x] Documentation only (no `src/` or `extensions/` changes).
- [x] Doc follows existing channel doc style.
- [x] Channels index updated with an XMTP entry.
