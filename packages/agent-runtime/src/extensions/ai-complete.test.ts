import { describe, expect, it } from "vitest";
import { TrustedExtensionRunner } from "./runner.js";
import type { TrustedExtensionBridge } from "./runner.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fakeBridge() {
  const log: { aiCompletes: unknown[] } = { aiCompletes: [] };
  const bridge: TrustedExtensionBridge = {
    sessionId: "s1",
    cwd: process.cwd(),
    getModel: () => undefined,
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    isIdle: () => true,
    getAbortSignal: () => undefined,
    abort: () => {},
    hasPendingMessages: () => false,
    getContextUsage: () => undefined,
    compact: () => {},
    getSystemPrompt: () => "",
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => {},
    getSessionName: () => undefined,
    setSessionName: () => {},
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    turnFacts: async () => undefined,
    recapSession: async () => ({ messages: [], truncated: false }),
    continueTurn: async () => undefined,
    aiComplete: async (input) => {
      log.aiCompletes.push(input);
      return { ok: true, text: "enhanced", modelKey: "openai/gpt" };
    },
    requestUi: async (_e, r) => ({ kind: r.kind }) as never,
    publishCommands: () => {},
    publishDiagnostics: () => {},
  };
  return { bridge, log };
}

describe("extension pi.ai.complete", () => {
  it("refuses without agent.model.complete / agent.complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ai-"));
    const entry = join(dir, "ext.ts");
    writeFileSync(
      entry,
      `export default function (pi: any) {
  pi.on("session_start", async () => {
    (globalThis as any).__ai = await pi.ai.complete({ messages: [{ role: "user", content: "x" }] });
  });
}`,
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({
      specs: [
        {
          id: entry,
          entry,
          label: "no-perm",
          source: "user",
          root: dir,
          permissions: ["agent.extension"],
        },
      ],
      bridge,
    });
    await runner.load();
    expect(log.aiCompletes).toEqual([]);
    expect((globalThis as { __ai?: unknown }).__ai).toEqual({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({
        kind: "permission_denied",
        member: "ai.complete",
      }),
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("calls the host bridge when the plugin holds agent.model.complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ai-"));
    const entry = join(dir, "ext.ts");
    writeFileSync(
      entry,
      `export default function (pi: any) {
  pi.on("session_start", async () => {
    (globalThis as any).__ai = await pi.ai.complete({
      purpose: "prompt-enhance",
      messages: [{ role: "user", content: "hello" }],
      system: "only this system",
    });
  });
}`,
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({
      specs: [
        {
          id: entry,
          entry,
          label: "ai-ok",
          source: "user",
          root: dir,
          permissions: ["agent.extension", "agent.model.complete"],
        },
      ],
      bridge,
    });
    await runner.load();
    expect(log.aiCompletes).toHaveLength(1);
    expect(log.aiCompletes[0]).toMatchObject({
      pluginId: entry,
      purpose: "prompt-enhance",
      system: "only this system",
      permissions: ["agent.extension", "agent.model.complete"],
    });
    expect((globalThis as { __ai?: unknown }).__ai).toEqual({
      ok: true,
      text: "enhanced",
      modelKey: "openai/gpt",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
