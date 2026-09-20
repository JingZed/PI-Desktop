#!/usr/bin/env node
/**
 * The plugin showcase, in a real Electron window (spec 07-plugins/16 §2A and
 * §6, ADRs 0291/0294/0295).
 *
 * `scripts/e2e-plugin-slots.mjs` proves the *contract* of the trusted renderer
 * host: the scheme, the import map, the action channel. This suite proves the
 * *slots*: it loads `examples/plugins/plugin-showcase` into the built app with a
 * throwaway profile and walks every position that plugin registers, so "the
 * slots work" stops resting on unit and SSR tests.
 *
 * What each check drives, and where the fact it asserts comes from:
 *
 * - `entry` / `entryExtra` — a seeded user message row carries the plugin's
 *   whole-message card and the badge below it, and both name the entry id the
 *   host handed over.
 * - `codeBlock` — a seeded assistant message contains a closed fence in
 *   `acme.plugin-showcase:kv`; the block is drawn as the plugin's rows.
 * - `toolCard` — a seeded tool row for the plugin's own forced tool name
 *   (`plugin_<id>_showcase_note`) gets the plugin's card, and a seeded host
 *   tool row (`Read`) does not.
 * - `composerControl` / `completionSource` / `composerReference` — the
 *   composer's left and right control rows, the completion popover opened by
 *   typing `/showcase`, and the plugin's chip after a reference is attached
 *   through the host's own `@` completion.
 * - `inlineConfirm` — a permission request is raised by a *real* agent turn
 *   served by a local OpenAI-compatible SSE stub, and the plugin's card takes
 *   the position while that request is pending; closing it brings the host's
 *   permission card back.
 * - `modal` / `overlay` — the plugin's own composer controls open each layer,
 *   the layer is on screen with its container attributes, Escape dismisses it
 *   (the host's dismissal) and the plugin's own button withdraws it.
 * - the agent half — the tool gate refuses the dangerous shell call the model
 *   itself emitted: the call is in the transcript as a failed command row, and
 *   the plugin's reason reaches the model's next request and the user's own
 *   warning. The transcript body of a run row carries stdout/stderr only, so
 *   the reason is deliberately not drawn there (`lib/tool-presentation.ts`,
 *   "run" branch). The turn watch status line counts what the plugin saw while
 *   the turn ran, and the turn facts summary is emitted when the run ends. All
 *   of it comes out of the sidecar running the plugin's `agent/extension.js`
 *   inside the app.
 *
 * Prerequisites: `pnpm build:js` and the built desktop app plus a host-core
 * binary (target/debug, target/release, or PI_DESKTOP_HOST_BIN). The model
 * traffic in the turn is a loopback stub owned by this script; nothing leaves
 * the machine, no user profile is touched, and the temp profile is removed.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createConnectionServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOWCASE_PLUGIN = join(root, "examples/plugins/plugin-showcase");
const SDK_INDEX = join(root, "packages/plugin-sdk/dist/index.js");

/** The plugin under test, and the entry points its manifest declares. */
const PLUGIN_ID = "acme.plugin-showcase";
const CODE_LANGUAGE = `${PLUGIN_ID}:kv`;
/** The fenced source the seeded assistant message carries. */
const FENCE = ["```" + CODE_LANGUAGE, "covered = 42", "disk! = 91% used", "```"].join("\n");
const MOCK_MODEL = "showcase-e2e-model";
/** The status line the plugin's own `tool_execution_end` handler writes. */
const STATUS_TOOL_COUNT = /Plugin Showcase · turn \d+ · \d+ tool call\(s\) seen/;

const results = [];
function record(id, ok, detail = "") {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
}

/** Poll a predicate until it answers truthy, like the other E2E runners. */
async function waitFor(predicate, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`timeout waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

/** A loopback port, so a stray listener never collides with this run. */
async function freePort() {
  const server = createConnectionServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** The pages a running Electron advertises, or an empty list while it boots. */
async function listTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  return response.json();
}

/** One CDP websocket, request ids, and the page console for failure details. */
class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.console = [];
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (
        message.method === "Runtime.consoleAPICalled" ||
        message.method === "Runtime.exceptionThrown"
      ) {
        this.console.push(`[${message.method}] ${JSON.stringify(message.params).slice(0, 300)}`);
        if (this.console.length > 40) this.console.shift();
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve(message.result);
    };
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onerror = () => reject(new Error(`CDP websocket failed: ${url}`));
      ws.onopen = () => resolve(new CdpClient(ws));
    });
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          JSON.stringify(result.exceptionDetails),
      );
    }
    return result.result.value;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // A socket that is already gone needs no closing.
    }
  }
}

/** Stop the app and everything it spawned, including its host-core sidecar. */
async function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // The close event below is the authoritative signal either way.
      }
    }
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * A loopback OpenAI-compatible endpoint for one agent turn.
 *
 * The response is chosen from what the request already carries, not from a
 * call counter, so the turn cannot get out of step with the harness:
 *
 * 1. no plugin refusal in the history yet → a `Bash` call for a command the
 *    plugin's tool gate refuses (`git reset --hard`);
 * 2. the refusal is in the history, but the benign command is not → a second
 *    `Bash` call that passes the gate and therefore reaches the host's
 *    approval path, which is what leaves a permission request pending long
 *    enough for the `inlineConfirm` slot to be driven;
 * 3. both are → a plain answer, which ends the run and fires `agent_end`.
 *
 * Every request is recorded, so the checks can also assert that the plugin's
 * own refusal sentence reached the model rather than only the window.
 */
function createModelStub() {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      payload = {};
    }
    requests.push(payload);
    const history = JSON.stringify(payload.messages ?? []);
    const sawRefusal = history.includes("Plugin Showcase refused");
    const sawBenign = history.includes("plugin-showcase-e2e");
    const base = {
      id: `chatcmpl-${requests.length}`,
      object: "chat.completion.chunk",
      created: 1,
      model: payload.model ?? MOCK_MODEL,
    };
    const write = (delta, finish, usage) =>
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        })}\n\n`,
      );
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    if (!sawRefusal) {
      write(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${requests.length}_blocked`,
              type: "function",
              function: {
                name: "Bash",
                arguments: JSON.stringify({ command: "git reset --hard HEAD~1" }),
              },
            },
          ],
        },
        null,
      );
      write({}, "tool_calls", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    } else if (!sawBenign) {
      write(
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `call_${requests.length}_approval`,
              type: "function",
              function: {
                name: "Bash",
                arguments: JSON.stringify({ command: "echo plugin-showcase-e2e" }),
              },
            },
          ],
        },
        null,
      );
      write({}, "tool_calls", { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 });
    } else {
      write({ role: "assistant", content: "Showcase turn finished." }, null);
      write({}, "stop", { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 });
    }
    res.end("data: [DONE]\n\n");
  });
  return {
    requests,
    listen: () =>
      new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port))),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const RUNTIME_PROBE_TIMEOUT = 30_000;

/**
 * Everything the checks read, gathered from the live window. Each helper is a
 * plain DOM read: nothing here knows a plugin id it was not handed, and every
 * value is read out of the rendered result rather than recomputed in Node.
 */
const PROBE_HELPERS = `
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const text = (node) => (node ? (node.textContent ?? "").trim() : null);
const has = (selector) => Boolean($(selector));
const waitFor = async (predicate, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
};
const pluginSlot = (id, slot) =>
  $( '[data-pi-plugin="' + id + '"][data-pi-plugin-slot="' + slot + '"]');
const showcaseCard = (slot) => $('[data-pi-showcase-slot="' + slot + '"]');
const showcaseTrigger = (name) =>
  $('[data-pi-showcase-trigger="' + name + '"]');
const composerInput = () => $('.composer-input');
// The input surface that owns the editor, so a chip probe never reads a chip
// some other composer painted.
const composerStage = () => composerInput()?.closest('.composer-input-stage') ?? null;
// Type into the composer the way the browser does: select the editable's
// contents and let Chromium replace them, which is what produces a real input
// event the host's own handler reads. Clearing the draft by assigning
// textContent instead leaves the editable with no child node at all, and
// Chromium's insertText then inserts nothing: the next draft never reaches
// the host,
// which is exactly how an "@README" probe can look like "the popover never
// opened". The direct fallback is for a renderer that refuses the command.
const setDraft = (value) => {
  const editor = composerInput();
  if (!editor) return false;
  editor.focus();
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const inserted = document.execCommand('insertText', false, value);
  if (!inserted || (editor.textContent ?? '') !== value) {
    editor.textContent = value;
    if (!editor.firstChild) editor.appendChild(document.createTextNode(''));
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  return (editor.textContent ?? '') === value;
};
const pressKey = (key) => {
  const editor = composerInput();
  if (!editor) return false;
  editor.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
  return true;
};
/** The draft the composer's own editor module reads back. */
const readDraft = () => {
  const editor = composerInput();
  return editor ? editor.textContent : null;
};
/** Everything the completion probes need to explain a popover that never opened. */
const composerState = () => ({
  draft: readDraft(),
  focused: document.activeElement === composerInput(),
  activeElement: document.activeElement?.className ?? null,
  popover: Boolean($('.composer-autocomplete')),
  popoverText: text($('.composer-autocomplete')),
  completionSlot: Boolean(
    $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="completionSource"]'),
  ),
});
/** Every button in the transcript that can be expanded, expanded. */
const expandTranscript = () => {
  let clicked = 0;
  for (const button of $$('.thread-scroll [aria-expanded="false"]')) {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    clicked += 1;
  }
  return clicked;
};
const transcriptText = () => {
  const scroll = $('.thread-scroll');
  return scroll ? (scroll.innerText ?? '').replace(/\\s+/g, ' ').trim() : null;
};
const toasts = () =>
  $$('.toast').map((toast) => (toast.textContent ?? '').replace(/\\s+/g, ' ').trim());
const statusLine = () =>
  $$('.extension-status-item').map((item) => (item.textContent ?? '').replace(/\\s+/g, ' ').trim());
`;

/**
 * Launch the built app with a throwaway profile, seed one session whose rows
 * exercise every transcript position, load the showcase plugin through the
 * host's own `plugins.loadDev`, and then drive the live window.
 */
async function runJourney() {
  const { Host, resolveHostBinary } = await import("./e2e/host.mjs");
  const { assertDesktopBuild, resolveElectronBinary } = await import("./e2e/boot.mjs");
  const sdk = await import(pathToFileURL(SDK_INDEX).href);
  // The forced tool name is read from the SDK, not repeated here: renaming the
  // prefix can never leave this suite seeding a row the host does not own.
  const PLUGIN_TOOL = sdk.pluginToolName(PLUGIN_ID, "showcase_note");
  const { appDir, electronBinary } = resolveElectronBinary(root);
  assertDesktopBuild(root);
  const hostBinary = resolveHostBinary();

  const runRoot = mkdtempSync(join(tmpdir(), "pi-showcase-slots-"));
  const dataDir = join(runRoot, "data");
  const profileDir = join(runRoot, "profile");
  const projectDir = join(runRoot, "project");
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  // One workspace file, so the composer's own `@` completion has something to
  // attach and the `composerReference` position has a host chip to follow.
  writeFileSync(join(projectDir, "README.md"), "# Showcase e2e project\n");

  const stub = createModelStub();
  const modelPort = await stub.listen();
  const cdpPort = await freePort();
  let child = null;
  let client = null;
  const output = [];
  const capture = (chunk) => output.push(String(chunk));
  const describe = (error) =>
    `${error instanceof Error ? error.message : String(error)}\n` +
    `--- renderer console ---\n${(client?.console ?? []).join("\n")}\n` +
    `--- app output (tail) ---\n${output.join("").slice(-2_000)}`;

/** A compact picture of the window, attached to a failed journey. */
async function windowSnapshot(client) {
  if (!client) return "no CDP client";
  try {
    return await client.evaluate(`JSON.stringify({
      url: location.href,
      mainPane: Boolean(document.querySelector('.main-pane')),
      messageRows: document.querySelectorAll('.message-row').length,
      toolRows: document.querySelectorAll('.tool-row').length,
      composer: Boolean(document.querySelector('.composer-input')),
      pluginContainers: Array.from(document.querySelectorAll('[data-pi-plugin]'))
        .map((node) => node.getAttribute('data-pi-plugin') + ':' + node.getAttribute('data-pi-plugin-slot'))
        .slice(0, 24),
      bodyText: (document.body.innerText || '').slice(0, 600),
    })`);
  } catch (error) {
    return `window snapshot failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

  // Assigned from the host's own `session.create` answer below: the host mints
  // the id, so a locally invented one would point `selectSession` at nothing.
  let sessionId = randomUUID();
  const userMessageId = randomUUID();
  const fenceMessageId = randomUUID();
  const pluginToolMessageId = randomUUID();
  const hostToolMessageId = randomUUID();

  try {
    // ── Seed through the host protocol, then let the seeding host exit ──────
    const host = new Host(hostBinary, dataDir);
    await host.start();
    try {
      await host.call("workspace.set", { path: projectDir });
      const provider = await host.call("providers.create", {
        name: "Showcase E2E Stub",
        vendorKey: "custom",
        type: "openai_compatible",
        protocol: "openai_compatible",
        baseUrl: `http://127.0.0.1:${modelPort}/v1`,
        authKind: "none",
        apiStyle: "chat_completions",
        defaultModelId: MOCK_MODEL,
        contextWindow: 200_000,
        maxOutputTokens: 8_192,
      });
      const created = await host.call("session.create", {
        title: "Showcase slot journey",
        mode: "agent",
        providerId: provider.provider.id,
        modelId: MOCK_MODEL,
        projectPath: projectDir,
      });
      sessionId = created.session.id;
      const append = (message) =>
        host.call("session.appendMessage", { sessionId, message });
      await append({
        id: userMessageId,
        role: "user",
        content: "Showcase slot journey",
        status: "complete",
        createdAt: new Date().toISOString(),
      });
      // The fence the plugin claims, in a closed block: the host hands a
      // component only a closed, in-limit block (code-blocks.ts).
      await append({
        id: fenceMessageId,
        role: "assistant",
        content: `Here is the block:\n\n${FENCE}\n`,
        modelId: MOCK_MODEL,
        status: "complete",
        createdAt: new Date().toISOString(),
      });
      // The plugin's own tool row, under the forced name the host derives, and
      // one host tool row that must never be offered the same position.
      await append({
        id: pluginToolMessageId,
        role: "tool",
        content: "",
        toolName: PLUGIN_TOOL,
        toolCallId: `call-${pluginToolMessageId}`,
        toolStatus: "success",
        toolArgs: { text: "hello" },
        toolResult: { ok: true, content: { text: "hello" } },
        createdAt: new Date().toISOString(),
      });
      await append({
        id: hostToolMessageId,
        role: "tool",
        content: "",
        toolName: "Read",
        toolCallId: `call-${hostToolMessageId}`,
        toolStatus: "success",
        toolArgs: { path: "README.md" },
        toolResult: { ok: true, content: "# Showcase e2e project\n" },
        createdAt: new Date().toISOString(),
      });
      // A development load enables the plugin with the permissions its manifest
      // declares, which is what makes it a renderer candidate and an agent
      // extension at once.
      await host.call("plugins.loadDev", { path: SHOWCASE_PLUGIN });
    } finally {
      await host.stop();
    }

    child = spawn(
      electronBinary,
      [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`, "."],
      {
        cwd: appDir,
        env: {
          ...process.env,
          PI_DESKTOP_DATA_DIR: dataDir,
          PI_DESKTOP_HOST_BIN: hostBinary,
          PI_DESKTOP_START_MAXIMIZED: "0",
          ELECTRON_RENDERER_URL: "",
        },
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const target = await waitFor(
      async () => {
        const targets = await listTargets(cdpPort).catch(() => []);
        return targets.find(
          (candidate) =>
            candidate.type === "page" &&
            candidate.webSocketDebuggerUrl &&
            candidate.url.includes("out/renderer/index.html") &&
            !candidate.url.includes("surface="),
        );
      },
      "main window CDP target",
      90_000,
    );
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await waitFor(() => client.evaluate(`!!document.querySelector(".main-pane")`), "app shell");
    await waitFor(
      () => client.evaluate(`!document.querySelector(".startup-splash")`),
      "startup splash cleared",
    );
    // The project is persisted in the shared data dir, but a fresh profile can
    // still come up with no workspace: binding it here is what the sidebar's
    // own "open folder" does, and the `@` completion needs it.
    await client.evaluate(
      `(async () => {
        const bridge = window.piDesktop;
        const current = await bridge.invoke(bridge.channels.invoke.projectGet);
        if (!current?.workspace?.path) {
          await bridge.invoke(bridge.channels.invoke.projectSet, ${JSON.stringify(projectDir)});
        }
        return true;
      })()`,
    );
    await client.evaluate(
      `window.__PI_DESKTOP__.selectSession(${JSON.stringify(sessionId)})`,
    );
    await waitFor(
      () => client.evaluate(`!!document.querySelector('[data-pi-plugin="${PLUGIN_ID}"]')`),
      "the showcase plugin's renderer entry",
    );
    // A slot component of the plugin that really ran is the signal the module
    // is loaded; every later read assumes that, so it is waited for once.
    await waitFor(
      () =>
        client.evaluate(
          `!!document.querySelector('[data-pi-plugin="${PLUGIN_ID}"] .acme-plugin-showcase__badge')`,
        ),
      "the showcase badge in a transcript row",
    );

    const facts = { sessionId, pluginToolMessageId, hostToolMessageId, PLUGIN_TOOL };
    const run = async (body) => client.evaluate(`(async () => {${PROBE_HELPERS}${body}})()`);

    // ── entry / entryExtra ─────────────────────────────────────────────────
    const entryFacts = await run(`
      const row = $('.message-row[data-message-id=${JSON.stringify(userMessageId)}]');
      return {
        rowFound: Boolean(row),
        entryCard: text(row?.querySelector('[data-pi-showcase-slot="entry"]')),
        entryContainer: row?.querySelector('[data-pi-plugin][data-pi-plugin-slot="entry"]')?.getAttribute('data-pi-plugin') ?? null,
        badge: text(row?.querySelector('.acme-plugin-showcase__badge')),
        badgeContainer: row?.querySelector('[data-pi-plugin][data-pi-plugin-slot="entryExtra"]')?.getAttribute('data-pi-plugin') ?? null,
        badgeCount: $$('.acme-plugin-showcase__badge').length,
      };
    `);
    record(
      "E2E-PLUGIN-showcase-entry-card",
      entryFacts.rowFound &&
        entryFacts.entryContainer === PLUGIN_ID &&
        (entryFacts.entryCard ?? "").includes("· entry") &&
        (entryFacts.entryCard ?? "").includes(userMessageId),
      `the whole-message position carries the plugin's card and names the host's entry id: ${JSON.stringify(entryFacts.entryCard)}`,
    );
    record(
      "E2E-PLUGIN-showcase-entry-extra-badge",
      entryFacts.badgeContainer === PLUGIN_ID &&
        (entryFacts.badge ?? "").includes("· entryExtra") &&
        (entryFacts.badge ?? "").includes(userMessageId) &&
        entryFacts.badgeCount >= 1,
      `${entryFacts.badgeCount} badge(s) below transcript rows, first: ${JSON.stringify(entryFacts.badge)}`,
    );

    // ── codeBlock ──────────────────────────────────────────────────────────
    const codeFacts = await run(`
      const mount = pluginSlot(${JSON.stringify(PLUGIN_ID)}, 'codeBlock');
      return {
        mountFound: Boolean(mount),
        head: text($('.acme-plugin-showcase__kv-head')),
        rows: $$('.acme-plugin-showcase__kv-row').map((row) => text(row)),
        flagged: $$('.acme-plugin-showcase__kv-row.acme-plugin-showcase__kv-flagged').map((row) => text(row)),
        source: text($$('.prose-chat pre code').find((node) => (node.textContent ?? '').includes('covered = 42'))),
      };
    `);
    record(
      "E2E-PLUGIN-showcase-code-block-rows",
      codeFacts.mountFound &&
        (codeFacts.head ?? "").includes(`draws fenced ${CODE_LANGUAGE}`) &&
        codeFacts.rows.some((row) => row === "covered42") &&
        codeFacts.rows.some((row) => row === "disk91% used") &&
        codeFacts.flagged.some((row) => row === "disk91% used"),
      `the closed ${CODE_LANGUAGE} fence is drawn as the plugin's rows: ${JSON.stringify(codeFacts.rows)} (flagged: ${JSON.stringify(codeFacts.flagged)})`,
    );

    // ── toolCard ───────────────────────────────────────────────────────────
    const toolFacts = await run(`
      const owned = $('.tool-row[data-message-id=${JSON.stringify(pluginToolMessageId)}]');
      const hostRow = $('.tool-row[data-message-id=${JSON.stringify(hostToolMessageId)}]');
      return {
        ownedFound: Boolean(owned),
        hostFound: Boolean(hostRow),
        ownedCard: text(owned?.querySelector('[data-pi-showcase-slot="toolCard"]')),
        ownedContainer: owned?.querySelector('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="toolCard"]')?.getAttribute('data-pi-plugin') ?? null,
        hostCard: Boolean(hostRow?.querySelector('[data-pi-showcase-slot="toolCard"]')),
        hostSlot: Boolean(hostRow?.querySelector('[data-pi-plugin-slot="toolCard"]')),
        toolName: ${JSON.stringify(facts.PLUGIN_TOOL)},
      };
    `);
    record(
      "E2E-PLUGIN-showcase-tool-card-owned-only",
      toolFacts.ownedFound &&
        toolFacts.hostFound &&
        toolFacts.ownedContainer === PLUGIN_ID &&
        (toolFacts.ownedCard ?? "").includes("· toolCard") &&
        (toolFacts.ownedCard ?? "").includes(pluginToolMessageId) &&
        toolFacts.hostCard === false &&
        toolFacts.hostSlot === false,
      `the plugin's own tool row (${toolFacts.toolName}) draws its card; the host's Read row got no card (card=${toolFacts.hostCard}, position=${toolFacts.hostSlot})`,
    );

    // ── composerControl ────────────────────────────────────────────────────
    const controlFacts = await run(`
      const left = $('.composer-left [data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="composerControl"]');
      const right = $('.composer-right [data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="composerControl"]');
      // The title (and every label) lives on the plugin's own control, not on
      // the host's container, so it is read from the button itself.
      const titleOf = () =>
        showcaseTrigger('inlineConfirm')?.getAttribute('title') ??
        showcaseTrigger('modal')?.getAttribute('title') ??
        null;
      return {
        leftFound: Boolean(left),
        rightFound: Boolean(right),
        leftPosition: left?.getAttribute('data-pi-control-position') ?? null,
        rightPosition: right?.getAttribute('data-pi-control-position') ?? null,
        leftLabel: text(left),
        rightLabel: text(right),
        leftTitle: titleOf(),
        inlineTrigger: Boolean(showcaseTrigger('inlineConfirm')),
        modalTrigger: Boolean(showcaseTrigger('modal')),
        overlayTrigger: Boolean(showcaseTrigger('overlay')),
      };
    `);
    record(
      "E2E-PLUGIN-showcase-composer-control-rows",
      controlFacts.leftFound &&
        controlFacts.rightFound &&
        controlFacts.leftPosition === "left" &&
        controlFacts.rightPosition === "right" &&
        (controlFacts.leftLabel ?? "").includes("Showcase: inline card") &&
        (controlFacts.rightLabel ?? "").includes("Showcase: modal") &&
        (controlFacts.rightLabel ?? "").includes("Showcase: overlay") &&
        controlFacts.inlineTrigger &&
        controlFacts.modalTrigger &&
        controlFacts.overlayTrigger &&
        /draft \d+ char\(s\)/.test(controlFacts.leftTitle ?? ""),
      `left row: ${JSON.stringify(controlFacts.leftLabel)} (title ${JSON.stringify(controlFacts.leftTitle)}), right row: ${JSON.stringify(controlFacts.rightLabel)}`,
    );

    // ── completionSource ───────────────────────────────────────────────────
    const completionFacts = await run(`
      const typed = setDraft('/showcase');
      const opened = await waitFor(
        () => $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="completionSource"]'),
        ${RUNTIME_PROBE_TIMEOUT},
      );
      const slot = $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="completionSource"]');
      return {
        typed,
        ...composerState(),
        mountFound: Boolean(opened),
        inPopover: Boolean(opened && $('.composer-autocomplete')?.contains(opened)),
        mode: slot?.getAttribute('data-pi-completion-mode') ?? null,
        candidates: $$('[data-pi-showcase-candidate]').map((row) => row.getAttribute('data-pi-showcase-candidate')),
        head: text(slot),
        candidateText: $$('[data-pi-showcase-candidate]').map((row) => text(row)),
      };
    `);
    record(
      "E2E-PLUGIN-showcase-completion-source-rows",
      completionFacts.mountFound &&
        completionFacts.inPopover &&
        completionFacts.mode === "slash" &&
        completionFacts.candidates.includes("showcase-inline") &&
        (completionFacts.candidateText.join(" ") ?? "").includes("/showcase-inline"),
      `typing /showcase opened the popover and its candidate rows are the plugin's: ${JSON.stringify(completionFacts.candidates)} — window: ${JSON.stringify(completionFacts)}`,
    );

    // ── composerReference ──────────────────────────────────────────────────
    // A reference is attached by the host's own `@` completion. The popover
    // mount exists in either mode — `data-pi-completion-mode` is host-owned and
    // the mount is in the list as soon as the popover is up — so the probe waits
    // for *file* mode and for the host's own file rows before it accepts. A
    // single read here would catch the previous, slash-mode popover and press
    // Enter against the wrong candidate list.
    const referenceFacts = await run(`
      setDraft('');
      const typed = setDraft('@README');
      const rows = await waitFor(
        () => {
          const slot = $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="completionSource"]');
          if (slot?.getAttribute('data-pi-completion-mode') !== 'file') return null;
          const found = $$('.composer-autocomplete .composer-ac-item');
          return found.length ? found : null;
        },
        ${RUNTIME_PROBE_TIMEOUT},
      );
      const editor = composerInput();
      const stage = composerStage();
      // The mode the accept is driven in, read before Enter closes the popover.
      const fileMode = rows
        ? $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="completionSource"]')
            ?.getAttribute('data-pi-completion-mode') ?? null
        : null;
      pressKey('Enter');
      const attached = await waitFor(
        () => stage?.querySelector('.composer-chip') ?? null,
        ${RUNTIME_PROBE_TIMEOUT},
      );
      const chip = $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="composerReference"]');
      return {
        typed,
        fileMode,
        hostRows: (rows ?? []).length,
        hostRowText: (rows ?? []).map((row) => text(row)),
        hostChip: text(attached),
        chipFound: Boolean(chip),
        referenceCount: chip?.getAttribute('data-pi-reference-count') ?? null,
        chipText: text(chip),
        afterEditor: Boolean(chip && editor)
          ? (editor.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          : false,
        ...composerState(),
      };
    `);
    record(
      "E2E-PLUGIN-showcase-composer-reference-chip",
      referenceFacts.chipFound &&
        referenceFacts.referenceCount === "1" &&
        (referenceFacts.chipText ?? "").includes("acme.plugin-showcase chip") &&
        (referenceFacts.chipText ?? "").includes("1 ref") &&
        (referenceFacts.chipText ?? "").includes("README.md") &&
        referenceFacts.afterEditor,
      `after attaching ${JSON.stringify(referenceFacts.hostChip)} from the host's ${referenceFacts.fileMode}-mode rows ${JSON.stringify(referenceFacts.hostRowText)} the plugin chip reads ${JSON.stringify(referenceFacts.chipText)} — window: ${JSON.stringify(referenceFacts)}`,
    );

    // ── The agent turn: gate, watch, facts, and the pending permission ─────
    // Painted one frame at a time so the payload never blocks the compositor.
    // The plugin writes its tool count on `tool_execution_end` and clears the
    // whole line again on `agent_end`, so a single read can only ever catch one
    // of the two (or neither). The status line is watched for the whole length
    // of the turn instead: every distinct value the host really painted is
    // recorded in the window, and the checks read that list afterwards.
    await run(`
      window.__showcaseStatusLog = [];
      window.__showcaseToastLog = [];
      const snapshot = () => {
        const line = statusLine().join(' | ');
        const statusLog = window.__showcaseStatusLog;
        if (statusLog[statusLog.length - 1] !== line) statusLog.push(line);
        // Toasts are transient, and the plugin's own refusal notice is one:
        // it is collected from every mutation instead of read once at the end.
        for (const toast of toasts()) {
          const toastLog = window.__showcaseToastLog;
          if (!toastLog.includes(toast)) toastLog.push(toast);
        }
      };
      snapshot();
      window.__showcaseStatusObserver?.disconnect();
      const observer = new MutationObserver(snapshot);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      window.__showcaseStatusObserver = observer;
      return true;
    `);
    const turn = await run(`
      setDraft('');
      const response = await window.piDesktop.invoke(
        window.piDesktop.channels.invoke.agentPrompt,
        {
          sessionId: ${JSON.stringify(sessionId)},
          content: 'Run the showcase agent turn.',
          messageId: crypto.randomUUID(),
          viewingSessionId: ${JSON.stringify(sessionId)},
          attachments: [],
        },
      );
      return { accepted: response?.accepted ?? null, turnId: response?.turnId ?? null };
    `);
    // The permission request is the host's own approval path, so waiting for
    // the host's card is waiting for the state the slot is defined against.
    const permissionSeen = await waitFor(
      () => run(`return { pending: Boolean($('.permission-card')), toasts: toasts(), status: statusLine() };`),
      "a pending permission request in the transcript",
      120_000,
    );

    // ── inlineConfirm (while the request is pending) ───────────────────────
    // The position facts are read while the card is *mounted*: the plugin's own
    // close button withdraws the registration, and React then removes the card
    // from the document — a read afterwards would be measuring a detached node
    // (it has no panes, no scroller and no transcript above it).
    const inlineFacts = await run(`
      const before = await waitFor(() => $('.permission-card'), ${RUNTIME_PROBE_TIMEOUT});
      const hostCardBefore = Boolean(before);
      showcaseTrigger('inlineConfirm')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const mounted = await waitFor(
        () => showcaseCard('inlineConfirm'),
        ${RUNTIME_PROBE_TIMEOUT},
      );
      const hostCardGone = !$('.permission-card');
      const container = $('[data-pi-plugin="${PLUGIN_ID}"][data-pi-plugin-slot="inlineConfirm"]');
      const cardText = text(mounted);
      const scroll = mounted?.closest('.thread-scroll') ?? null;
      const pane = mounted?.closest('.session-pane') ?? null;
      const rows = scroll ? Array.from(scroll.querySelectorAll('.message-row')) : [];
      const lastRow = rows[rows.length - 1] ?? null;
      const position = {
        inTranscript: Boolean(scroll),
        inContent: Boolean(mounted?.closest('.thread-content')),
        // The host's own confirmation card is the transcript's last block, so
        // the plugin's card has to sit after every message row in the scroller
        // and before the docked composer.
        afterLastRow: Boolean(
          mounted &&
            lastRow &&
            (lastRow.compareDocumentPosition(mounted) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        ),
        pane: pane?.getAttribute('data-session-pane') ?? null,
        paneVisible: pane?.getAttribute('data-visible') ?? null,
        scrollCount: $$('.thread-scroll').length,
      };
      $('[data-pi-showcase-close="inlineConfirm"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const hostCardBack = await waitFor(() => $('.permission-card'), ${RUNTIME_PROBE_TIMEOUT});
      return {
        hostCardBefore,
        mounted: Boolean(mounted),
        container: container?.getAttribute('data-pi-plugin') ?? null,
        ...position,
        cardText,
        hostCardGone,
        hostCardBack: Boolean(hostCardBack),
        triggerLabel: text(showcaseTrigger('inlineConfirm')),
      };
    `);
    record(
      "E2E-PLUGIN-showcase-inline-confirm-pending-permission",
      inlineFacts.hostCardBefore &&
        inlineFacts.mounted &&
        inlineFacts.container === PLUGIN_ID &&
        inlineFacts.inTranscript &&
        inlineFacts.inContent &&
        inlineFacts.afterLastRow &&
        inlineFacts.pane === sessionId &&
        inlineFacts.paneVisible === "true" &&
        (inlineFacts.cardText ?? "").includes("· inlineConfirm") &&
        (inlineFacts.cardText ?? "").includes(sessionId) &&
        inlineFacts.hostCardGone &&
        inlineFacts.hostCardBack,
      `the plugin's card took the confirmation position in the session's own transcript while the request was pending and gave it back on close — window: ${JSON.stringify(inlineFacts)}`,
    );

    // ── modal / overlay layers ─────────────────────────────────────────────
    const layerFacts = await run(`
      const snapshot = async (name) => {
        showcaseTrigger(name).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const layer = await waitFor(
          () => $('[data-pi-plugin-layer="' + name + '"]'),
          ${RUNTIME_PROBE_TIMEOUT},
        );
        return {
          layerFound: Boolean(layer),
          blocking: Boolean(layer?.classList.contains('is-modal')),
          cardText: text(layer?.querySelector('[data-pi-showcase-slot="' + name + '"]')),
          container: layer?.querySelector('[data-pi-plugin="${PLUGIN_ID}"]')?.getAttribute('data-pi-plugin') ?? null,
          triggerLabel: text(showcaseTrigger(name)),
          closeButton: Boolean(layer?.querySelector('[data-pi-showcase-close="' + name + '"]')),
        };
      };
      // The plugin's own button withdraws the registration for good.
      const modal = await snapshot('modal');
      $('[data-pi-showcase-close="modal"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      const modalClosed = await waitFor(
        () => !showcaseCard('modal'),
        ${RUNTIME_PROBE_TIMEOUT},
      );
      // Escape is the host's dismissal: the layer goes, the registration stays.
      const reopened = await snapshot('modal');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const dismissed = await waitFor(
        () => !$('[data-pi-plugin-layer="modal"]'),
        ${RUNTIME_PROBE_TIMEOUT},
      );
      const afterEscape = {
        dismissed: Boolean(dismissed),
        cardGone: !showcaseCard('modal'),
        triggerLabel: text(showcaseTrigger('modal')),
      };
      showcaseTrigger('modal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => !showcaseCard('modal'), ${RUNTIME_PROBE_TIMEOUT});
      const overlay = await snapshot('overlay');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const overlayDismissed = await waitFor(
        () => !$('[data-pi-plugin-layer="overlay"]'),
        ${RUNTIME_PROBE_TIMEOUT},
      );
      showcaseTrigger('overlay').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await waitFor(() => !showcaseCard('overlay'), ${RUNTIME_PROBE_TIMEOUT});
      return { modal, modalClosed: Boolean(modalClosed), reopened, afterEscape, overlay, overlayDismissed: Boolean(overlayDismissed) };
    `);
    record(
      "E2E-PLUGIN-showcase-modal-layer",
      layerFacts.modal.layerFound &&
        layerFacts.modal.blocking &&
        layerFacts.modal.container === PLUGIN_ID &&
        (layerFacts.modal.cardText ?? "").includes("· modal") &&
        layerFacts.modal.closeButton &&
        layerFacts.modalClosed &&
        layerFacts.reopened.layerFound &&
        layerFacts.afterEscape.dismissed &&
        layerFacts.afterEscape.dismissed &&
        // The card element leaves with the layer; the *registration* is still
        // up, and the trigger's own label is what says so.
        (layerFacts.afterEscape.triggerLabel ?? "").includes("close modal") &&
        (layerFacts.reopened.triggerLabel ?? "").includes("close modal"),
      `the modal layer is on screen with a blocking scrim and its own container; the card's button and Escape both take it away (Escape leaves the registration up): ${JSON.stringify(layerFacts.modal.cardText)}`,
    );
    record(
      "E2E-PLUGIN-showcase-overlay-layer",
      layerFacts.overlay.layerFound &&
        layerFacts.overlay.blocking === false &&
        layerFacts.overlay.container === PLUGIN_ID &&
        (layerFacts.overlay.cardText ?? "").includes("· overlay") &&
        layerFacts.overlayDismissed,
      `the overlay layer is on screen without a scrim and Escape dismisses it: ${JSON.stringify(layerFacts.overlay.cardText)}`,
    );

    // ── Resolve the permission so the turn can finish ──────────────────────
    const resolved = await run(`
      // The permission card's last action is the affirmative one; its label is
      // localized, so the position is what is clicked, not the text.
      const actions = $$('.permission-card .permission-card-actions button');
      const allow = actions[actions.length - 1] ?? null;
      allow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return { found: Boolean(allow), label: allow ? text(allow) : null };
    `);
    // Wait for the run to end: the plugin clears its status line on `agent_end`.
    const summarySeen = await waitFor(
      async () => {
        const read = await run(`
          return { toasts: toasts(), status: statusLine() };
        `);
        return read.toasts.some((toast) => toast.includes("turn summary")) ? read : null;
      },
      "the plugin's turn-facts summary",
      180_000,
    );

    // Every toast the window really raised during the turn, collected by the
    // watcher installed before the prompt (they are transient by design).
    const toastLog = await run(`return window.__showcaseToastLog ?? [];`);

    // A gated call is answered by the kernel with an error tool *result*, so
    // the host draws the call as a failed command row and nothing of its own:
    // a run row's presentation maps only stdout/stderr, and a bare text result
    // therefore renders no body (apps/desktop/src/lib/tool-presentation.ts,
    // "run" branch → `mapped` short-circuits the fallback). What the user is
    // given is the plugin's own warning, and what the model is given is the
    // result the gate returned; both are checked here, together with the row.
    const gateFacts = await run(`
      setDraft('');
      for (let pass = 0; pass < 6; pass += 1) {
        if (expandTranscript() === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const rendered = transcriptText() ?? '';
      const rowTexts = $$('.tool-row').map((row) => text(row));
      const refused = $$('.tool-row').find((row) => text(row).includes('git reset --hard HEAD~1')) ?? null;
      return {
        refusedRow: Boolean(refused),
        refusedRowFailed: Boolean(
          refused &&
            (refused.classList.contains('status-error') || refused.classList.contains('is-error')),
        ),
        refusedRowText: refused ? text(refused) : null,
        // The transcript the user actually reads: innerText leaves out what
        // the DOM keeps hidden, so this says the row was really drawn.
        refusedRowRendered: rendered.includes('git reset --hard HEAD~1'),
        renderedTail: rendered.slice(-600),
        // The call the model made *after* the refusal reached the host's own
        // approval path — approved or denied is the user's decision, not this
        // check's — which is what shows the gate refused one specific call
        // instead of stalling the turn.
        benignRow: rowTexts.some((row) => row.includes('echo plugin-showcase-e2e')),
        rowTexts,
      };
    `);
    const modelSawRefusal = stub.requests.some((payload) =>
      JSON.stringify(payload.messages ?? []).includes("Plugin Showcase refused"),
    );
    const modelDigest = stub.requests.map((payload) => ({
      model: payload.model ?? null,
      messages: (payload.messages ?? []).map((message) => ({
        role: message.role,
        calls: (message.tool_calls ?? []).map((call) => call.function?.name ?? null),
        args: (message.tool_calls ?? []).map((call) => call.function?.arguments ?? null),
        refused: JSON.stringify(message).includes("Plugin Showcase refused"),
      })),
    }));
    const userSawRefusal = toastLog.some((toast) =>
      toast.includes("Plugin Showcase refused a shell command"),
    );
    record(
      "E2E-PLUGIN-showcase-agent-tool-gate-refusal",
      gateFacts.refusedRow &&
        gateFacts.refusedRowFailed &&
        gateFacts.refusedRowRendered &&
        gateFacts.benignRow &&
        modelSawRefusal &&
        userSawRefusal,
      `the gate refused the model's own dangerous Bash call: the failed row ${JSON.stringify(gateFacts.refusedRowText)} is in the transcript, the plugin's reason reached the model's next request (${modelSawRefusal}) and the user as a warning toast (${userSawRefusal}); the call after it reached the host's approval path (${gateFacts.benignRow}); transcript tool rows: ${JSON.stringify(gateFacts.rowTexts)}; model requests: ${JSON.stringify(modelDigest)}`,
    );

    // ── agent: the turn watch status line ──────────────────────────────────
    // The line the plugin writes on `tool_execution_end` is cleared again on
    // `agent_end`, so the turn's own write is read from the watched log rather
    // than from one snapshot taken while the permission was pending.
    const watchedStatus = await waitFor(
      async () => {
        const log = await run(`return window.__showcaseStatusLog ?? [];`);
        return log.some((line) => STATUS_TOOL_COUNT.test(line)) ? log : null;
      },
      "the plugin's own tool count in the host's status line",
      30_000,
    ).catch(() => run(`return window.__showcaseStatusLog ?? [];`));
    record(
      "E2E-PLUGIN-showcase-agent-turn-status-chip",
      watchedStatus.some((line) => STATUS_TOOL_COUNT.test(line)),
      `the plugin's own count reached the host's status line, which read ${JSON.stringify(permissionSeen.status)} while the request was pending: ${JSON.stringify(watchedStatus)}`,
    );

    // ── agent: the turn facts summary ──────────────────────────────────────
    record(
      "E2E-PLUGIN-showcase-agent-turn-facts-summary",
      summarySeen.toasts.some((toast) => /Plugin Showcase · turn summary — \w+/.test(toast)) &&
        summarySeen.status.length === 0,
      `${JSON.stringify(resolved)}; one summary per run, and the status line is cleared with it: ${JSON.stringify(summarySeen.toasts.filter((toast) => toast.includes("turn summary")))}`,
    );

    return {
      turnAccepted: turn.accepted,
      modelRequests: stub.requests.length,
      toasts: summarySeen.toasts,
    };
  } catch (error) {
    throw new Error(`${describe(error)}\n--- window ---\n${await windowSnapshot(client)}`);
  } finally {
    client?.close();
    if (child) await killTree(child);
    await stub.close();
    try {
      rmSync(runRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // A held profile lock must not turn a completed journey into a failure.
    }
  }
}

try {
  await runJourney();
} catch (error) {
  const headline = "E2E-PLUGIN-showcase-slots-in-a-real-window";
  if (!results.some((result) => result.id === headline)) {
    record(
      headline,
      false,
      error instanceof Error
        ? error.stack ?? error.message
        : String(error),
    );
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
