import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);

const { toolCardOwnershipError } = await import("@pi-desktop/plugin-sdk");
const {
  shouldEmitToolCard,
  toolCardPropsFor,
  toolCardStatusOf,
  TOOL_CARD_RUNNING_INTERVAL_MS,
} = await import("../src/features/chat/transcript/tool-card-props.ts");

const message = (extra = {}) => ({
  id: "m1",
  role: "tool",
  content: "",
  createdAt: "2026-09-17T00:00:00.000Z",
  toolName: "query_db",
  toolCallId: "call-1",
  toolStatus: "success",
  ...extra,
});

test("the no-claim gate refuses cards for tools the plugin does not own", () => {
  assert.match(
    toolCardOwnershipError("query_db", undefined) ?? "",
    /contributes\.agentTools/,
  );
  assert.match(
    toolCardOwnershipError("query_db", []) ?? "",
    /contributes\.agentTools/,
  );
  assert.match(
    toolCardOwnershipError("other_tool", ["query_db"]) ?? "",
    /not in the plugin's own/,
  );
  assert.equal(toolCardOwnershipError("query_db", ["query_db", "other"]), null);
});

test("card props carry the finalized fields, failure as data", () => {
  const dispatch = async () => ({});
  const failing = message({
    toolStatus: "error",
    isError: true,
    error: { code: "TOOL_FAILED", message: "boom" },
  });
  const props = toolCardPropsFor(failing, "sess-1", dispatch);
  assert.equal(props.toolName, "query_db");
  assert.equal(props.toolCallId, "call-1");
  assert.equal(props.toolStatus, "error");
  assert.deepEqual(props.toolError, { code: "TOOL_FAILED", message: "boom" });
  assert.equal(props.messageId, "m1");
  assert.equal(props.sessionId, "sess-1");
  assert.equal(props.dispatch, dispatch);
  const ok = toolCardPropsFor(message({ toolDurationMs: 42 }), "s", dispatch);
  assert.equal(ok.durationMs, 42);
  assert.equal(ok.toolError, undefined);
});

test("denied rows never reach a plugin card", () => {
  assert.equal(toolCardStatusOf(message({ toolStatus: "denied" })), "success");
  assert.equal(toolCardStatusOf(message({ toolStatus: "running" })), "running");
});

test("running pushes merge on the 500ms beat; transitions are immediate", () => {
  assert.equal(TOOL_CARD_RUNNING_INTERVAL_MS, 500);
  // Same status inside the beat: no push.
  assert.equal(shouldEmitToolCard(1_000, "running", "running", 1_200), false);
  // Same status after the beat: push.
  assert.equal(shouldEmitToolCard(1_000, "running", "running", 1_500), true);
  // Status transition: immediate regardless of the beat.
  assert.equal(shouldEmitToolCard(1_000, "running", "success", 1_100), true);
  // A finished call always pushes.
  assert.equal(shouldEmitToolCard(1_000, "success", "success", 1_050), true);
});

test("ToolRow swaps in the plugin card before rendering the host card", () => {
  const source = readFileSync(src("features/chat/transcript/ToolRow.tsx"), "utf8");
  assert.match(
    source,
    /useSlotEntryForKey\(\s*"toolCard",\s*variant === "default" && status !== "denied" \? message\.toolName : undefined,?\s*\)/,
  );
  assert.match(source, /if \(pluginCardEntry\) \{/);
  assert.match(
    source,
    /return <PluginToolCard entry=\{pluginCardEntry\} message=\{message\} \/>;/,
  );
  // Topology nodes keep the host card: the lookup is skipped for them.
  const lookupAt = source.indexOf('useSlotEntryForKey(\n    "toolCard"');
  assert.ok(lookupAt > source.indexOf("export const ToolRow"));
  assert.ok(lookupAt < source.indexOf("export const SubagentRunRows"));
});

test("the card renders inside its own boundary with the 500ms cadence", () => {
  const source = readFileSync(src("features/chat/transcript/PluginToolCard.tsx"), "utf8");
  assert.match(source, /<SlotBoundary entry=\{entry\} slot="toolCard">/);
  assert.match(source, /toolCardPropsFor\(/);
  assert.match(source, /dispatchFor\(entry\.pluginId\)/);
  assert.match(source, /shouldEmitToolCard\(/);
  assert.match(source, /TOOL_CARD_RUNNING_INTERVAL_MS/);
});

test("the host passes each plugin's own tool list to the loader context", () => {
  const host = readFileSync(src("plugins/renderer-host/PluginRendererHost.tsx"), "utf8");
  assert.match(host, /tools: summary\.tools/);
  const loader = readFileSync(src("plugins/renderer-host/loader.ts"), "utf8");
  assert.match(loader, /toolCardOwnershipError\(/);
  assert.match(loader, /PLUGIN_SLOT_INVALID_KEY/);
  const context = readFileSync(src("plugins/renderer-host/dispatch.ts"), "utf8");
  assert.match(context, /tools\?: readonly string\[\]/);
});
