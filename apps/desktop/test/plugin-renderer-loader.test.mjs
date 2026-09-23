import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);

test("unload races the async load and late registrations are dropped", () => {
  // Contract (卸载摘注册): when a plugin is disabled/uninstalled while its
  // renderer module is still loading, the load must not leave orphan
  // registrations, injected styles, or a dispatch binding behind.
  const loader = readFileSync(src("plugins/renderer-host/loader.ts"), "utf8");
  // The lost-race check happens after onLoad resolves: the memo deleted by
  // unloadRendererModule is the signal, and every teardown surface runs.
  const checkAt = loader.indexOf("if (!loaded.has(pluginId)) {");
  const onLoadAt = loader.indexOf("await mod.onLoad(");
  const returnAt = loader.indexOf("return { pluginId, module: mod as PiRendererModule };");
  assert.ok(onLoadAt > -1 && checkAt > onLoadAt, "the race check follows onLoad");
  assert.ok(returnAt > checkAt, "the race check precedes the successful return");
  const guarded = loader.slice(checkAt, returnAt);
  assert.match(guarded, /slotRegistry\.unregisterPlugin\(pluginId\)/);
  assert.match(guarded, /removePluginStyles\(pluginId\)/);
  assert.match(guarded, /unbindDispatch\(pluginId\)/);
});
