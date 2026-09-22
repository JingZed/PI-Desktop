import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);

const {
  SlotRegistry,
  SlotError,
} = await import("../src/plugins/renderer-slots/registry.ts");
const {
  entryExtraPropsFor,
  entryExtraMessage,
  ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT,
  ENTRY_EXTRA_EXPANDED_MAX_HEIGHT,
} = await import("../src/features/chat/transcript/entry-extra-props.ts");
const {
  en,
  zhCN,
  zhTW,
  de,
  es,
  fr,
  ko,
  tr,
} = await import("@pi-desktop/i18n");

const message = (extra = {}) => ({
  id: "m1",
  role: "assistant",
  content: "answer",
  createdAt: "2026-09-17T00:00:00.000Z",
  ...extra,
});

test("entryExtra props projection carries the fixed contract fields", () => {
  const dispatch = async () => ({});
  const props = entryExtraPropsFor(message(), "sess-1", dispatch);
  assert.deepEqual(props.message, {
    id: "m1",
    role: "assistant",
    content: "answer",
    createdAt: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(props.messageId, "m1");
  assert.equal(props.sessionId, "sess-1");
  assert.equal(props.dispatch, dispatch);
  // No position field: only the action bars are two-sided.
  assert.equal("position" in props, false);
});

test("entryExtra projection pins the role to assistant", () => {
  const projected = entryExtraMessage(message({ role: "tool" }));
  assert.equal(projected.role, "assistant");
});

test("entryExtra clamp heights match the finalized contract", () => {
  assert.equal(ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT, 320);
  assert.equal(ENTRY_EXTRA_EXPANDED_MAX_HEIGHT, 600);
});

test("entryExtra is additive: registrations stack in order and never clash", () => {
  const registry = new SlotRegistry();
  const component = () => null;
  registry.register("plugin-a", "entryExtra", component, undefined);
  registry.register("plugin-b", "entryExtra", component, undefined);
  const entries = registry.entriesFor("entryExtra");
  assert.deepEqual(
    entries.map((entry) => entry.pluginId),
    ["plugin-a", "plugin-b"],
  );
  registry.unregisterPlugin("plugin-a");
  assert.deepEqual(
    registry.entriesFor("entryExtra").map((entry) => entry.pluginId),
    ["plugin-b"],
  );
});

test("a throwing onLoad leaving registrations behind still unregisters cleanly", () => {
  // The unload path (loader.unloadRendererModule) owns this guarantee; the
  // registry half of it is that unregisterPlugin drops every entry in one call.
  const registry = new SlotRegistry();
  const component = () => null;
  registry.register("plugin-a", "entryExtra", component, undefined);
  registry.register("plugin-a", "assistantAction", component, undefined);
  registry.unregisterPlugin("plugin-a");
  assert.equal(registry.entriesFor("entryExtra").length, 0);
  assert.equal(registry.entriesFor("assistantAction").length, 0);
});

test("entryExtra registrations still validate slot name and component", () => {
  const registry = new SlotRegistry();
  assert.throws(
    () => registry.register("plugin-a", "notASlot", () => null, undefined),
    (error) =>
      error instanceof SlotError && error.code === "PLUGIN_SLOT_UNKNOWN",
  );
  assert.throws(
    () => registry.register("plugin-a", "entryExtra", "not-a-function", undefined),
    (error) =>
      error instanceof SlotError &&
      error.code === "PLUGIN_SLOT_INVALID_COMPONENT",
  );
});

test("the assistant turn mounts the stack after the action bar, gated on completion", () => {
  const source = readFileSync(
    src("features/chat/transcript/AssistantTurn.tsx"),
    "utf8",
  );
  const actionsAt = source.indexOf('<div className="message-actions">');
  const stackAt = source.lastIndexOf("{complete && actionMessage ? (");
  assert.ok(actionsAt > 0, "host action bar must stay");
  assert.ok(stackAt > actionsAt, "entryExtra mounts below the action bar");
  assert.match(
    source,
    /complete && actionMessage \? \(\s*\n\s*<EntryExtraStack message=\{actionMessage\} \/>/,
    "blocks ride the same completion gate as the action bar",
  );
  assert.ok(
    !source.includes('useSlotEntries("entryExtra")'),
    "AssistantTurn stays slot-free; EntryExtraStack owns the lookup",
  );
});

test("EntryExtraStack renders registry entries inside per-plugin boundaries", () => {
  const source = readFileSync(
    src("features/chat/transcript/EntryExtraStack.tsx"),
    "utf8",
  );
  assert.match(source, /useSlotEntries\("entryExtra"\)/);
  assert.match(source, /useSlotSessionId\(\)/);
  assert.match(source, /<SlotBoundary entry=\{entry\} slot="entryExtra">/);
  assert.match(source, /entryExtraPropsFor\(/);
  assert.match(
    source,
    /dispatchFor\(entry\.pluginId\)/,
    "each block gets its own plugin's relay",
  );
  assert.match(
    source,
    /entries\.length === 0\) return null/,
    "no blocks means no DOM",
  );
  // The host owns the clamp: collapsed 320, expanded 600, toggle only when
  // content actually overflows or the block is expanded.
  assert.match(source, /ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT/);
  assert.match(source, /ENTRY_EXTRA_EXPANDED_MAX_HEIGHT/);
  assert.match(source, /data-clipped/);
  assert.match(source, /entryExtraExpand/);
  assert.match(source, /entryExtraCollapse/);
});

test("the transcript provides session identity to slot props", () => {
  const source = readFileSync(
    src("features/chat/transcript/ChatTranscript.tsx"),
    "utf8",
  );
  assert.match(
    source,
    /<SlotSessionProvider sessionId=\{sessionId \?\? ""\}>/,
  );
  // Wraps the scroller so every message row (history and tail) is covered.
  const providerAt = source.indexOf("<SlotSessionProvider");
  const scrollerAt = source.indexOf('className="thread-scroll"');
  const closeAt = source.indexOf("</SlotSessionProvider>");
  assert.ok(providerAt > 0 && providerAt < scrollerAt && closeAt > scrollerAt);
});

test("slot shell styles carry the clamp viewport, edge fade, and toggle", () => {
  const css = readFileSync(
    src("plugins/renderer-slots/slot-shell.css"),
    "utf8",
  );
  assert.match(css, /\.pi-entry-extra-stack/);
  assert.match(css, /\.pi-entry-extra-viewport/);
  assert.match(
    css,
    /data-clipped="true"[^\{]*\{[^}]*mask-image/,
    "collapsed overflow fades at the 8% edge",
  );
  assert.match(css, /\.pi-entry-extra-toggle/);
});

test("every shipped locale has the host expand/collapse labels", () => {
  const catalogs = { en, zhCN, zhTW, de, es, fr, ko, tr };
  for (const [name, catalog] of Object.entries(catalogs)) {
    const chat = catalog.chat ?? {};
    assert.ok(
      typeof chat.entryExtraExpand === "string" &&
        chat.entryExtraExpand.length > 0,
      `${name} is missing chat.entryExtraExpand`,
    );
    assert.ok(
      typeof chat.entryExtraCollapse === "string" &&
        chat.entryExtraCollapse.length > 0,
      `${name} is missing chat.entryExtraCollapse`,
    );
  }
});
