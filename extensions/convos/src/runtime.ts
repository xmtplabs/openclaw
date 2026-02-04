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
