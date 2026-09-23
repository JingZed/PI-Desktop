import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = (relative) => join(here, "..", "..", "..", relative);

const demoDir = root("examples/plugins/ui-slots-demo");
const manifest = JSON.parse(readFileSync(join(demoDir, "manifest.json"), "utf8"));
const mainSource = readFileSync(join(demoDir, "main.js"), "utf8");
const rendererSource = readFileSync(join(demoDir, "renderer/index.mjs"), "utf8");
const sdkSource = readFileSync(
  root("packages/plugin-sdk/src/renderer.ts"),
  "utf8",
);

test("the demo manifest declares the full renderer action vocabulary", () => {
  assert.equal(manifest.id, "demo.ui-slots");
  // The three dispatched actions this milestone shipped.
  assert.deepEqual(
    [...manifest.rendererActions].sort(),
    ["composer.acceptTriggerItem", "composer.insertText", "plugin.call"],
  );
  assert.ok(manifest.permissions.includes("renderer.extension"));
  assert.ok(manifest.permissions.includes("agent.tool.register"));
  // toolCard ownership premise: the claimed tool is declared here.
  assert.equal(
    manifest.contributes?.agentTools?.[0]?.name,
    "slot_demo_stats",
  );
  // Entry files exist.
  assert.ok(manifest.main.endsWith("main.js"));
  assert.ok(manifest.renderer.endsWith("renderer/index.mjs"));
});

test("the demo renderer stays valid ESM with every registration", () => {
  execFileSync(process.execPath, ["--check", join(demoDir, "renderer/index.mjs")]);
  assert.match(rendererSource, /import \{ createElement as h, useState \} from "react"/);
});

test("the page CSP lets the import map's blob shims load", () => {
  // The React import map serves shims from blob: URLs; a built page whose
  // script-src lacks blob: blocks every plugin module at load (seen live as
  // PLUGIN_SLOT_LOAD_FAILED after a CSP security error).
  const html = readFileSync(root("apps/desktop/index.html"), "utf8");
  assert.match(html, /script-src[^;]*\bblob:/);
});

test("the headless entry answers the declared renderer method", async () => {
  const entry = createRequire(import.meta.url)(join(demoDir, "main.js"));
  assert.equal(typeof entry.onLoad, "function");
  assert.equal(typeof entry.onUnload, "function");
  assert.equal(typeof entry.onRendererCall, "function");

  const answer = await entry.onRendererCall("stats.summary", { scale: 2 });
  assert.equal(answer.total, 2400);
  // Relay payloads must stay serializable JSON.
  JSON.stringify(answer);

  await assert.rejects(
    () => entry.onRendererCall("unknown.method", {}),
    /unknown renderer method/,
  );
});

test("the renderer entry registers every slot with valid keys", () => {
  // Syntax gate: the host imports this file as ESM through the import map.
  execFileSync(process.execPath, ["--check", join(demoDir, "renderer/index.mjs")]);

  const registrations = [...rendererSource.matchAll(/pi\.slots\.register\(\s*"([^"]+)"/g)].map(
    (match) => match[1],
  );
  // 7 slots + the self-dialog sample riding in entryExtra.
  assert.deepEqual(
    registrations,
    [
      "entryExtra",
      "userAction",
      "assistantAction",
      "toolCard",
      "blockRenderer",
      "composerControl",
      "composerTrigger",
      "composerToken",
      "entryExtra",
    ],
  );

  // toolCard claim matches the manifest-declared tool.
  assert.match(rendererSource, /pi\.slots\.register\("toolCard", StatsCard, \{ toolName: TOOL_NAME \}\)/);
  assert.match(mainSource, /name: "slot_demo_stats"/);

  // blockRenderer key keeps the `<pluginId>:` ownership prefix.
  assert.match(
    rendererSource,
    /pi\.slots\.register\("blockRenderer", ChartBlock, \{ language: CHART_LANGUAGE \}\)/,
  );
  assert.match(rendererSource, /CHART_LANGUAGE = "demo\.ui-slots:chart"/);

  // composerTrigger uses an SDK-vocabulary symbol.
  assert.match(
    rendererSource,
    /pi\.slots\.register\("composerTrigger", ComposerTrigger, \{ trigger: "#" \}\)/,
  );
});

test("every renderer dispatch stays inside the manifest whitelist", () => {
  const sdkActions = [...sdkSource.matchAll(/"(plugin\.call|composer\.insertText|composer\.acceptTriggerItem)"/g)].map(
    (match) => match[1],
  );
  const dispatched = [
    ...rendererSource.matchAll(/dispatch\(\s*"([^"]+)"/g),
  ].map((match) => match[1]);

  assert.ok(dispatched.length >= 3, "demo should exercise the vocabulary");
  for (const action of new Set(dispatched)) {
    assert.ok(
      manifest.rendererActions.includes(action),
      `${action} is dispatched but not declared in manifest.rendererActions`,
    );
    assert.ok(
      sdkActions.includes(action),
      `${action} is not in the SDK PluginRendererActionName vocabulary`,
    );
  }
  for (const required of [
    "plugin.call",
    "composer.insertText",
    "composer.acceptTriggerItem",
  ]) {
    assert.ok(
      dispatched.includes(required),
      `demo never exercises ${required}`,
    );
  }
});
