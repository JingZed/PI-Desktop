// The runtime slot gate refuses a handler only for a slot permission the
// permission registry holds (ADR 0291 rule 2 and its Consequences: a name is
// registered together with its slot). `packages/shared` cannot import the SDK,
// so it mirrors the registry's `runtime.*` names; these tests keep the mirror
// and the contract honest against the SDK's own list.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PLUGIN_PERMISSIONS } from "@pi-desktop/plugin-sdk";
import {
  isRegisteredSlotPermission,
  REGISTERED_SLOT_PERMISSIONS,
  TRUSTED_EXTENSION_EVENT_PERMISSIONS,
  trustedExtensionEventPermission,
} from "@pi-desktop/shared";

const registryRuntimeNames = PLUGIN_PERMISSIONS.filter((name) => name.startsWith("runtime."));

test("the shared mirror lists exactly the runtime names the registry holds", () => {
  assert.deepEqual([...REGISTERED_SLOT_PERMISSIONS].sort(), [...registryRuntimeNames].sort());
  for (const name of registryRuntimeNames) {
    // A name the mirror forgot would leave its slot ungated without failing
    // anywhere else, which is the drift this test exists to catch.
    assert.equal(isRegisteredSlotPermission(name), true, name);
  }
});

test("a reserved slot name is mapped but refuses nothing yet", () => {
  // The contract covers every wired event (spec 13 §2C); only a registered name
  // may be the reason a handler is skipped.
  const mapped = new Set(Object.values(TRUSTED_EXTENSION_EVENT_PERMISSIONS));
  for (const reserved of ["runtime.tool.gate", "runtime.request.before", "runtime.turn.watch", "runtime.session.lifecycle"]) {
    assert.equal(mapped.has(reserved), true, reserved);
    assert.equal(isRegisteredSlotPermission(reserved), false, reserved);
  }
  for (const gated of ["runtime.turn.closing", "runtime.send.before"]) {
    assert.equal(mapped.has(gated), true, gated);
    assert.equal(isRegisteredSlotPermission(gated), true, gated);
  }
});

test("the contract names one slot per wired event and leaves the rest alone", () => {
  assert.equal(trustedExtensionEventPermission("turn_closing"), "runtime.turn.closing");
  assert.equal(trustedExtensionEventPermission("tool_call"), "runtime.tool.gate");
  assert.equal(trustedExtensionEventPermission("tool_result"), "runtime.tool.gate");
  assert.equal(trustedExtensionEventPermission("context"), "runtime.request.before");
  assert.equal(trustedExtensionEventPermission("before_agent_start"), "runtime.request.before");
  assert.equal(trustedExtensionEventPermission("before_provider_headers"), "runtime.request.before");
  assert.equal(trustedExtensionEventPermission("turn_end"), "runtime.turn.watch");
  assert.equal(trustedExtensionEventPermission("tool_execution_end"), "runtime.turn.watch");
  assert.equal(trustedExtensionEventPermission("session_before_compact"), "runtime.session.lifecycle");
  assert.equal(trustedExtensionEventPermission("input"), "runtime.send.before");
  // The runner's own boundaries and a rename notice have no slot.
  assert.equal(trustedExtensionEventPermission("session_start"), undefined);
  assert.equal(trustedExtensionEventPermission("session_shutdown"), undefined);
  assert.equal(trustedExtensionEventPermission("session_info_changed"), undefined);
});

test("both names this batch registers are in the registry and the risk table", () => {
  const modelSource = readFileSync(
    new URL("../src/features/plugins/model.ts", import.meta.url),
    "utf8",
  );
  assert.equal(PLUGIN_PERMISSIONS.includes("runtime.tool.extend"), true);
  assert.equal(PLUGIN_PERMISSIONS.includes("runtime.turn.facts"), true);
  // A plugin tool can add tools to the agent's own catalogue and report spend,
  // so it sits with the other high-risk grants; structured turn facts carry no
  // conversation text, so they do not.
  assert.match(modelSource, /"runtime\.tool\.extend": "high"/);
  assert.match(modelSource, /"runtime\.turn\.facts": "low"/);
  assert.equal(isRegisteredSlotPermission("runtime.tool.extend"), true);
  assert.equal(isRegisteredSlotPermission("runtime.turn.facts"), true);
});
