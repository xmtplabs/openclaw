import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { convosPlugin } from "./src/channel.js";
import { setConvosRuntime } from "./src/runtime.js";

const plugin = {
  id: "convos",
  name: "Convos",
  description: "E2E encrypted messaging via XMTP with keys in Keychain",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setConvosRuntime(api.runtime);
    api.registerChannel({ plugin: convosPlugin });
  },
};

export default plugin;
