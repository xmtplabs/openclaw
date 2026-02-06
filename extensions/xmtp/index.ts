import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { xmtpPlugin } from "./src/channel.js";
import { setXmtpRuntime } from "./src/runtime.js";
import { registerXmtpCommands } from "./src/xmtp-commands.js";

const plugin = {
  id: "xmtp",
  name: "XMTP",
  description: "XMTP decentralized messaging channel",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setXmtpRuntime(api.runtime);
    api.registerChannel({ plugin: xmtpPlugin });
    registerXmtpCommands(api);
  },
};

export default plugin;
