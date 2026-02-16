/**
 * E2E test helpers for XMTP extension tests.
 * Uses real XMTP agents on the dev network.
 */

import { Agent, createSigner, createUser } from "@xmtp/agent-sdk";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type TestAgent = {
  agent: Agent;
  address: string;
  dbDir: string;
};

/**
 * Create a test XMTP agent on the dev network with a random wallet.
 */
export async function createTestXmtpAgent(): Promise<TestAgent> {
  const user = createUser();
  const signer = createSigner(user);
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "xmtp-test-"));
  const agent = await Agent.create(signer, {
    env: "dev",
    dbPath: dbDir,
  });
  return {
    agent,
    address: user.account.address,
    dbDir,
  };
}

/**
 * Wait for the next text message on an agent that matches the predicate.
 */
export function waitForMessage(
  agent: Agent,
  predicate?: (content: string, sender: string) => boolean,
  timeoutMs = 30_000,
): Promise<{ content: string; sender: string; conversationId: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`waitForMessage timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    agent.on("text", async (ctx) => {
      if (settled) return;
      const sender = await ctx.getSenderAddress();
      if (!sender) return;
      const content = ctx.message.content;
      const conversationId = (ctx.conversation?.id ?? "") as string;
      if (!predicate || predicate(content, sender)) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ content, sender, conversationId });
      }
    });
  });
}

/**
 * Cleanup test agents: stop and remove temp DB directories.
 */
export async function cleanupAgents(...agents: TestAgent[]): Promise<void> {
  for (const { agent, dbDir } of agents) {
    try {
      await agent.stop();
    } catch {
      // ignore stop errors during cleanup
    }
    try {
      fs.rmSync(dbDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
