import {
  type ChannelOnboardingAdapter,
  type ChannelOnboardingDmPolicy,
  type OpenClawConfig,
} from "openclaw/plugin-sdk";
import type { DmPolicy } from "./config-types.js";
import {
  getXmtpSection,
  listXmtpAccountIds,
  resolveXmtpAccount,
  updateXmtpSection,
  type CoreConfig,
} from "./accounts.js";
import { isEnsName } from "./lib/ens-resolver.js";
import { generateXmtpIdentity, walletAddressFromPrivateKey } from "./lib/identity.js";
import { runTemporaryXmtpClient } from "./lib/xmtp-client.js";

const channel = "xmtp" as const;

function setXmtpDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  return updateXmtpSection(cfg, { dmPolicy });
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "XMTP",
  channel,
  policyKey: "channels.xmtp.dmPolicy",
  allowFromKey: "channels.xmtp.allowFrom",
  getCurrent: (cfg) => getXmtpSection(cfg as CoreConfig)?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setXmtpDmPolicy(cfg, policy),
};

export const xmtpOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,

  getStatus: async ({ cfg }) => {
    const configured = listXmtpAccountIds(cfg as CoreConfig).some(
      (accountId) => resolveXmtpAccount({ cfg: cfg as CoreConfig, accountId }).configured,
    );
    const account = resolveXmtpAccount({ cfg: cfg as CoreConfig });

    return {
      channel,
      configured,
      statusLines: [
        `XMTP: ${configured ? "configured" : "needs setup"}`,
        `Environment: ${account.env}`,
      ].filter(Boolean),
      selectionHint: configured ? "ready" : "wallet key, db key, env",
      quickstartScore: 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    let next = cfg;
    const account = resolveXmtpAccount({ cfg: next as CoreConfig });

    if (account.configured) {
      const action = await prompter.select({
        message: "XMTP already configured.",
        options: [
          { value: "generate" as const, label: "Generate new one" },
          { value: "check" as const, label: "Check our current one" },
          { value: "skip" as const, label: "Skip" },
        ],
        initialValue: "skip",
      });
      if (action === "check") {
        const publicAddress = walletAddressFromPrivateKey(account.walletKey);
        await prompter.note("Initializing XMTP client…", "XMTP");
        try {
          await runTemporaryXmtpClient({
            walletKey: account.walletKey,
            dbEncryptionKey: account.dbEncryptionKey,
            env: account.env,
          });
          await prompter.note(
            `XMTP client verified.\n\nPublic address: ${publicAddress}`,
            "Verify client",
          );
        } catch (err) {
          await prompter.note(
            `Client verification failed: ${err instanceof Error ? err.message : String(err)}`,
            "Verify client",
          );
        }
        return { cfg: next };
      }
      if (action === "skip") {
        return { cfg: next };
      }
    }

    const env = (await prompter.select({
      message: "Environment",
      options: [
        { value: "production" as const, label: "Production" },
        { value: "dev" as const, label: "Dev" },
      ],
      initialValue: "production",
    })) as "production" | "dev";

    const keySource = await prompter.select({
      message: "Keys",
      options: [
        { value: "random" as const, label: "Random (generate new keys)" },
        { value: "custom" as const, label: "Custom (enter existing keys)" },
      ],
      initialValue: "random",
    });

    let walletKey: string;
    let dbEncryptionKey: string;

    let publicAddress: string;

    if (keySource === "random") {
      const identity = generateXmtpIdentity();
      walletKey = identity.walletKey;
      dbEncryptionKey = identity.dbEncryptionKey;
      publicAddress = identity.publicAddress;
    } else {
      walletKey = await prompter.text({
        message: "Wallet key (private key)",
        validate: (value) => {
          const raw = String(value ?? "").trim();
          return raw ? undefined : "Required";
        },
      });
      dbEncryptionKey = await prompter.text({
        message: "DB encryption key",
        validate: (value) => {
          const raw = String(value ?? "").trim();
          return raw ? undefined : "Required";
        },
      });
      walletKey = walletKey.trim();
      dbEncryptionKey = dbEncryptionKey.trim();
      publicAddress = walletAddressFromPrivateKey(walletKey);
    }

    next = updateXmtpSection(next, {
      enabled: true,
      walletKey,
      dbEncryptionKey,
      env,
      publicAddress,
    });

    await prompter.note("Initializing XMTP client…", "XMTP");

    try {
      await runTemporaryXmtpClient({ walletKey, dbEncryptionKey, env });
      await prompter.note(
        `XMTP configured. Keys saved to config.\n\nPublic address: ${publicAddress}\n\nSave this address; it identifies your XMTP identity.`,
        "XMTP",
      );
    } catch (err) {
      await prompter.note(
        `Client initialization failed: ${err instanceof Error ? err.message : String(err)}\n\nKeys were saved to config. You can retry or start the gateway later.`,
        "XMTP",
      );
    }

    const ownerAddr = await prompter.text({
      message: "Owner wallet address or ENS name (auto-paired, press Enter to skip)",
      placeholder: "0x... or name.eth",
      validate: (value) => {
        const raw = String(value ?? "").trim();
        if (!raw) return undefined; // optional
        if (isEnsName(raw)) return undefined; // ENS name accepted
        if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return "Invalid Ethereum address or ENS name";
        return undefined;
      },
    });
    if (ownerAddr?.trim()) {
      next = updateXmtpSection(next, { ownerAddress: ownerAddr.trim() });
    }

    return { cfg: next };
  },

  dmPolicy,

  disable: (cfg) => updateXmtpSection(cfg, { enabled: false }),
};
