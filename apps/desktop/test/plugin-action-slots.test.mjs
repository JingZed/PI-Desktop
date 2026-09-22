import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);

const { SlotRegistry } = await import(
  "../src/plugins/renderer-slots/registry.ts"
);
const {
  actionSlotPropsFor,
  actionSlotMessage,
  splitActionSide,
  ACTION_SLOT_VISIBLE_LIMIT,
} = await import("../src/features/chat/transcript/action-slot-props.ts");
const { en, zhCN, zhTW, de, es, fr, ko, tr } = await import("@pi-desktop/i18n");

const message = (role, extra = {}) => ({
  id: "m1",
  role,
  content: "hello",
  createdAt: "2026-09-17T00:00:00.000Z",
  ...extra,
});

test("action slot props projection carries message, ids, position, dispatch", () => {
  const dispatch = async () => ({});
  const props = actionSlotPropsFor(message("user"), "left", "sess-1", dispatch);
  assert.deepEqual(props.message, {
    id: "m1",
    role: "user",
    content: "hello",
    createdAt: "2026-09-17T00:00:00.000Z",
  });
  assert.equal(props.messageId, "m1");
  assert.equal(props.sessionId, "sess-1");
  assert.equal(props.position, "left");
  assert.equal(props.dispatch, dispatch);
});

test("the action projection keeps the row's real role", () => {
  assert.equal(actionSlotMessage(message("assistant")).role, "assistant");
  assert.equal(actionSlotMessage(message("user")).role, "user");
});

test("each side shows three items and folds the rest into the host menu", () => {
  assert.equal(ACTION_SLOT_VISIBLE_LIMIT, 3);
  const items = ["a", "b", "c", "d", "e"];
  const split = splitActionSide(items);
  assert.deepEqual(split.visible, ["a", "b", "c"]);
  assert.deepEqual(split.overflow, ["d", "e"]);
  assert.deepEqual(splitActionSide(["a"]), { visible: ["a"], overflow: [] });
});

test("positions subsets filter per side and default to both sides", () => {
  const registry = new SlotRegistry();
  const component = () => null;
  registry.register("plugin-a", "userAction", component, undefined);
  registry.register("plugin-b", "userAction", component, { positions: ["left"] });
  registry.register("plugin-c", "assistantAction", component, {
    positions: ["right"],
  });
  assert.equal(registry.entriesForSide("userAction", "left").length, 2);
  assert.equal(registry.entriesForSide("userAction", "right").length, 1);
  assert.equal(registry.entriesForSide("assistantAction", "left").length, 0);
  assert.equal(registry.entriesForSide("assistantAction", "right").length, 1);
  // Uninstall recomputes the sides immediately.
  registry.unregisterPlugin("plugin-b");
  assert.equal(registry.entriesForSide("userAction", "left").length, 1);
});

test("MessageRow wraps its host keys in the userAction bar slots", () => {
  const source = readFileSync(src("features/chat/transcript/MessageRow.tsx"), "utf8");
  const slotsAt = source.indexOf("<ActionBarSlots slot=\"userAction\"");
  const barAt = source.indexOf('<div className="message-actions">');
  assert.ok(slotsAt > 0, "userAction bar slots mounted");
  // The slot wrapper sits inside the action-bar div, around the host keys.
  assert.ok(slotsAt > barAt);
  assert.match(
    source,
    /isUser \? userActionLeftEntries : \[\]/,
    "system rows keep a plugin-free bar",
  );
  assert.match(source, /<\/ActionBarSlots>/);
});

test("AssistantTurn wraps its host keys in the assistantAction bar slots", () => {
  const source = readFileSync(
    src("features/chat/transcript/AssistantTurn.tsx"),
    "utf8",
  );
  const slotsAt = source.indexOf('<ActionBarSlots slot="assistantAction"');
  const copyAt = source.indexOf("<CopyButton text={content}");
  const closeAt = source.indexOf("</ActionBarSlots>");
  assert.ok(slotsAt > 0 && slotsAt < copyAt && closeAt > copyAt,
    "host keys render inside the slot wrapper");
});

test("ActionBarSlots keeps the finalized 【left】【host】【right】 shape", () => {
  const source = readFileSync(
    src("features/chat/transcript/ActionBarSlots.tsx"),
    "utf8",
  );
  // Host keys (children) render between the left and right visible items.
  const leftVisible = source.indexOf("leftSplit.visible.map");
  const children = source.lastIndexOf("{children}");
  const rightVisible = source.indexOf("rightSplit.visible.map");
  assert.ok(leftVisible > 0 && leftVisible < children && children < rightVisible);
  // Left ⋯ before the host keys, right ⋯ last.
  const leftOverflow = source.indexOf("leftSplit.overflow.length");
  const rightOverflow = source.indexOf("rightSplit.overflow.length");
  assert.ok(leftOverflow > 0 && leftOverflow < children);
  assert.ok(rightOverflow > children);
  // Plugin-free bars keep their exact DOM.
  assert.match(source, /left\.length === 0 && right\.length === 0\) return <>\{children\}<\/>/);
  // Each item gets its own plugin's relay and boundary.
  assert.match(source, /dispatchFor\(entry\.pluginId\)/);
  assert.match(source, /<SlotBoundary entry=\{entry\} slot=\{slot\}>/);
});

test("every shipped locale labels the host ⋯ overflow menu", () => {
  const catalogs = { en, zhCN, zhTW, de, es, fr, ko, tr };
  for (const [name, catalog] of Object.entries(catalogs)) {
    assert.ok(
      typeof catalog.chat?.actionSlotMore === "string" &&
        catalog.chat.actionSlotMore.length > 0,
      `${name} is missing chat.actionSlotMore`,
    );
  }
});

test("slot shell styles carry the ⋯ overflow menu chrome", () => {
  const css = readFileSync(src("plugins/renderer-slots/slot-shell.css"), "utf8");
  assert.match(css, /\.pi-action-overflow-panel/);
  assert.match(css, /data-side="right"/);
});
