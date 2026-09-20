/**
 * Unit tests for the trusted renderer host's host-side pieces (ADR 0291).
 *
 * The renderer host is the first plugin surface that runs inside the app window,
 * so the parts that decide what a plugin may own are tested directly rather than
 * only through the app: the slot registry's bookkeeping, and the stylesheet
 * guard that refuses a sheet reaching for the host's own roots.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

/** A file's worth of DOM, enough for the style injection contract. */
class FakeElement {
  attributes = new Map();
  textContent = "";
  removed = false;

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  remove() {
    this.removed = true;
    const index = document.head.children.indexOf(this);
    if (index >= 0) document.head.children.splice(index, 1);
  }
}

const document = {
  head: {
    children: [],
    appendChild(element) {
      this.children.push(element);
      return element;
    },
  },
  createElement(tag) {
    const element = new FakeElement();
    element.tag = tag;
    return element;
  },
  querySelectorAll(selector) {
    const match = /^style\[([^=\]]+)="(.*)"\]$/.exec(selector);
    if (!match) return [];
    return document.head.children.filter(
      (element) => element.tag === "style" && element.getAttribute(match[1]) === match[2],
    );
  },
};

globalThis.document = document;

/**
 * `lib/api` captures the preload bridge at import time, so the fake goes in
 * before the first import below and each test programs the reply it needs.
 * `plugin-renderer-call` covers the real main process with a real plugin
 * process; these cases are about what the renderer sends and what it does with
 * the answer.
 */
const bridgeCalls = [];
let bridgeReply = () => ({ ok: true, data: null });
globalThis.piDesktop = {
  invoke: async (channel, ...args) => {
    bridgeCalls.push({ channel, args });
    return bridgeReply(channel, args);
  },
  on: () => () => {},
  channels: {},
  platform: "darwin",
};

const { pluginSlots, resetPluginSlots } = await import(
  "../src/plugins/renderer-slots/registry.ts"
);
const { forbiddenSelector, injectPluginStyle, removePluginStyles } = await import(
  "../src/plugins/renderer-slots/style-injection.ts"
);
const { rendererCandidates } = await import("../src/plugins/renderer-slots/candidates.ts");
const { entryExtraSlotProps, transcriptEntryIdentity } = await import(
  "../src/features/chat/transcript/model.ts"
);
const {
  MAX_PLUGIN_CODE_BLOCK_SOURCE_LENGTH,
  RESERVED_LANGUAGES,
  codeBlockComponentFor,
  codeBlockSourceTooLarge,
} = await import("../src/plugins/renderer-slots/code-blocks.ts");
const { MAX_MERMAID_SOURCE_LENGTH } = await import("../src/lib/mermaid.ts");
const loader = await import("../src/plugins/renderer-host/loader.ts");
const relay = await import("../src/plugins/renderer-host/relay.ts");
const registryModule = await import("../src/plugins/renderer-slots/registry.ts");
const { ensureRendererPlugin, resetRendererPlugins } = loader;
const { IPC } = await import("@pi-desktop/shared");
const pluginSdk = await import("@pi-desktop/plugin-sdk");
const { PLUGIN_RENDERER_ACTIONS } = pluginSdk;
const { installRendererHostActions, DRAFT_PREFILL_DEADLINE_MS } = await import(
  "../src/plugins/renderer-host/host-actions.ts"
);
const { useAppStore } = await import("../src/stores/app-store.ts");
const {
  dispatchFromPlugin,
  registerHostRendererAction,
  resetRendererRelay,
  slotDispatchFor,
} = relay;

/**
 * `SlotOutlet.tsx` is the one TSX module here, so it is transpiled the same
 * way the presentation tests load their components: the outlet's dependencies
 * are handed over explicitly, which also proves the props contract at the
 * component boundary instead of only inside the relay.
 */
function loadSlotOutlet() {
  const file = new URL("../src/plugins/renderer-slots/SlotOutlet.tsx", import.meta.url);
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    fileName: file.pathname,
  });
  const imports = {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@pi-desktop/plugin-sdk": pluginSdk,
    "../renderer-host/loader": loader,
    "../renderer-host/relay": relay,
    "./registry": registryModule,
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", outputText)(
    (id) => {
      assert.ok(Object.hasOwn(imports, id), `unmocked slot outlet dependency: ${id}`);
      return imports[id];
    },
    module.exports,
    module,
  );
  return module.exports;
}

/** Action refusals, in order; other diagnostics from the setup are ignored. */
function actionRefusals() {
  return pluginSlots
    .listDiagnostics()
    .filter((entry) => entry.code.startsWith("PLUGIN_ACTION_"));
}

function component() {
  return null;
}

test("the slot registry keeps one list per (plugin, slot) in registration order", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entryExtra", component);
  pluginSlots.register("acme.two", "entryExtra", component);
  pluginSlots.register("acme.one", "composerControl", component);

  const entries = pluginSlots.list("entryExtra");
  assert.deepEqual(
    entries.map((registration) => registration.pluginId),
    ["acme.one", "acme.two"],
  );
  assert.equal(pluginSlots.list("composerControl").length, 1);
  assert.equal(pluginSlots.list("modal").length, 0);
});

test("replace slots take one claim; a second registration is refused", () => {
  resetPluginSlots();
  const first = pluginSlots.register("acme.one", "entry", component);
  assert.ok(first);
  const second = pluginSlots.register("acme.two", "entry", component);
  assert.equal(second, null);
  assert.equal(pluginSlots.list("entry").length, 1);
  const [diagnostic] = pluginSlots.listDiagnostics("acme.two");
  assert.equal(diagnostic.code, "PLUGIN_SLOT_DUPLICATE");
  first.remove();
  const third = pluginSlots.register("acme.two", "entry", component);
  assert.ok(third, "claim is released on remove");
});

test("two registrations from one plugin both survive on an additive slot", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entryExtra", component);
  pluginSlots.register("acme.one", "entryExtra", component);
  assert.equal(pluginSlots.list("entryExtra").length, 2);
  assert.equal(pluginSlots.countFor("acme.one"), 2);
  assert.deepEqual(pluginSlots.listDiagnostics(), []);
});

test("a component that is not a function is refused with a diagnostic, never silently", () => {
  resetPluginSlots();
  const handle = pluginSlots.register("acme.one", "entry", { not: "a component" });
  assert.equal(handle, null);
  assert.equal(pluginSlots.list("entry").length, 0);
  const [diagnostic] = pluginSlots.listDiagnostics();
  assert.equal(diagnostic.code, "PLUGIN_SLOT_INVALID_COMPONENT");
  assert.equal(diagnostic.pluginId, "acme.one");
});

test("withdrawing one registration leaves the plugin's others alone", () => {
  resetPluginSlots();
  const first = pluginSlots.register("acme.one", "entryExtra", component);
  pluginSlots.register("acme.one", "entryExtra", component);
  first.remove();
  assert.equal(pluginSlots.list("entryExtra").length, 1);
});

test("unloading a plugin releases every position it held (D10)", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entry", component);
  pluginSlots.register("acme.one", "overlay", component);
  pluginSlots.register("acme.two", "entryExtra", component);
  pluginSlots.unregisterPlugin("acme.one");
  assert.equal(pluginSlots.list("entry").length, 0);
  assert.equal(pluginSlots.list("entryExtra").length, 1);
  assert.equal(pluginSlots.list("entryExtra")[0].pluginId, "acme.two");
  assert.equal(pluginSlots.list("overlay").length, 0);
  assert.equal(pluginSlots.countFor("acme.one"), 0);
});

test("subscribers see registry changes and the snapshot version moves", () => {
  resetPluginSlots();
  let seen = 0;
  const unsubscribe = pluginSlots.subscribe(() => {
    seen += 1;
  });
  const before = pluginSlots.snapshot();
  pluginSlots.register("acme.one", "entry", component);
  assert.ok(pluginSlots.snapshot() > before);
  assert.equal(seen, 1);
  unsubscribe();
  pluginSlots.unregisterPlugin("acme.one");
  assert.equal(seen, 1);
});

test("the style guard refuses a sheet that reaches a host root", () => {
  for (const css of [
    "html { color: red }",
    "body, .acme { margin: 0 }",
    "* { box-sizing: border-box }",
    "@media (min-width: 600px) { html { font-size: 20px } }",
    ".acme { color: #fff }\nbody { background: #000 }",
  ]) {
    assert.notEqual(forbiddenSelector(css), null, `expected refusal: ${css}`);
  }
});

test("the style guard leaves :root alone so the host can rewrite it", () => {
  for (const css of [
    ".acme-card { color: #fff }",
    ".html-widget { display: block }",
    "/* html { color: red } */ .acme { color: blue }",
    "[data-pi-plugin] .acme { gap: 4px }",
    ".acme-body { padding: 4px }",
    ":root { --acme: 1px }",
    ":root[data-theme='light'] .acme-card { color: #000 }",
  ]) {
    assert.equal(forbiddenSelector(css), null, `expected to pass: ${css}`);
  }
});

test("an injected sheet is scoped under the plugin container", () => {
  resetPluginSlots();
  document.head.children.length = 0;
  const handle = injectPluginStyle("acme.one", ".acme { color: red }");
  assert.equal(document.head.children.length, 1);
  const [element] = document.head.children;
  assert.equal(element.getAttribute("data-pi-plugin-style"), "acme.one");
  assert.equal(element.getAttribute("data-pi-plugin-style-mode"), "scoped");
  assert.match(element.textContent, /\[data-pi-plugin="acme\.one"\]\s*\.acme/);
  assert.match(element.textContent, /color:\s*red/);

  injectPluginStyle("acme.one", ".acme-b { color: blue }");
  injectPluginStyle("acme.two", ".other { color: green }");
  removePluginStyles("acme.one");
  assert.equal(document.head.children.length, 1);
  assert.equal(document.head.children[0].getAttribute("data-pi-plugin-style"), "acme.two");

  handle.remove();
  assert.equal(handle.remove instanceof Function, true);
});

test(":root is rewritten to the plugin container for theme branches", () => {
  resetPluginSlots();
  document.head.children.length = 0;
  injectPluginStyle("acme.one", ":root[data-theme='light'] .card { color: #111 }");
  const [element] = document.head.children;
  assert.match(
    element.textContent,
    /\[data-pi-plugin="acme\.one"\]\[data-theme='light'\]\s*\.card/,
  );
});

test("a refused sheet throws a coded error instead of injecting part of it", () => {
  document.head.children.length = 0;
  assert.throws(
    () => injectPluginStyle("acme.one", "body { display: none }"),
    (error) => error.code === "PLUGIN_STYLE_REFUSED",
  );
  assert.equal(document.head.children.length, 0);
});

test("ambient props follow declared rendererData, not every candidate", async () => {
  const { ambientPropsFor } = loadSlotOutlet();
  const declared = {
    id: "acme.trusted",
    declared: true,
    rendererData: ["theme", "locale"],
    rendererActions: [],
  };
  assert.deepEqual(ambientPropsFor(declared, { theme: "light", locale: "zh-CN" }), {
    theme: "light",
    locale: "zh-CN",
  });
  assert.deepEqual(
    ambientPropsFor(
      { id: "acme.quiet", declared: true, rendererData: [], rendererActions: [] },
      { theme: "light", locale: "zh-CN" },
    ),
    {},
  );
});

test("only plugins the host marked with the renderer capability are candidates", () => {
  const candidates = rendererCandidates([
    {
      id: "acme.trusted",
      version: "1.0.0",
      capabilities: ["panel", "renderer"],
      rendererData: ["entry", "theme"],
      rendererActions: ["plugin.call"],
    },
    { id: "acme.sandboxed", version: "1.0.0", capabilities: ["panel"] },
    { id: "acme.plain", version: "1.0.0" },
  ]);
  assert.deepEqual(candidates, [
    {
      id: "acme.trusted",
      version: "1.0.0",
      declared: true,
      rendererData: ["entry", "theme"],
      rendererActions: ["plugin.call"],
    },
  ]);
});

test("a renderer plugin that declares nothing carries empty lists, not undefined (issue #528)", () => {
  const [candidate] = rendererCandidates([
    { id: "acme.legacy", version: "1.0.0", capabilities: ["renderer"] },
  ]);
  // A manifest written before the fields existed reads as "declared nothing",
  // and every consumer sees the same shape either way.
  assert.deepEqual(candidate.rendererData, []);
  assert.deepEqual(candidate.rendererActions, []);
});

test("the loader refuses a plugin that never declared the entry, with a diagnostic", async () => {
  resetPluginSlots();
  const { ensureRendererPlugin, resetRendererPlugins } = await import(
    "../src/plugins/renderer-host/loader.ts"
  );
  resetRendererPlugins();
  await ensureRendererPlugin("acme.sandboxed", { declared: false });
  const [diagnostic] = pluginSlots.listDiagnostics();
  assert.equal(diagnostic.code, "PLUGIN_SLOT_NOT_DECLARED");
  assert.equal(diagnostic.pluginId, "acme.sandboxed");
});

test("entryExtra props map each transcript role onto the contract's three", () => {
  const contractRole = {
    user: "user",
    assistant: "assistant",
    system: "system",
    // A tool row is host-rendered assistant work, not user input or a notice.
    tool: "assistant",
  };
  for (const [role, expected] of Object.entries(contractRole)) {
    const props = entryExtraSlotProps({ id: `entry-${role}`, role }, "session-1");
    assert.equal(props.entry.id, `entry-${role}`);
    assert.equal(props.entry.role, expected);
    assert.equal(props.sessionId, "session-1");
    assert.equal(Object.hasOwn(props.entry, "pluginId"), false);
  }
});

test("entry.pluginId appears only when the host knows the producer (D14)", () => {
  const own = entryExtraSlotProps(
    { id: "entry-1", role: "assistant", pluginId: "acme.charts" },
    "session-1",
  );
  assert.equal(own.entry.pluginId, "acme.charts");

  // Unknown, blank, and whitespace-only producers must all be absent rather
  // than blank, so `props.entry.pluginId === pi.plugin.id` cannot match a
  // value no plugin owns.
  for (const pluginId of [undefined, "", "   "]) {
    const props = entryExtraSlotProps({ id: "entry-1", role: "assistant", pluginId }, "session-1");
    assert.equal(Object.hasOwn(props.entry, "pluginId"), false);
    assert.equal(props.entry.pluginId, undefined);
  }
});

test("the host leaves pluginId unset until a producer can report itself", () => {
  const identity = transcriptEntryIdentity({ id: "entry-1", role: "user" });
  assert.deepEqual(identity, { id: "entry-1", role: "user" });
  assert.equal(Object.hasOwn(identity, "pluginId"), false);

  const props = entryExtraSlotProps(identity, "session-1");
  assert.deepEqual(Object.keys(props).sort(), ["entry", "sessionId"]);
  assert.deepEqual(Object.keys(props.entry).sort(), ["id", "role"]);
});

test("a codeBlock registration without a language is refused with PLUGIN_SLOT_LANGUAGE_MISSING", () => {
  resetPluginSlots();
  const handle = pluginSlots.register("acme.notes", "codeBlock", component);
  assert.equal(handle, null);
  assert.equal(pluginSlots.list("codeBlock").length, 0);
  const [diagnostic] = pluginSlots.listDiagnostics();
  assert.equal(diagnostic.code, "PLUGIN_SLOT_LANGUAGE_MISSING");
  assert.equal(diagnostic.pluginId, "acme.notes");
  assert.equal(diagnostic.slot, "codeBlock");

  // Whitespace and a non-string are the same failure: no language was named.
  assert.equal(
    pluginSlots.register("acme.notes", "codeBlock", component, { language: "   " }),
    null,
  );
  assert.equal(
    pluginSlots.register("acme.notes", "codeBlock", component, { language: 7 }),
    null,
  );
  assert.deepEqual(
    pluginSlots.listDiagnostics().map((entry) => entry.code),
    [
      "PLUGIN_SLOT_LANGUAGE_MISSING",
      "PLUGIN_SLOT_LANGUAGE_MISSING",
      "PLUGIN_SLOT_LANGUAGE_MISSING",
    ],
  );
});

test("a host-reserved language is refused with PLUGIN_SLOT_LANGUAGE_RESERVED", () => {
  resetPluginSlots();
  assert.deepEqual([...RESERVED_LANGUAGES], ["json", "ts", "mermaid"]);
  for (const language of RESERVED_LANGUAGES) {
    assert.equal(
      pluginSlots.register("acme.notes", "codeBlock", component, { language }),
      null,
      `expected ${language} to be refused`,
    );
    assert.equal(codeBlockComponentFor(language), null);
  }
  assert.equal(pluginSlots.list("codeBlock").length, 0);
  assert.deepEqual(
    pluginSlots.listDiagnostics().map((entry) => entry.code),
    [
      "PLUGIN_SLOT_LANGUAGE_RESERVED",
      "PLUGIN_SLOT_LANGUAGE_RESERVED",
      "PLUGIN_SLOT_LANGUAGE_RESERVED",
    ],
  );
});

test("a language that is not the plugin's own namespace is refused", () => {
  resetPluginSlots();
  for (const language of ["chart", "other.plugin:chart", "acme.notes:", "acme.notes.chart"]) {
    assert.equal(
      pluginSlots.register("acme.notes", "codeBlock", component, { language }),
      null,
      `expected refusal: ${language}`,
    );
    assert.equal(codeBlockComponentFor(language), null);
  }
  assert.deepEqual(
    pluginSlots.listDiagnostics().map((entry) => entry.code),
    [
      "PLUGIN_SLOT_LANGUAGE_INVALID",
      "PLUGIN_SLOT_LANGUAGE_INVALID",
      "PLUGIN_SLOT_LANGUAGE_INVALID",
      "PLUGIN_SLOT_LANGUAGE_INVALID",
    ],
  );
});

test("a well-formed language resolves to the component that claimed it", () => {
  resetPluginSlots();
  const chart = () => null;
  const handle = pluginSlots.register("acme.notes", "codeBlock", chart, {
    language: "acme.notes:chart",
  });
  assert.notEqual(handle, null);
  const [registration] = pluginSlots.list("codeBlock");
  assert.equal(registration.pluginId, "acme.notes");
  assert.equal(registration.slot, "codeBlock");
  assert.equal(registration.language, "acme.notes:chart");
  assert.equal(registration.component, chart);
  assert.equal(codeBlockComponentFor("acme.notes:chart").component, chart);
  assert.equal(codeBlockComponentFor("acme.notes:other"), null);
  assert.equal(codeBlockComponentFor("acme.other:chart"), null);
  assert.equal(codeBlockComponentFor(""), null);
});

test("a language has one renderer: the first registration keeps it and the second is refused (D13)", () => {
  resetPluginSlots();
  const owner = () => null;
  const intruder = () => null;
  pluginSlots.register("acme.one", "codeBlock", owner, { language: "acme.one:chart" });
  const second = pluginSlots.register("acme.two", "codeBlock", intruder, {
    language: "acme.one:chart",
  });
  assert.equal(second, null);
  assert.equal(codeBlockComponentFor("acme.one:chart").pluginId, "acme.one");
  assert.equal(codeBlockComponentFor("acme.one:chart").component, owner);
  const [diagnostic] = pluginSlots.listDiagnostics();
  assert.equal(diagnostic.code, "PLUGIN_SLOT_LANGUAGE_INVALID");
  assert.equal(diagnostic.pluginId, "acme.two");

  // Within one plugin the same language may be registered twice; the first one
  // still wins, so a language never has two renderers.
  pluginSlots.unregisterPlugin("acme.two");
  pluginSlots.register("acme.one", "codeBlock", intruder, { language: "acme.one:chart" });
  assert.equal(pluginSlots.list("codeBlock").length, 2);
  assert.equal(codeBlockComponentFor("acme.one:chart").component, owner);
});

test("withdrawing the registration or unloading the plugin makes the language unresolved again", () => {
  resetPluginSlots();
  const handle = pluginSlots.register("acme.notes", "codeBlock", component, {
    language: "acme.notes:chart",
  });
  assert.notEqual(codeBlockComponentFor("acme.notes:chart"), null);
  handle.remove();
  assert.equal(codeBlockComponentFor("acme.notes:chart"), null);

  pluginSlots.register("acme.notes", "codeBlock", component, {
    language: "acme.notes:chart",
  });
  assert.notEqual(codeBlockComponentFor("acme.notes:chart"), null);
  pluginSlots.unregisterPlugin("acme.notes");
  assert.equal(codeBlockComponentFor("acme.notes:chart"), null);
  assert.equal(pluginSlots.list("codeBlock").length, 0);
});

test("the options argument belongs to codeBlock and leaves every other slot untouched", () => {
  resetPluginSlots();
  const handle = pluginSlots.register("acme.one", "entry", component, {
    language: "acme.one:chart",
  });
  assert.notEqual(handle, null);
  assert.equal(pluginSlots.list("entry")[0].language, undefined);
  assert.deepEqual(pluginSlots.listDiagnostics(), []);
});

test("a plugin block is capped at the same source ceiling the host uses for mermaid", () => {
  assert.equal(MAX_PLUGIN_CODE_BLOCK_SOURCE_LENGTH, MAX_MERMAID_SOURCE_LENGTH);
  const atLimit = "x".repeat(MAX_PLUGIN_CODE_BLOCK_SOURCE_LENGTH);
  assert.equal(codeBlockSourceTooLarge(atLimit), false);
  assert.equal(codeBlockSourceTooLarge(`${atLimit}x`), true);
});

test("a mount that owns one registration draws only it, keeping the container attributes it needs", () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  const { PluginSlot } = loadSlotOutlet();
  const drawn = [];
  pluginSlots.register(
    "acme.notes",
    "codeBlock",
    (props) => {
      drawn.push(["acme.notes", props.language]);
      return null;
    },
    { language: "acme.notes:chart" },
  );
  pluginSlots.register(
    "acme.plots",
    "codeBlock",
    (props) => {
      drawn.push(["acme.plots", props.language]);
      return null;
    },
    { language: "acme.plots:timeline" },
  );
  const [notes] = pluginSlots.list("codeBlock");
  const markup = renderToStaticMarkup(
    React.createElement(
      PluginSlot,
      {
        slot: "codeBlock",
        registrations: [notes],
        slotProps: {
          language: "acme.notes:chart",
          code: "A --> B",
          isIncomplete: false,
          theme: "dark",
        },
        containerProps: { "data-source-start": 7, "data-source-end": 21 },
      },
      React.createElement("div", { className: "host-code" }, "host block"),
    ),
  );
  assert.deepEqual(drawn, [["acme.notes", "acme.notes:chart"]]);
  assert.match(markup, /data-pi-plugin="acme\.notes"/);
  assert.match(markup, /data-pi-plugin-slot="codeBlock"/);
  assert.match(markup, /data-source-start="7"/);
  assert.match(markup, /data-source-end="21"/);
  assert.doesNotMatch(markup, /acme\.plots|host-code/);

  // An empty list is a position nothing owns: the host's own rendering shows.
  drawn.length = 0;
  const empty = renderToStaticMarkup(
    React.createElement(
      PluginSlot,
      { slot: "codeBlock", registrations: [], slotProps: {} },
      React.createElement("div", { className: "host-code" }, "host block"),
    ),
  );
  assert.deepEqual(drawn, []);
  assert.match(empty, /host-code/);
  assert.doesNotMatch(empty, /data-pi-plugin/);
});

test("a candidate's declared actions are live from the outlet's first render, without a load", async () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  const { PluginSlot } = loadSlotOutlet();
  // No `ensureRendererPlugin` call anywhere: the mount carries the row, so the
  // relay must answer from what the render recorded.
  renderToStaticMarkup(
    React.createElement(PluginSlot, {
      slot: "entry",
      slotProps: {},
      candidates: [
        {
          id: "acme.one",
          declared: true,
          rendererData: [],
          rendererActions: ["ui.toast"],
        },
      ],
    }),
  );
  const seen = [];
  const remove = registerHostRendererAction("ui.toast", (payload, pluginId) => {
    seen.push([pluginId, payload]);
    return "shown";
  });
  assert.equal(await dispatchFromPlugin("acme.one", "ui.toast", { text: "hi" }), "shown");
  assert.deepEqual(seen, [["acme.one", { text: "hi" }]]);
  await assert.rejects(
    () => dispatchFromPlugin("acme.one", "composer.replaceDraft"),
    (error) => error.code === "PLUGIN_ACTION_UNDECLARED",
  );
  remove();
});
test("the outlet hands a plugin's component a dispatch bound to that plugin", () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  const { PluginSlot } = loadSlotOutlet();
  let received = null;
  pluginSlots.register("acme.one", "entry", (props) => {
    received = props;
    return null;
  });
  const candidates = [
    {
      id: "acme.one",
      version: "1.0.0",
      declared: true,
      rendererData: ["entry"],
      rendererActions: ["ui.toast"],
    },
  ];
  const render = () =>
    renderToStaticMarkup(
      React.createElement(PluginSlot, {
        slot: "entry",
        // A slot prop named `dispatch` must lose to the host's own function.
        slotProps: { entry: { id: "entry-1", role: "user" }, dispatch: "not a function" },
        candidates,
      }),
    );

  const markup = render();
  assert.match(markup, /data-pi-plugin="acme\.one"/);
  assert.equal(received.entry.id, "entry-1");
  assert.equal(typeof received.dispatch, "function");
  assert.notEqual(received.dispatch, "not a function");

  // The same function object comes back on the next render, and everything one
  // plugin renders shares it — a plugin may list `dispatch` as a dependency.
  const first = received.dispatch;
  render();
  assert.equal(received.dispatch, first);
  assert.equal(received.dispatch, slotDispatchFor("acme.one"));
  assert.notEqual(received.dispatch, slotDispatchFor("acme.two"));
});

test("a dispatch for an action the plugin never declared is refused with PLUGIN_ACTION_UNDECLARED", async () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  const { PluginSlot } = loadSlotOutlet();
  let dispatch = null;
  pluginSlots.register("acme.quiet", "entry", (props) => {
    dispatch = props.dispatch;
    return null;
  });
  renderToStaticMarkup(
    React.createElement(PluginSlot, {
      slot: "entry",
      slotProps: {},
      candidates: [
        { id: "acme.quiet", declared: true, rendererData: [], rendererActions: [] },
      ],
    }),
  );
  assert.equal(typeof dispatch, "function");

  await assert.rejects(
    () => dispatch("composer.replaceDraft", { text: "hello" }),
    (error) =>
      error.code === "PLUGIN_ACTION_UNDECLARED" &&
      error.message === "PLUGIN_ACTION_UNDECLARED" &&
      error.action === "composer.replaceDraft" &&
      error.pluginId === "acme.quiet",
    "an undeclared action must reject, never resolve",
  );
  const [refusal] = actionRefusals();
  assert.equal(refusal.code, "PLUGIN_ACTION_UNDECLARED");
  assert.equal(refusal.pluginId, "acme.quiet");
  assert.match(refusal.detail, /did not declare "composer\.replaceDraft"/);
});

test("a declared action with no route yet is refused with PLUGIN_ACTION_UNROUTED, naming the action", async () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  // Recording the row's declaration is enough: the relay answers from what the
  // mount point carried in, whether or not the module ever loads.
  await ensureRendererPlugin("acme.one", {
    declared: false,
    actions: ["ui.toast", "plugin.call"],
  });
  for (const action of ["ui.toast", "plugin.call"]) {
    await assert.rejects(
      () => dispatchFromPlugin("acme.one", action, { method: "ping" }),
      (error) =>
        error.code === "PLUGIN_ACTION_UNROUTED" &&
        error.message === "PLUGIN_ACTION_UNROUTED" &&
        error.action === action,
      `${action} must not resolve to undefined`,
    );
  }
  assert.deepEqual(
    actionRefusals().map((entry) => [entry.code, entry.detail]),
    [
      ["PLUGIN_ACTION_UNROUTED", 'the host has no handler for "ui.toast" yet'],
      ["PLUGIN_ACTION_UNROUTED", 'the host has no handler for "plugin.call" yet'],
    ],
  );
});

test("a registered host handler receives the payload and its value is what dispatch resolves", async () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  const seen = [];
  const remove = registerHostRendererAction("ui.toast", (payload, pluginId) => {
    seen.push({ payload, pluginId });
    return { shown: true };
  });
  await ensureRendererPlugin("acme.one", { declared: false, actions: ["ui.toast"] });

  assert.deepEqual(await dispatchFromPlugin("acme.one", "ui.toast", { text: "hi" }), {
    shown: true,
  });
  assert.deepEqual(seen, [{ payload: { text: "hi" }, pluginId: "acme.one" }]);
  assert.deepEqual(actionRefusals(), []);

  // Withdrawing the handler turns the same call back into an explicit refusal.
  remove();
  await assert.rejects(
    () => dispatchFromPlugin("acme.one", "ui.toast", {}),
    (error) => error.code === "PLUGIN_ACTION_UNROUTED",
  );
});

test("one plugin's declaration does not authorise another plugin's dispatch", async () => {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  await ensureRendererPlugin("acme.one", { declared: false, actions: ["ui.toast"] });
  await ensureRendererPlugin("acme.two", { declared: false, actions: [] });
  const remove = registerHostRendererAction("ui.toast", () => "ok");
  assert.equal(await dispatchFromPlugin("acme.one", "ui.toast"), "ok");
  await assert.rejects(
    () => dispatchFromPlugin("acme.two", "ui.toast"),
    (error) => error.code === "PLUGIN_ACTION_UNDECLARED",
  );
  remove();
});

test("a handler for a name outside the action vocabulary is refused at registration", () => {
  resetRendererRelay();
  assert.throws(
    () => registerHostRendererAction("ui.invented", () => null),
    (error) => error.code === "PLUGIN_ACTION_UNKNOWN" && error.action === "ui.invented",
  );
});

/** Every test here installs the real wiring and then drives the real relay. */
async function installed(actions) {
  resetPluginSlots();
  resetRendererPlugins();
  resetRendererRelay();
  installRendererHostActions();
  bridgeCalls.length = 0;
  bridgeReply = () => ({ ok: true, data: null });
  useAppStore.setState({ activeSessionId: undefined, composerPrefill: null, toasts: [] });
  await ensureRendererPlugin("acme.one", { declared: false, actions });
}

test("installing the host actions routes the implemented names and leaves the rest unrouted", async () => {
  await installed([...PLUGIN_RENDERER_ACTIONS]);
  const implemented = ["plugin.call", "ui.toast", "composer.replaceDraft"];
  for (const action of implemented) {
    await assert.rejects(
      () => dispatchFromPlugin("acme.one", action, undefined),
      (error) => error.code === "PLUGIN_ACTION_INVALID_PAYLOAD" && error.action === action,
      `${action} must be handled, not unrouted`,
    );
  }
  // Implemented but refused for missing session — still a coded host answer.
  await assert.rejects(
    () => dispatchFromPlugin("acme.one", "composer.readDraft", {}),
    (error) => error.code === "NO_SESSION" && error.action === "composer.readDraft",
  );
  for (const action of PLUGIN_RENDERER_ACTIONS.filter(
    (name) => ![...implemented, "composer.readDraft"].includes(name),
  )) {
    await assert.rejects(
      () => dispatchFromPlugin("acme.one", action, {}),
      (error) => error.code === "PLUGIN_ACTION_UNROUTED" && error.action === action,
      `${action} must be an explicit unrouted refusal`,
    );
  }
});

test("plugin.call forwards to the plugin's own entry and answers with its value", async () => {
  await installed(["plugin.call"]);
  bridgeReply = () => ({ ok: true, data: { echo: "pong" } });

  assert.deepEqual(
    await dispatchFromPlugin("acme.one", "plugin.call", {
      method: "slots.echo",
      args: { text: "hi" },
    }),
    { echo: "pong" },
  );
  assert.equal(bridgeCalls.length, 1);
  assert.equal(bridgeCalls[0].channel, IPC.invoke.pluginRendererCall);
  // The plugin id is the one the component was rendered for, chosen by the
  // host — never the payload's.
  assert.deepEqual(bridgeCalls[0].args[0], {
    pluginId: "acme.one",
    method: "slots.echo",
    args: { text: "hi" },
  });
  assert.deepEqual(
    pluginSlots.listDiagnostics().filter((entry) => entry.code.startsWith("PLUGIN_ACTION_")),
    [],
  );
});

test("a refused forwarded call is reported exactly once, by the plugin.call handler", async () => {
  await installed(["plugin.call"]);
  bridgeReply = () => ({
    ok: false,
    error: { code: "PLUGIN_CALL_UNKNOWN_PLUGIN", message: "no such plugin" },
  });

  await assert.rejects(
    () => dispatchFromPlugin("acme.one", "plugin.call", { method: "slots.echo" }),
    (error) => error.code === "PLUGIN_CALL_UNKNOWN_PLUGIN",
  );
  const refusals = pluginSlots
    .listDiagnostics()
    .filter((entry) => entry.code === "PLUGIN_CALL_UNKNOWN_PLUGIN");
  assert.equal(refusals.length, 1, "the relay must not add a second diagnostic");
  assert.equal(refusals[0].pluginId, "acme.one");
  assert.match(refusals[0].detail, /slots\.echo/);
});

test("ui.toast reaches the store with the payload's message and variant", async () => {
  await installed(["ui.toast"]);

  assert.equal(
    await dispatchFromPlugin("acme.one", "ui.toast", {
      message: "from a plugin",
      variant: "success",
    }),
    undefined,
  );
  assert.deepEqual(
    useAppStore.getState().toasts.map((toast) => [toast.message, toast.variant]),
    [["from a plugin", "success"]],
  );
  // An omitted variant is the store's own default, not one this host chooses.
  await dispatchFromPlugin("acme.one", "ui.toast", { message: "plain" });
  assert.deepEqual(
    useAppStore.getState().toasts.map((toast) => [toast.message, toast.variant]),
    [
      ["from a plugin", "success"],
      ["plain", "info"],
    ],
  );
});

test("a bad payload for each implemented action is refused with PLUGIN_ACTION_INVALID_PAYLOAD", async () => {
  await installed(["plugin.call", "ui.toast", "composer.replaceDraft"]);
  const cases = [
    ["plugin.call", undefined],
    ["plugin.call", { method: "   " }],
    ["plugin.call", { method: 7 }],
    ["ui.toast", {}],
    ["ui.toast", { message: "  " }],
    ["ui.toast", { message: "ok", variant: "warning" }],
    ["composer.replaceDraft", {}],
    ["composer.replaceDraft", { text: 7 }],
  ];
  for (const [action, payload] of cases) {
    await assert.rejects(
      () => dispatchFromPlugin("acme.one", action, payload),
      (error) => error.code === "PLUGIN_ACTION_INVALID_PAYLOAD" && error.action === action,
      `${action} with ${JSON.stringify(payload)} must be refused`,
    );
  }
  // Refused before it could cross IPC, or touch the store.
  assert.deepEqual(bridgeCalls, []);
  assert.deepEqual(useAppStore.getState().toasts, []);
  assert.equal(
    pluginSlots.listDiagnostics().filter(
      (entry) => entry.code === "PLUGIN_ACTION_INVALID_PAYLOAD",
    ).length,
    cases.length,
  );
});

test("composer.replaceDraft resolves once a mounted composer consumes the write", async () => {
  await installed(["composer.replaceDraft"]);
  useAppStore.setState({ activeSessionId: "session-1" });

  // Exactly what `useComposerDraft`'s prefill effect does: take the prefill for
  // the active session and clear it.
  const consumed = [];
  const unsubscribe = useAppStore.subscribe(() => {
    const prefill = useAppStore.getState().composerPrefill;
    if (prefill && prefill.sessionId === "session-1") {
      consumed.push(prefill);
      useAppStore.getState().clearComposerPrefill();
    }
  });
  const pending = dispatchFromPlugin("acme.one", "composer.replaceDraft", {
    text: "written by a plugin",
  });
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.generation, 1);
  assert.equal(result.previous.text, "");
  unsubscribe();

  assert.deepEqual(
    consumed.map((prefill) => [prefill.sessionId, prefill.text, prefill.fileReferences]),
    [["session-1", "written by a plugin", []]],
  );
  assert.equal(useAppStore.getState().composerPrefill, null);
  assert.deepEqual(
    pluginSlots.listDiagnostics().filter((entry) => entry.code.startsWith("PLUGIN_ACTION_")),
    [],
  );
});

test("composer.replaceDraft rejects and clears the write when no composer consumes it", async () => {
  await installed(["composer.replaceDraft"]);
  useAppStore.setState({
    activeSessionId: "session-unconsumed",
    composerPrefill: null,
  });

  const startedAt = Date.now();
  await assert.rejects(
    () =>
      dispatchFromPlugin("acme.one", "composer.replaceDraft", {
        text: "dropped",
        // Force a session that no composer will consume.
        sessionId: undefined,
      }),
    (error) =>
      error.code === "PLUGIN_ACTION_DRAFT_UNCONSUMED" ||
      error.code === "PLUGIN_ACTION_DRAFT_UNCONSUMED",
  );
  assert.ok(
    Date.now() - startedAt >= DRAFT_PREFILL_DEADLINE_MS - 50,
    "an unconsumed write must wait for the deadline before refusing",
  );
  assert.equal(
    useAppStore.getState().composerPrefill,
    null,
    "the unconsumed write must not linger in the store",
  );
  const [refusal] = pluginSlots
    .listDiagnostics()
    .filter((entry) => entry.code === "PLUGIN_ACTION_DRAFT_UNCONSUMED");
  assert.equal(refusal.pluginId, "acme.one");
  assert.match(refusal.detail, new RegExp(`${DRAFT_PREFILL_DEADLINE_MS} ms`));
});

test("composer.replaceDraft with no active session refuses immediately", async () => {
  await installed(["composer.replaceDraft"]);
  const startedAt = Date.now();
  await assert.rejects(
    () => dispatchFromPlugin("acme.one", "composer.replaceDraft", { text: "nowhere" }),
    (error) =>
      error.code === "PLUGIN_ACTION_DRAFT_UNCONSUMED" && /no active session/.test(error.detail),
  );
  assert.ok(Date.now() - startedAt < DRAFT_PREFILL_DEADLINE_MS);
  assert.equal(useAppStore.getState().composerPrefill, null);
});
