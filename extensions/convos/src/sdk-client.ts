/**
 * ConvosInstance — thin wrapper around the `convos` CLI binary.
 *
 * 1 process = 1 conversation. No pool. No routing. No library imports.
 * All operations shell out to `convos <command> --json`.
 * Streaming uses long-lived child processes with JSONL stdout parsing.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { CreateConversationResult, InviteResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ---- Types ----

export interface ConvosInstanceOptions {
  onMessage?: (msg: InboundMessage) => void;
  onJoinAccepted?: (info: { joinerInboxId: string }) => void;
  debug?: boolean;
}

export interface InboundMessage {
  conversationId: string;
  messageId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: Date;
}

// ---- Binary resolution ----

let cachedBinPath: string | undefined;

/** Resolve the `convos` CLI binary from the installed @convos/cli package. */
function resolveConvosBin(): string {
  if (cachedBinPath) return cachedBinPath;
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@convos/cli/package.json");
    const binPath = path.join(path.dirname(pkgPath), "bin", "run.js");
    cachedBinPath = binPath;
    return binPath;
  } catch {
    // Fallback: assume `convos` is on PATH
    cachedBinPath = "convos";
    return "convos";
  }
}

// ---- ConvosInstance ----

export class ConvosInstance {
  /** The one conversation this instance is bound to. */
  readonly conversationId: string;
  readonly identityId: string;
  readonly label: string | undefined;

  private env: "production" | "dev";
  private children: ChildProcess[] = [];
  private running = false;
  private onMessage?: (msg: InboundMessage) => void;
  private onJoinAccepted?: (info: { joinerInboxId: string }) => void;
  private debug: boolean;

  private constructor(params: {
    conversationId: string;
    identityId: string;
    label?: string;
    env: "production" | "dev";
    options?: ConvosInstanceOptions;
  }) {
    this.conversationId = params.conversationId;
    this.identityId = params.identityId;
    this.label = params.label;
    this.env = params.env;
    this.onMessage = params.options?.onMessage;
    this.onJoinAccepted = params.options?.onJoinAccepted;
    this.debug = params.options?.debug ?? false;
  }

  // ---- CLI helpers ----

  /** Run a convos command and return raw stdout. */
  private async exec(args: string[]): Promise<string> {
    const bin = resolveConvosBin();
    const finalArgs = [...args, "--env", this.env];
    if (this.debug) console.log(`[convos] exec: convos ${finalArgs.join(" ")}`);
    const { stdout } = await execFileAsync(
      bin === "convos" ? bin : process.execPath,
      bin === "convos" ? finalArgs : [bin, ...finalArgs],
      { env: { ...process.env, CONVOS_ENV: this.env } },
    );
    return stdout;
  }

  /** Run a convos command with --json and parse the output. */
  private async execJson<T>(args: string[]): Promise<T> {
    const stdout = await this.exec([...args, "--json"]);
    return JSON.parse(stdout.trim()) as T;
  }

  /** Spawn a long-lived convos command and return the child process. */
  private spawnChild(args: string[]): ChildProcess {
    const bin = resolveConvosBin();
    const finalArgs = [...args, "--env", this.env, "--json"];
    if (this.debug) console.log(`[convos] spawn: convos ${finalArgs.join(" ")}`);
    const child = spawn(
      bin === "convos" ? bin : process.execPath,
      bin === "convos" ? finalArgs : [bin, ...finalArgs],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CONVOS_ENV: this.env },
      },
    );
    this.children.push(child);
    return child;
  }

  // ==== Factory Methods ====

  /** Restore from config (gateway restart). No CLI call needed — just construct. */
  static fromExisting(
    conversationId: string,
    identityId: string,
    env: "production" | "dev",
    options?: ConvosInstanceOptions,
    label?: string,
  ): ConvosInstance {
    return new ConvosInstance({ conversationId, identityId, label, env, options });
  }

  /** Create a new conversation via `convos conversations create`. */
  static async create(
    env: "production" | "dev",
    params?: { name?: string; profileName?: string },
    options?: ConvosInstanceOptions,
  ): Promise<{ instance: ConvosInstance; result: CreateConversationResult }> {
    const args = ["conversations", "create"];
    if (params?.name) args.push("--name", params.name);
    if (params?.profileName) args.push("--profile-name", params.profileName);

    // Use a temporary instance to access exec helpers
    const tmp = new ConvosInstance({
      conversationId: "",
      identityId: "",
      env,
      options,
    });
    const data = await tmp.execJson<{
      conversationId: string;
      identityId: string;
      name?: string;
      invite: { slug: string; url: string };
    }>(args);

    const instance = new ConvosInstance({
      conversationId: data.conversationId,
      identityId: data.identityId,
      label: params?.name,
      env,
      options,
    });

    return {
      instance,
      result: {
        conversationId: data.conversationId,
        inviteSlug: data.invite.slug,
        inviteUrl: data.invite.url,
      },
    };
  }

  /** Join a conversation via `convos conversations join`. */
  static async join(
    env: "production" | "dev",
    invite: string,
    params?: { profileName?: string; timeout?: number },
    options?: ConvosInstanceOptions,
  ): Promise<{
    instance: ConvosInstance | null;
    status: "joined" | "waiting_for_acceptance";
    conversationId: string | null;
    identityId: string | null;
  }> {
    const args = ["conversations", "join", invite];
    if (params?.profileName) args.push("--profile-name", params.profileName);
    args.push("--timeout", String(params?.timeout ?? 60));

    const tmp = new ConvosInstance({
      conversationId: "",
      identityId: "",
      env,
      options,
    });
    const data = await tmp.execJson<{
      status: string;
      conversationId?: string;
      identityId: string;
      tag?: string;
      name?: string;
    }>(args);

    if (data.status === "joined" && data.conversationId) {
      const instance = new ConvosInstance({
        conversationId: data.conversationId,
        identityId: data.identityId,
        label: data.name,
        env,
        options,
      });
      return {
        instance,
        status: "joined",
        conversationId: data.conversationId,
        identityId: data.identityId,
      };
    }

    return {
      instance: null,
      status: "waiting_for_acceptance",
      conversationId: null,
      identityId: data.identityId,
    };
  }

  // ==== Lifecycle ====

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Stream messages from this conversation
    const streamChild = this.spawnChild(["conversation", "stream", this.conversationId]);
    this.pumpJsonLines(streamChild, "stream", (data) => {
      // Skip empty/non-text content
      const content = typeof data.content === "string" ? data.content : "";
      if (!content.trim()) return;

      const msg: InboundMessage = {
        conversationId: this.conversationId,
        messageId: (data.id as string) ?? "",
        senderId: (data.senderInboxId as string) ?? "",
        senderName: "",
        content,
        timestamp: data.sentAt ? new Date(data.sentAt as string) : new Date(),
      };
      queueMicrotask(() => {
        try {
          this.onMessage?.(msg);
        } catch (err) {
          if (this.debug) console.error("[convos] onMessage error:", err);
        }
      });
    });

    // Process join requests (creator instances only — joiner instances
    // won't receive join DMs, so this child will be idle for joiners)
    const joinChild = this.spawnChild([
      "conversations",
      "process-join-requests",
      "--watch",
      "--conversation",
      this.conversationId,
    ]);
    this.pumpJsonLines(joinChild, "join-requests", (data) => {
      if (data.event === "join_request_accepted" && data.joinerInboxId) {
        if (this.debug) console.log(`[convos] Join accepted: ${data.joinerInboxId}`);
        this.onJoinAccepted?.({ joinerInboxId: data.joinerInboxId as string });
      }
    });

    if (this.debug) {
      console.log(`[convos] Started: ${this.conversationId.slice(0, 12)}...`);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    for (const child of this.children) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    this.children = [];
    if (this.debug) console.log(`[convos] Stopped: ${this.conversationId.slice(0, 12)}...`);
  }

  isRunning(): boolean {
    return this.running;
  }

  // ==== Operations (all shell out to CLI) ====

  async sendMessage(text: string): Promise<{ success: boolean; messageId?: string }> {
    const data = await this.execJson<{ success: boolean; messageId?: string }>([
      "conversation",
      "send-text",
      this.conversationId,
      "--text",
      text,
    ]);
    return data;
  }

  async react(
    messageId: string,
    emoji: string,
    action: "add" | "remove" = "add",
  ): Promise<{ success: boolean; action: "added" | "removed" }> {
    await this.execJson([
      "conversation",
      "send-reaction",
      this.conversationId,
      messageId,
      action,
      emoji,
    ]);
    return { success: true, action: action === "add" ? "added" : "removed" };
  }

  async getInvite(): Promise<InviteResult> {
    const data = await this.execJson<{ slug: string; url: string }>([
      "conversation",
      "invite",
      this.conversationId,
      "--no-qr",
    ]);
    return { inviteSlug: data.slug };
  }

  async rename(name: string): Promise<void> {
    await this.execJson(["conversation", "update-profile", this.conversationId, "--name", name]);
  }

  async lock(): Promise<void> {
    await this.execJson(["conversation", "lock", this.conversationId, "--force"]);
  }

  async unlock(): Promise<void> {
    await this.execJson(["conversation", "lock", this.conversationId, "--unlock", "--force"]);
  }

  async explode(): Promise<void> {
    await this.execJson(["conversation", "explode", this.conversationId, "--force"]);
    await this.stop();
  }

  // ==== Private: JSONL stream parsing ====

  private pumpJsonLines(
    child: ChildProcess,
    label: string,
    handler: (data: Record<string, unknown>) => void,
  ): void {
    if (!child.stdout) return;

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      try {
        const data = JSON.parse(line);
        handler(data);
      } catch {
        // Non-JSON line (e.g. human-readable output) — skip
        if (this.debug) console.log(`[convos:${label}] non-JSON: ${line}`);
      }
    });

    child.on("exit", (code) => {
      if (this.running && this.debug) {
        console.log(`[convos:${label}] exited with code ${code}`);
      }
    });

    if (child.stderr) {
      const errRl = createInterface({ input: child.stderr });
      errRl.on("line", (line) => {
        if (this.debug) console.error(`[convos:${label}:stderr] ${line}`);
      });
    }
  }
}
