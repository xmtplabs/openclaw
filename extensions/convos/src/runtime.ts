import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setConvosRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getConvosRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("Convos runtime not initialized");
  }
  return runtime;
}

// Setup-active flag: when true, probes should be skipped to avoid
// hitting the XMTP "10/10 installations" limit with the old identity.
let setupActive = false;

export function isConvosSetupActive(): boolean {
  return setupActive;
}

export function setConvosSetupActive(active: boolean) {
  setupActive = active;
}
