import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const src = (relative) => join(here, "..", "src", relative);
const root = (relative) => join(here, "..", "..", "..", relative);

const css = readFileSync(src("plugins/renderer-slots/slot-shell.css"), "utf8");
const loader = readFileSync(src("plugins/renderer-host/loader.ts"), "utf8");
const demoSource = readFileSync(
  root("examples/plugins/ui-slots-demo/renderer/index.mjs"),
  "utf8",
);

test("self-dialog tool classes and the 600..899 / 900 z ladder exist", () => {
  // Tool classes from the finalized page.
  for (const cls of [
    ".p-overlay",
    ".p-overlay__corner",
    ".p-dialog",
    ".p-dialog-head",
    ".p-dialog__body",
    ".p-dialog__foot",
    ".p-notice",
    ".p-notice-icon",
    ".p-notice__msg",
    ".p-notice__dismiss",
    ".p-notice__msg",
    ".p-notice__dismiss",
  ]) {
    assert.ok(css.includes(cls), `missing tool class ${cls}`);
  }
  // Recommended tokens.
  assert.match(css, /--ds-scrim:/);
  assert.match(css, /--ds-shadow-dialog:/);
  // Ladder: plugin layers start at 600, the host safety layer pins 900.
  assert.match(css, /--ds-z-plugin-layer: 600;/);
  assert.match(css, /--ds-z-safety-layer: 900;/);
  assert.match(css, /\.p-overlay \{[\s\S]*?z-index: var\(--ds-z-plugin-layer\)/);
});

test("the demo self-dialog draws inside its own component, closes via explicit UI only", () => {
  // Drawn inside the plugin's own launcher component — no host slot, no
  // registry call for it.
  assert.match(demoSource, /function SelfDialogLauncher/);
  assert.match(demoSource, /h\("div", \{ className: "p-overlay"/);
  assert.match(demoSource, /className: "p-dialog"/);
  assert.match(demoSource, /"p-dialog-head"/);
  assert.match(demoSource, /"p-dialog__body"/);
  assert.match(demoSource, /"p-dialog__foot"/);
  // Close only through explicit UI actions (✕ / buttons).
  assert.match(demoSource, /"p-notice__dismiss"/);
  // Esc must not close it — no host Escape wiring in the sample.
  assert.doesNotMatch(demoSource, /onKeyDown|key === "Escape"/);
});

test("unload makes the layer disappear because the host tears the module down", () => {
  // The overlay is conditional JSX in the plugin component: gone with the
  // component tree, no host cleanup needed for the sample itself.
  assert.match(demoSource, /open\s*\?\s*h\("div", \{ className: "p-overlay"/);
  // Host teardown strips registrations, injected styles, and dispatch
  // before calling the plugin's own onUnload (loader contract).
  assert.match(loader, /slotRegistry\.unregisterPlugin\(pluginId\)/);
  assert.match(loader, /removePluginStyles\(pluginId\)/);
  assert.match(loader, /unbindDispatch\(pluginId\)/);
});

test("the host runs no stacking arbitration between plugin layers", () => {
  // One fixed mount for every self layer; the host never computes or
  // increments plugin z values, so later plugins simply stack above.
  assert.doesNotMatch(css, /z-index:\s*calc\(/);
  assert.doesNotMatch(css, /counter\(|z-index:\s*var\(--pi-plugin-z/);
  // The demo copy documents the ladder rule in place.
  assert.match(demoSource, /z 600\.\.899/);
  assert.match(demoSource, /900\) always wins/);
});
