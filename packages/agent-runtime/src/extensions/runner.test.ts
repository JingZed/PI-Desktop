import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REGISTERED_SLOT_PERMISSIONS,
  TRUSTED_EXTENSION_API_PERMISSIONS,
  trustedExtensionApiPermission,
  trustedExtensionEventPermission,
  TRUSTED_EXTENSION_EVENT_PERMISSIONS,
  TRUSTED_EXTENSION_HANDLER_TIMEOUT_MS,
} from "@pi-desktop/shared";
import {
  clearTrustedExtensionCache,
  TRUSTED_EXTENSION_EVENTS,
  TrustedExtensionRunner,
} from "./runner.js";
import type {
  TrustedExtensionBridge,
  TrustedExtensionCommand,
  TrustedExtensionDiagnostic,
  TrustedExtensionSpec,
  TrustedExtensionUiRequest,
  TrustedExtensionUiResponse,
} from "./index.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pi-ext-runner-"));
  clearTrustedExtensionCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * One extension module on disk. `permissions` is the set its owning plugin was
 * loaded with; absent means the plugin holds nothing, which is what the slot
 * gate refuses on (ADR 0291 rule 2).
 */
function spec(name: string, source: string, permissions?: readonly string[]): TrustedExtensionSpec {
  const entry = join(root, `${name}.ts`);
  writeFileSync(entry, source);
  return {
    id: entry,
    entry,
    label: name,
    source: "user",
    root,
    ...(permissions ? { permissions } : {}),
  };
}

type BridgeLog = {
  commands: TrustedExtensionCommand[][];
  diagnostics: TrustedExtensionDiagnostic[][];
  ui: TrustedExtensionUiRequest[];
  sessionName?: string;
  userMessages: unknown[];
  /** Turn aborts the extension asked for through `requestTurnAbort`. */
  aborts: number;
};

function fakeBridge(
  answers: Partial<Record<TrustedExtensionUiRequest["kind"], TrustedExtensionUiResponse>> = {},
  abortSignal?: AbortSignal,
): { bridge: TrustedExtensionBridge; log: BridgeLog } {
  const log: BridgeLog = { commands: [], diagnostics: [], ui: [], userMessages: [], aborts: 0 };
  const bridge: TrustedExtensionBridge = {
    sessionId: "s1",
    cwd: root,
    getModel: () => ({ id: "m" }),
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => {},
    isIdle: () => true,
    getAbortSignal: () => abortSignal,
    abort: () => {
      log.aborts += 1;
    },
    hasPendingMessages: () => false,
    getContextUsage: () => ({ tokens: 1, contextWindow: 10, percent: 10 }),
    compact: () => {},
    getSystemPrompt: () => "base",
    getActiveTools: () => ["read"],
    getAllTools: () => [{ name: "read", description: "r", active: true }],
    setActiveTools: () => {},
    getSessionName: () => log.sessionName,
    setSessionName: (name) => {
      log.sessionName = name;
    },
    sendUserMessage: (content) => {
      log.userMessages.push(content);
    },
    waitForIdle: async () => {},
    newSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    requestUi: async (_ext, request) => {
      log.ui.push(request);
      return answers[request.kind] ?? ({ kind: request.kind } as TrustedExtensionUiResponse);
    },
    publishCommands: (commands) => {
      log.commands.push(commands);
    },
    publishDiagnostics: (diagnostics) => {
      log.diagnostics.push(diagnostics);
    },
  };
  return { bridge, log };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("TrustedExtensionRunner", () => {
  it("loads a TypeScript extension, registers its tool, and runs hooks", async () => {
    const ext = spec(
      "fx",
      `import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
type P = { a: number; b: number };
export default function (pi: any) {
  pi.registerTool(defineTool({
    name: "fx_add", description: "add", parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
    async execute(_id: string, p: P, _s: any, _u: any, ctx: any) {
      return { content: [{ type: "text", text: String(p.a + p.b) + ":" + ctx.cwd.length }], details: {} };
    },
  }));
  pi.on("before_agent_start", (e: any) => ({ systemPrompt: e.systemPrompt + " +marker" }));
  pi.on("tool_call", (e: any) => e.toolName === "bash" ? { block: true, reason: "no bash" } : undefined);
  pi.on("session_start", (e: any, ctx: any) => { (globalThis as any).__started = e.reason + ctx.hasUI; });
}
`,
      // The plugin's own grants: the tier (`agent.extension`) plus the slots its
      // two hooks exercise — `before_agent_start` (slot 6) and `tool_call`
      // (slot 4). Without them the runner skips both handlers (ADR 0291 rule 2).
      ["agent.extension", "runtime.request.before", "runtime.tool.gate"],
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge, reservedToolNames: () => ["read"] });
    const reports = await runner.load();
    expect(reports).toEqual([
      { extensionId: ext.id, state: "loaded", toolNames: ["fx_add"], commandNames: [], agentNames: [], eventNames: ["before_agent_start", "tool_call", "session_start"] },
    ]);
    expect((globalThis as { __started?: string }).__started).toBe("startuptrue");

    const [tool] = runner.getAgentTools();
    expect(tool.name).toBe("fx_add");
    expect(tool.executionMode).toBe("sequential");
    const result = await tool.execute("c1", { a: 2, b: 3 });
    expect(result.content[0]).toEqual({ type: "text", text: `5:${root.length}` });

    const start = await runner.emit<{ systemPrompt?: string }>("before_agent_start", {
      type: "before_agent_start", prompt: "hi", systemPrompt: "base",
    });
    expect(start?.systemPrompt).toBe("base +marker");
    const blocked = await runner.emit<{ block?: boolean }>("tool_call", { type: "tool_call", toolName: "bash", toolCallId: "t", input: {} });
    expect(blocked).toEqual({ block: true, reason: "no bash" });
    const allowed = await runner.emit("tool_call", { type: "tool_call", toolName: "read", toolCallId: "t", input: {} });
    expect(allowed).toBeUndefined();
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("registers a plugin-owned agent and exposes its stream model", async () => {
    const ext = spec(
      "agent",
      `export default function (pi: any) {
  pi.registerAgent({
    id: "commandcode",
    name: "Command Code",
    models: [{ id: "cc-1", name: "Command Code 1" }],
    complete: async (model: any) => ({
      role: "assistant", content: [{ type: "text", text: model.id }],
      api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
    }),
  });
}`,
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    const [agent] = runner.getAgents();
    expect(agent.name).toBe("Command Code");
    expect(agent.models[0].id).toBe("cc-1");
    const result = await agent.stream(agent.models[0], {} as any).result();
    expect(result.content).toEqual([{ type: "text", text: "cc-1" }]);
  });

  it("registerProvider is the same plugin-owned shape as registerAgent", async () => {
    // The upstream alias takes a `complete` implementation as readily as a
    // stream, in both of its call forms.
    const ext = spec(
      "provider",
      `export default function (pi: any) {
  const complete = async (model: any) => ({
    role: "assistant", content: [{ type: "text", text: model.id }],
    api: model.api, provider: model.provider, model: model.id,
    usage: { input: 0, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop", timestamp: Date.now(),
  });
  pi.registerProvider({ id: "object-form", name: "Object form", models: [{ id: "obj-1" }], complete });
  pi.registerProvider("pair-form", { name: "Pair form", models: [{ id: "pair-1" }], complete });
}`,
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    const reports = await runner.load();
    expect([...reports[0].agentNames].sort()).toEqual(["object-form", "pair-form"]);
    expect(runner.getDiagnostics()).toEqual([]);

    const pair = runner.getAgents().find((agent) => agent.id === "pair-form");
    expect(pair?.models[0].id).toBe("pair-1");
    const result = await pair!.stream(pair!.models[0], {} as any).result();
    expect(result.content).toEqual([{ type: "text", text: "pair-1" }]);
  });


  it("keeps loading when one module throws and reports the error", async () => {
    const bad = spec("bad", `throw new Error("boom at load");`);
    const noDefault = spec("nodefault", `export const x = 1;`);
    const factoryThrows = spec("factory", `export default function () { throw new Error("factory boom"); }`);
    const good = spec("good", `export default function (pi: any) { pi.registerCommand("greet", { handler: async () => {} }); }`);
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [bad, noDefault, factoryThrows, good], bridge });
    const reports = await runner.load();
    expect(reports.map((r) => r.state)).toEqual(["error", "error", "error", "loaded"]);
    const kinds = runner.getDiagnostics().map((d) => [d.extensionId === bad.id ? "bad" : d.extensionId === noDefault.id ? "nodefault" : "factory", d.kind, d.message]);
    expect(kinds).toEqual([
      ["bad", "load_error", "boom at load"],
      ["nodefault", "load_error", "module has no default export function"],
      ["factory", "factory_error", "factory boom"],
    ]);
    expect(runner.getDiagnostics().find((d) => d.kind === "load_error")?.stack).toContain("boom at load");
    expect(log.commands.at(-1)).toEqual([{ extensionId: good.id, extensionLabel: "good", name: "greet" }]);
  });

  it("makes unsupported members and pi-tui imports inert with diagnostics", async () => {
    const ext = spec(
      "tui",
      `import { Text, Box, matchesKey } from "@earendil-works/pi-tui";
export default function (pi: any) {
  const t = new Text("x"); t.setText("y");
  matchesKey({}, "ctrl+c");
  pi.registerShortcut("ctrl+x", { handler() {} });
  pi.sendMessage({ customType: "x", content: "hi" });
  pi.sendMessage({ customType: "y", content: "hi" });
  pi.on("session_start", (_e: any, ctx: any) => {
    const d = ctx.ui.setWidget("k", () => null); d();
    ctx.ui.setStatus("k", "busy");
    ctx.ui.notify("hello", "warning");
  });
  pi.on("user_bash", () => {});
  pi.on("made_up_event", () => {});
}
`,
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    const [report] = await runner.load();
    expect(report.state).toBe("loaded");
    await flush();
    const byMember = Object.fromEntries(runner.getDiagnostics().map((d) => [`${d.kind}:${d.member}`, d.count]));
    expect(byMember).toEqual({
      // `Box` is imported but never touched, so it is never reported.
      "stub_symbol:Text": 1,
      "stub_symbol:matchesKey": 1,
      "unsupported_api:registerShortcut": 1,
      "unsupported_api:sendMessage": 2,
      "unsupported_api:ui.setWidget": 1,
      "unsupported_api:on:made_up_event": 1,
    });
    expect(log.ui).toEqual([
      { kind: "setStatus", key: "k", text: "busy" },
      { kind: "notify", message: "hello", level: "warning" },
    ]);
    expect(log.diagnostics.length).toBeGreaterThan(0);

    // A second session reuses the cached module: the import-time stub
    // symbols are replayed so its diagnostics say the same thing.
    const second = new TrustedExtensionRunner({ specs: [ext], bridge: fakeBridge().bridge });
    await second.load();
    await flush();
    expect(second.getDiagnostics().map((d) => `${d.kind}:${d.member}`)).toContain("stub_symbol:Text");
  });

  it("rejects colliding tool and command names, first registration wins", async () => {
    const a = spec("a", `export default function (pi: any) {
  pi.registerTool({ name: "read", description: "", parameters: {}, execute: async () => ({ content: [], details: {} }) });
  pi.registerTool({ name: "fx", description: "", parameters: {}, execute: async () => ({ content: [{ type: "text", text: "a" }], details: {} }) });
  pi.registerCommand("go", { handler: async () => {} });
}`);
    const b = spec("b", `export default function (pi: any) {
  pi.registerTool({ name: "fx", description: "", parameters: {}, execute: async () => ({ content: [{ type: "text", text: "b" }], details: {} }) });
  pi.registerCommand("go", { handler: async () => {} });
}`);
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [a, b], bridge, reservedToolNames: () => ["read"] });
    await runner.load();
    expect(runner.getAgentTools().map((t) => t.name)).toEqual(["fx"]);
    expect(runner.getCommands().map((c) => c.extensionId)).toEqual([a.id]);
    expect(runner.getDiagnostics().map((d) => [d.kind, d.member])).toEqual([
      ["rejected_registration", "read"],
      ["rejected_registration", "fx"],
      ["rejected_registration", "go"],
    ]);
  });

  it("runs commands with prompts round-tripping through the bridge", async () => {
    const ext = spec("cmd", `export default function (pi: any) {
  pi.registerCommand("greet", { description: "say hi", async handler(args: string, ctx: any) {
    const name = await ctx.ui.input("Name?");
    const color = await ctx.ui.select("Color", ["red", "blue"]);
    const ok = await ctx.ui.confirm("Sure?", "really");
    pi.setSessionName(name + "/" + color + "/" + ok + "/" + args);
    ctx.sendUserMessage("follow up");
    const r = await pi.exec("node", ["-e", "process.stdout.write('out')"]);
    (globalThis as any).__exec = r;
  } });
}`);
    const { bridge, log } = fakeBridge({
      input: { kind: "input", value: "Ann" },
      select: { kind: "select", value: "blue" },
      confirm: { kind: "confirm", value: true },
    });
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    expect(await runner.runCommand("greet", "now")).toBe(true);
    expect(await runner.runCommand("missing", "")).toBe(false);
    expect(log.sessionName).toBe("Ann/blue/true/now");
    expect(log.userMessages).toEqual(["follow up"]);
    expect((globalThis as { __exec?: { stdout: string; code: number } }).__exec).toMatchObject({ stdout: "out", code: 0 });
  });

  it("folds context results, and records a stalled handler as a timeout", async () => {
    const ext = spec("ctx", `export default function (pi: any) {
  pi.on("context", (e: any) => ({ messages: [...e.messages, { role: "user", content: "extra" }] }));
  pi.on("context", (e: any) => ({ messages: e.messages.slice(0, 1) }));
  pi.on("tool_result", () => { throw new Error("nope"); });
}`,
      // `context` is slot 6 and `tool_result` is slot 4 (ADR 0291 rule 2).
      ["runtime.request.before", "runtime.tool.gate"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    const messages = [{ role: "user", content: "one" }, { role: "assistant", content: "two" }];
    const folded = await runner.emit<{ messages: unknown[] }>(
      "context",
      { type: "context", messages },
      (acc, next) => next,
    );
    // The second handler saw the original payload, not the first handler's output.
    expect(folded?.messages).toEqual([messages[0]]);
    await runner.emit("tool_result", { type: "tool_result", toolName: "x", toolCallId: "1", input: {}, content: [], details: {}, isError: false });
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({ kind: "handler_error", member: "tool_result", message: "nope" }),
    ]);
    await runner.dispose();
    expect(await runner.emit("turn_start", { type: "turn_start" })).toBeUndefined();
  });

  it("maps every wired event to its slot permission and leaves the rest unrestricted", () => {
    // The map is the contract (ADR 0291 rule 2): whatever the runner does not
    // find here has no slot and stays unrestricted.
    expect(trustedExtensionEventPermission("turn_closing")).toBe("runtime.turn.closing");
    expect(trustedExtensionEventPermission("tool_call")).toBe("runtime.tool.gate");
    expect(trustedExtensionEventPermission("tool_result")).toBe("runtime.tool.gate");
    for (const event of [
      "context",
      "before_agent_start",
      "before_provider_request",
      "before_provider_headers",
      "model_select",
      "thinking_level_select",
    ]) {
      expect(trustedExtensionEventPermission(event), event).toBe("runtime.request.before");
    }
    for (const event of [
      "agent_start",
      "agent_end",
      "agent_settled",
      "turn_start",
      "turn_end",
      "message_start",
      "message_update",
      "message_end",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "after_provider_response",
    ]) {
      expect(trustedExtensionEventPermission(event), event).toBe("runtime.turn.watch");
    }
    for (const event of [
      "project_trust",
      "resources_discover",
      "session_before_compact",
      "session_compact",
      "session_compact_failed",
      "session_before_fork",
    ]) {
      expect(trustedExtensionEventPermission(event), event).toBe("runtime.session.lifecycle");
    }
    expect(trustedExtensionEventPermission("input")).toBe("runtime.send.before");

    // Every mapped event is one the runtime actually emits, and every event
    // this runner knows that is not mapped is one of the three the map
    // deliberately leaves alone.
    const wired = new Set<string>(TRUSTED_EXTENSION_EVENTS);
    for (const event of Object.keys(TRUSTED_EXTENSION_EVENT_PERMISSIONS)) {
      expect(wired.has(event), event).toBe(true);
    }
    expect(
      TRUSTED_EXTENSION_EVENTS.filter((event) => !(event in TRUSTED_EXTENSION_EVENT_PERMISSIONS)),
    ).toEqual(["session_start", "session_shutdown", "session_info_changed"]);
    expect(trustedExtensionEventPermission("session_start")).toBeUndefined();
    expect(trustedExtensionEventPermission("session_shutdown")).toBeUndefined();
    expect(trustedExtensionEventPermission("session_info_changed")).toBeUndefined();
    expect(trustedExtensionEventPermission("not_an_event")).toBeUndefined();
    expect(trustedExtensionEventPermission("constructor")).toBeUndefined();

    // The reservation window is over: every mapped slot name is in the
    // registry, so the runner enforces all of them and none is left
    // unrestricted (ADR 0291 Consequences, spec 13 §2C).
    const mapped = new Set<string>(Object.values(TRUSTED_EXTENSION_EVENT_PERMISSIONS));
    for (const name of mapped) {
      expect(REGISTERED_SLOT_PERMISSIONS as readonly string[], name).toContain(name);
    }
    // The one slot ADR 0291 does not build is reserved and absent: nothing is
    // mapped to it, so no handler can depend on it.
    expect(mapped.has("runtime.approval.before")).toBe(false);
    expect(REGISTERED_SLOT_PERMISSIONS as readonly string[]).not.toContain("runtime.approval.before");
    // The high-trust tier is no exception: `tool_call` is mapped to slot 4.
    expect(REGISTERED_SLOT_PERMISSIONS).toContain("runtime.tool.gate");
  });

  it("skips a turn_closing handler the plugin holds no slot permission for", async () => {
    const ext = spec(
      "closing-without-permission",
      `export default function (pi: any) {
  pi.on("turn_closing", () => {
    (globalThis as any).__closing = true;
    return { continue: true };
  });
}`,
      // The tier grant the loader recorded; the slot is not in it (ADR 0291
      // rule 2: `agent.extension` never implies a slot permission).
      ["agent.extension"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    delete (globalThis as { __closing?: boolean }).__closing;

    const result = await runner.emit("turn_closing", { type: "turn_closing" });

    expect(result).toBeUndefined();
    expect((globalThis as { __closing?: boolean }).__closing).toBeUndefined();
    expect(runner.getDiagnostics()).toEqual([
      {
        extensionId: ext.id,
        kind: "permission_denied",
        message: 'handler for "turn_closing" skipped: the plugin does not hold runtime.turn.closing',
        member: "turn_closing",
        count: 1,
      },
    ]);
  });

  it("runs the handler once the plugin holds the slot permission", async () => {
    const ext = spec(
      "closing-with-permission",
      `export default function (pi: any) {
  pi.on("turn_closing", () => ({ continue: true, message: "keep going" }));
}`,
      ["agent.extension", "runtime.turn.closing"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();

    const result = await runner.emit("turn_closing", { type: "turn_closing" });

    expect(result).toEqual({ continue: true, message: "keep going" });
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("refuses a tool_call handler from a plugin that holds only the tier grant", async () => {
    // Slot 4 is registered, so the high-trust tier is not enough: the handler
    // is skipped with a diagnostic and its answer never reaches the caller
    // (ADR 0291 rule 2).
    const ext = spec(
      "tool-call-refused",
      `export default function (pi: any) {
  pi.on("tool_call", (e: any) => {
    (globalThis as any).__toolCall = e.toolName;
    return { block: true, reason: "no bash" };
  });
}`,
      ["agent.extension"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    delete (globalThis as { __toolCall?: string }).__toolCall;

    const blocked = await runner.emit<{ block?: boolean }>("tool_call", {
      type: "tool_call",
      toolName: "bash",
      toolCallId: "t",
      input: {},
    });

    expect(blocked).toBeUndefined();
    expect((globalThis as { __toolCall?: string }).__toolCall).toBeUndefined();
    expect(runner.getDiagnostics()).toEqual([
      {
        extensionId: ext.id,
        kind: "permission_denied",
        message: 'handler for "tool_call" skipped: the plugin does not hold runtime.tool.gate',
        member: "tool_call",
        count: 1,
      },
    ]);
  });

  it("runs the tool_call handler once the plugin holds runtime.tool.gate", async () => {
    const ext = spec(
      "tool-call-granted",
      `export default function (pi: any) {
  pi.on("tool_call", (e: any) => (e.toolName === "bash" ? { block: true, reason: "no bash" } : undefined));
}`,
      ["agent.extension", "runtime.tool.gate"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();

    const blocked = await runner.emit<{ block?: boolean }>("tool_call", {
      type: "tool_call",
      toolName: "bash",
      toolCallId: "t",
      input: {},
    });

    expect(blocked).toEqual({ block: true, reason: "no bash" });
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("keeps the 30 s handler budget for a handler the plugin is allowed to run", async () => {
    const ext = spec(
      "stalled",
      `export default function (pi: any) {
  pi.on("turn_closing", () => new Promise(() => {}));
}`,
      ["runtime.turn.closing"],
    );
    const { bridge } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();
    vi.useFakeTimers();
    try {
      const emitted = runner.emit("turn_closing", { type: "turn_closing" });
      await vi.advanceTimersByTimeAsync(TRUSTED_EXTENSION_HANDLER_TIMEOUT_MS + 1);
      expect(await emitted).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({
        kind: "handler_timeout",
        member: "turn_closing",
        message: `handler exceeded ${TRUSTED_EXTENSION_HANDLER_TIMEOUT_MS}ms`,
      }),
    ]);
  });

  it("names each non-event call's slot permission in the same contract as events", () => {
    // Slot 3 and slot 5 are API-shaped, not event-shaped: an API call has no
    // event name, so the contract names the call instead (ADR 0291 rule 2).
    expect(TRUSTED_EXTENSION_API_PERMISSIONS.requestTurnAbort).toBe("runtime.turn.abort");
    expect(TRUSTED_EXTENSION_API_PERMISSIONS.toolResult).toBe("runtime.tool.extend");
    expect(trustedExtensionApiPermission("requestTurnAbort")).toBe("runtime.turn.abort");
    expect(trustedExtensionApiPermission("toolResult")).toBe("runtime.tool.extend");
    expect(trustedExtensionApiPermission("not_a_call")).toBeUndefined();
    expect(trustedExtensionApiPermission("constructor")).toBeUndefined();
    expect(REGISTERED_SLOT_PERMISSIONS).toContain("runtime.turn.abort");
    expect(REGISTERED_SLOT_PERMISSIONS).toContain("runtime.tool.extend");
  });

  it("refuses requestTurnAbort without the slot permission and reports it", async () => {
    const ext = spec(
      "abort-refused",
      `export default function (pi: any) {
  pi.on("session_start", () => {
    (globalThis as any).__abortResult = pi.requestTurnAbort();
  });
}`,
      // The tier grant the loader recorded; the slot is not in it.
      ["agent.extension"],
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();

    expect((globalThis as { __abortResult?: boolean }).__abortResult).toBe(false);
    delete (globalThis as { __abortResult?: boolean }).__abortResult;
    // Refused means refused: the turn was not stopped.
    expect(log.aborts).toBe(0);
    expect(runner.getDiagnostics()).toEqual([
      {
        extensionId: ext.id,
        kind: "permission_denied",
        message: "requestTurnAbort was refused: the plugin does not hold runtime.turn.abort",
        member: "requestTurnAbort",
        count: 1,
      },
    ]);
  });

  it("aborts the turn through requestTurnAbort once the plugin holds the slot", async () => {
    const ext = spec(
      "abort-granted",
      `export default function (pi: any) {
  pi.on("session_start", () => {
    (globalThis as any).__abortResult = pi.requestTurnAbort();
  });
}`,
      ["agent.extension", "runtime.turn.abort"],
    );
    const { bridge, log } = fakeBridge();
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();

    expect((globalThis as { __abortResult?: boolean }).__abortResult).toBe(true);
    delete (globalThis as { __abortResult?: boolean }).__abortResult;
    expect(log.aborts).toBe(1);
    expect(runner.getDiagnostics()).toEqual([]);
  });

  it("hands the running turn's cancellation token to the extension context", async () => {
    // Slot 3's second half: abort without a signal leaves plugin work running
    // after the user stopped, so the token is part of the same slot.
    const controller = new AbortController();
    const ext = spec(
      "signal",
      `export default function (pi: any) {
  pi.on("session_start", (_event: any, ctx: any) => {
    (globalThis as any).__ctxSignal = ctx.signal;
  });
}`,
    );
    const { bridge } = fakeBridge({}, controller.signal);
    const runner = new TrustedExtensionRunner({ specs: [ext], bridge });
    await runner.load();

    const signal = (globalThis as { __ctxSignal?: AbortSignal }).__ctxSignal;
    delete (globalThis as { __ctxSignal?: AbortSignal }).__ctxSignal;
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it("gates an extension tool's result capabilities on runtime.tool.extend", async () => {
    // Slot 5: the result may introduce tools, report spend, and request early
    // termination only with the grant; the refusal is a diagnostic.
    const refused = spec(
      "tool-extend-refused",
      `export default function (pi: any) {
  pi.registerTool({
    name: "fx_extend", description: "", parameters: {},
    execute: async () => ({ content: [], details: {}, addedToolNames: ["BrowserPreview"], terminate: true }),
  });
}`,
      ["agent.extension"],
    );
    const runner = new TrustedExtensionRunner({ specs: [refused], bridge: fakeBridge().bridge });
    await runner.load();

    expect(runner.toolResultExtensionAllowed("fx_extend")).toBe(false);
    // A tool that belongs to no extension is the caller's own business.
    expect(runner.toolResultExtensionAllowed("Read")).toBeUndefined();
    expect(runner.getDiagnostics()).toEqual([
      expect.objectContaining({
        kind: "permission_denied",
        member: "toolResult:fx_extend",
        message: "toolResult:fx_extend was refused: the plugin does not hold runtime.tool.extend",
      }),
    ]);

    const granted = spec(
      "tool-extend-granted",
      `export default function (pi: any) {
  pi.registerTool({ name: "fx_extend_ok", description: "", parameters: {}, execute: async () => ({ content: [], details: {} }) });
}`,
      ["agent.extension", "runtime.tool.extend"],
    );
    const runner2 = new TrustedExtensionRunner({ specs: [granted], bridge: fakeBridge().bridge });
    await runner2.load();
    expect(runner2.toolResultExtensionAllowed("fx_extend_ok")).toBe(true);
    expect(runner2.getDiagnostics()).toEqual([]);
  });
});

