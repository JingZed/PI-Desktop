import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";
import test from "node:test";
register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);

const { blockRendererOverflow, blockRendererCandidate, BLOCK_RENDERER_MAX_HEIGHT_PX } =
  await import("../src/lib/block-renderer.ts");
const { SlotRegistry } = await import("../src/plugins/renderer-slots/registry.ts");

test("only prefixed languages can reach the slot registry", () => {
  assert.equal(blockRendererCandidate("json"), undefined);
  assert.equal(blockRendererCandidate("ts"), undefined);
  assert.equal(blockRendererCandidate("mermaid"), undefined);
  assert.equal(blockRendererCandidate("demo:chart"), "demo:chart");
  assert.equal(blockRendererCandidate(" demo:csv "), "demo:csv");
});

test("the host clamp is 4000px and overflow means render failure", () => {
  assert.equal(BLOCK_RENDERER_MAX_HEIGHT_PX, 4000);
  assert.equal(blockRendererOverflow(3999), false);
  assert.equal(blockRendererOverflow(4000), false);
  assert.equal(blockRendererOverflow(4001), true);
});

test("blockRenderer keys stay plugin-prefixed and additive per language", () => {
  const registry = new SlotRegistry();
  const component = () => null;
  registry.register("demo.chart", "blockRenderer", component, { language: "demo.chart:chart" });
  registry.register("demo.chart", "blockRenderer", component, { language: "demo.chart:csv" });
  assert.equal(registry.entryForKey("blockRenderer", "demo.chart:chart")?.pluginId, "demo.chart");
  assert.equal(registry.entryForKey("blockRenderer", "demo.chart:csv")?.pluginId, "demo.chart");
  assert.equal(registry.entryForKey("blockRenderer", "json"), undefined);
  // A second claim of the same language — even by the same plugin — is refused.
  assert.throws(
    () =>
      registry.register("demo.chart", "blockRenderer", component, {
        language: "demo.chart:chart",
      }),
    (error) => error.code === "PLUGIN_SLOT_DUPLICATE",
  );
  // A different plugin cannot even express that key: the language is
  // namespaced by the registering plugin's own id, so cross-plugin claims
  // are structurally impossible (INVALID_KEY, not DUPLICATE).
  assert.throws(
    () =>
      registry.register("demo.other", "blockRenderer", component, {
        language: "demo.chart:chart",
      }),
    (error) => error.code === "PLUGIN_SLOT_INVALID_KEY",
  );
});
test("unclosed fences fall back to the host block; closed fences hand over", () => {
  const source = readFileSync(src("components/Markdown.tsx"), "utf8");
  const preAt = source.indexOf("function PreBlock(");
  const hookAt = source.indexOf('useSlotEntryForKey(\n    "blockRenderer"');
  const guardAt = source.indexOf("if (!info) return <pre");
  assert.ok(preAt > 0 && hookAt > preAt && guardAt > hookAt,
    "the slot lookup runs before every early return");
  assert.match(
    source,
    /closedFence \? blockRendererCandidate\(info\?\.lang \?\? ""\) : undefined/,
    "an unclosed fence never resolves a registration",
  );
  assert.match(source, /<PluginBlockRenderer/);
  assert.match(
    source,
    /fallback=\{\s*<CodeBlock code=\{info\.code\} lang=\{info\.lang\}/,
    "failure and no-claim both land on the host code block",
  );
});

test("claimed blocks mount props-once with the 4000px clamp and a fallback", () => {
  const source = readFileSync(src("components/PluginBlockRenderer.tsx"), "utf8");
  assert.match(source, /useRef<PluginBlockRendererSlotProps>\(\{ language, source \}\)/,
    "props-once: the first projection is the only one");
  assert.match(source, /BLOCK_RENDERER_MAX_HEIGHT_PX/);
  assert.match(source, /blockRendererOverflow\(/);
  assert.match(
    source,
    /<SlotBoundary entry=\{entry\} slot="blockRenderer" fallback=\{fallback\}>/,
    "a throwing renderer hands back the host block",
  );
  assert.equal(source.includes("dispatchFor("), false,
    "blockRenderer has no dispatch: no further data exchange after handover");
});

test("the boundary fallback keeps the host region visible on failure", () => {
  const source = readFileSync(src("plugins/renderer-slots/use-slots.tsx"), "utf8");
  assert.match(source, /fallback\?: ReactNode/);
  assert.match(
    source,
    /this\.state\.failed \? \(this\.props\.fallback \?\? null\) : this\.props\.children/,
  );
});
