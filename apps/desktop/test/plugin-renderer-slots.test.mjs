/**
 * Unit tests for the trusted renderer host's host-side pieces (ADR 0287).
 *
 * The renderer host is the first plugin surface that runs inside the app window,
 * so the parts that decide what a plugin may own are tested directly rather than
 * only through the app: the slot registry's bookkeeping, and the stylesheet
 * guard that refuses a sheet reaching for the host's own roots.
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";
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

const { pluginSlots, resetPluginSlots } = await import(
  "../src/plugins/renderer-slots/registry.ts"
);
const { forbiddenSelector, injectPluginStyle, removePluginStyles } = await import(
  "../src/plugins/renderer-slots/style-injection.ts"
);
const { rendererCandidates } = await import("../src/plugins/renderer-slots/candidates.ts");

function component() {
  return null;
}

test("the slot registry keeps one list per (plugin, slot) in registration order", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entry", component);
  pluginSlots.register("acme.two", "entry", component);
  pluginSlots.register("acme.one", "toolCard", component);

  const entries = pluginSlots.list("entry");
  assert.deepEqual(
    entries.map((registration) => registration.pluginId),
    ["acme.one", "acme.two"],
  );
  assert.equal(pluginSlots.list("toolCard").length, 1);
  assert.equal(pluginSlots.list("modal").length, 0);
});

test("two registrations from one plugin both survive, and none is a conflict", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entry", component);
  pluginSlots.register("acme.one", "entry", component);
  assert.equal(pluginSlots.list("entry").length, 2);
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
  const first = pluginSlots.register("acme.one", "entry", component);
  pluginSlots.register("acme.one", "entry", component);
  first.remove();
  assert.equal(pluginSlots.list("entry").length, 1);
});

test("unloading a plugin releases every position it held (D10)", () => {
  resetPluginSlots();
  pluginSlots.register("acme.one", "entry", component);
  pluginSlots.register("acme.one", "overlay", component);
  pluginSlots.register("acme.two", "entry", component);
  pluginSlots.unregisterPlugin("acme.one");
  assert.equal(pluginSlots.list("entry").length, 1);
  assert.equal(pluginSlots.list("entry")[0].pluginId, "acme.two");
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
    ":root { --acme: 1px }",
    "* { box-sizing: border-box }",
    "@media (min-width: 600px) { html { font-size: 20px } }",
    ".acme { color: #fff }\nbody { background: #000 }",
  ]) {
    assert.notEqual(forbiddenSelector(css), null, `expected refusal: ${css}`);
  }
});

test("the style guard leaves a plugin's own selectors alone", () => {
  for (const css of [
    ".acme-card { color: #fff }",
    ".html-widget { display: block }",
    "/* html { color: red } */ .acme { color: blue }",
    "[data-pi-plugin] .acme { gap: 4px }",
    ".acme-body { padding: 4px }",
  ]) {
    assert.equal(forbiddenSelector(css), null, `expected to pass: ${css}`);
  }
});

test("an injected sheet is namespaced, and removal is the host's job", () => {
  resetPluginSlots();
  document.head.children.length = 0;
  const handle = injectPluginStyle("acme.one", ".acme { color: red }");
  assert.equal(document.head.children.length, 1);
  const [element] = document.head.children;
  assert.equal(element.getAttribute("data-pi-plugin-style"), "acme.one");
  assert.equal(element.textContent, ".acme { color: red }");

  injectPluginStyle("acme.one", ".acme-b { color: blue }");
  injectPluginStyle("acme.two", ".other { color: green }");
  removePluginStyles("acme.one");
  assert.equal(document.head.children.length, 1);
  assert.equal(document.head.children[0].getAttribute("data-pi-plugin-style"), "acme.two");

  handle.remove();
  assert.equal(handle.remove instanceof Function, true);
});

test("a refused sheet throws a coded error instead of injecting part of it", () => {
  document.head.children.length = 0;
  assert.throws(
    () => injectPluginStyle("acme.one", "body { display: none }"),
    (error) => error.code === "PLUGIN_STYLE_REFUSED",
  );
  assert.equal(document.head.children.length, 0);
});

test("only plugins the host marked with the renderer capability are candidates", () => {
  const candidates = rendererCandidates([
    { id: "acme.trusted", version: "1.0.0", capabilities: ["panel", "renderer"] },
    { id: "acme.sandboxed", version: "1.0.0", capabilities: ["panel"] },
    { id: "acme.plain", version: "1.0.0" },
  ]);
  assert.deepEqual(candidates, [
    { id: "acme.trusted", version: "1.0.0", declared: true },
  ]);
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
