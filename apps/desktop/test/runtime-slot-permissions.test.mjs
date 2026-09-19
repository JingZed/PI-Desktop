// The runtime slot gate refuses a handler for a slot permission the permission
// registry holds (ADR 0291 rule 2). The end state these tests pin down is
// strict: every slot ADR 0291 builds is registered, so every wired event's
// handler is gated for every plugin, the high-trust tier included.
// `packages/shared` cannot import the SDK, so it mirrors the registry's
// `runtime.*` names; these tests keep the mirror and the contract honest
// against the SDK's own list.
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

/**
 * The twelve `runtime.*` names ADR 0291 makes real: the eleven built slots
 * plus `runtime.session.read` (rule 7). The twelfth slot,
 * `runtime.approval.before`, is deliberately unbuilt and stays reserved.
 */
const ADR_SLOT_NAMES = [
  "runtime.request.before",
  "runtime.send.before",
  "runtime.session.lifecycle",
  "runtime.session.read",
  "runtime.tool.extend",
  "runtime.tool.gate",
  "runtime.turn.abort",
  "runtime.turn.closing",
  "runtime.turn.continue",
  "runtime.turn.facts",
  "runtime.turn.recap",
  "runtime.turn.watch",
];

/** The one slot ADR 0291 deliberately does not build this cycle. */
const UNBUILT_SLOT_NAME = "runtime.approval.before";

/** Risk tier the install dialog and the devkit hint must agree on (spec 13 §2). */
const EXPECTED_RISK = {
  "runtime.request.before": "high",
  "runtime.send.before": "high",
  "runtime.session.lifecycle": "high",
  "runtime.session.read": "high",
  "runtime.tool.extend": "high",
  "runtime.tool.gate": "high",
  "runtime.turn.abort": "high",
  "runtime.turn.closing": "high",
  "runtime.turn.continue": "high",
  "runtime.turn.facts": "low",
  "runtime.turn.recap": "high",
  "runtime.turn.watch": "medium",
};

test("the shared mirror lists exactly the runtime names the registry holds", () => {
  assert.deepEqual([...REGISTERED_SLOT_PERMISSIONS].sort(), [...registryRuntimeNames].sort());
  for (const name of registryRuntimeNames) {
    // A name the mirror forgot would leave its slot ungated without failing
    // anywhere else, which is the drift this test exists to catch.
    assert.equal(isRegisteredSlotPermission(name), true, name);
  }
});

test("every reserved slot name is registered, so the gate has no gaps", () => {
  // The contract covers every wired event (spec 13 §2C); each names a slot, and
  // every one of those names is grantable, so none is left "reserved, not
  // enforced" and the runner never falls back to an ungated handler.
  const mapped = new Set(Object.values(TRUSTED_EXTENSION_EVENT_PERMISSIONS));
  for (const name of mapped) {
    assert.equal(registryRuntimeNames.includes(name), true, name);
    assert.equal(isRegisteredSlotPermission(name), true, name);
  }
  // The unbuilt slot stays reserved: no event maps to it, no registry holds it.
  assert.equal(mapped.has(UNBUILT_SLOT_NAME), false);
  assert.equal(isRegisteredSlotPermission(UNBUILT_SLOT_NAME), false);
  assert.equal(PLUGIN_PERMISSIONS.includes(UNBUILT_SLOT_NAME), false);
});

test("the registry holds every built slot name of ADR 0291 §1", () => {
  assert.deepEqual([...registryRuntimeNames].sort(), [...ADR_SLOT_NAMES].sort());
  for (const name of ADR_SLOT_NAMES) {
    assert.equal(isRegisteredSlotPermission(name), true, name);
  }
});

test("the runner enforces every slot name directly, with no registry fallback", () => {
  // The staging short-circuit is gone: the runner no longer asks whether a name
  // is registered before refusing on it, so a mapped permission is enforced for
  // every plugin. A reintroduced `isRegisteredSlotPermission` import would put
  // the "reserved, not enforced" window back, which this change closed.
  const runnerSource = readFileSync(
    new URL("../../../packages/agent-runtime/src/extensions/runner.ts", import.meta.url),
    "utf8",
  );
  assert.equal(runnerSource.includes("isRegisteredSlotPermission"), false);
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

test("every runtime name carries a risk tier, and every high one is in the devkit mirror", () => {
  const modelSource = readFileSync(
    new URL("../src/features/plugins/model.ts", import.meta.url),
    "utf8",
  );
  const devkitSource = readFileSync(
    new URL("../../../packages/plugin-devkit/src/check.ts", import.meta.url),
    "utf8",
  );
  for (const [name, tier] of Object.entries(EXPECTED_RISK)) {
    assert.match(modelSource, new RegExp(`"${name.replace(/\./g, "\\.")}": "${tier}"`), name);
    // The devkit's high-risk mirror must carry every high-risk runtime name:
    // the install dialog and the devkit hint read the same tier (spec 13 §5).
    if (tier === "high") {
      assert.equal(devkitSource.includes(`"${name}"`), true, name);
    }
  }
  // A read-only observation slot is not high, and structured facts carry no
  // conversation text: both sit below the rewrites and the spenders.
  assert.equal(EXPECTED_RISK["runtime.turn.watch"], "medium");
  assert.equal(EXPECTED_RISK["runtime.turn.facts"], "low");
});

// The two slots this round wires are only real if each half is present: the
// runtime has to emit the event, and the desktop host has to announce the
// moments only it observes. These are source-shape assertions because the
// desktop test runner has no Electron and no agent sidecar; the behaviour
// itself is covered by the agent-runtime suite (slots 1 and 11) and by
// `context-compaction.test.mjs`.
test("slot 1 is emitted from the prompt path, with the whole action contract", () => {
  const runtimeSource = readFileSync(
    new URL("../../../packages/agent-runtime/src/runtime.ts", import.meta.url),
    "utf8",
  );
  // The emit point: after the desktop accepted the message, before it is
  // queued for the model.
  assert.match(runtimeSource, /extensionBeforeSend\(modelInput, nextTurnId, userMessageId\)/);
  assert.match(runtimeSource, /private async extensionBeforeSend\(/);
  // Pass through, rewrite, block with a reason the user can read.
  assert.match(runtimeSource, /result\.action === "handled"/);
  assert.match(runtimeSource, /result\.action !== "transform"/);
  assert.match(runtimeSource, /PLUGIN_HANDLED_PROMPT_CODE/);
  // A rewrite is offered to the audit store, never silently applied.
  assert.match(runtimeSource, /"extensions\.rewrites\.record"/);
});

test("slot 11 announces the four host-owned moments and carries the compaction segment", () => {
  const runtimeSource = readFileSync(
    new URL("../../../packages/agent-runtime/src/runtime.ts", import.meta.url),
    "utf8",
  );
  const sidecarSource = readFileSync(
    new URL("../../../packages/agent-runtime/src/sidecar.ts", import.meta.url),
    "utf8",
  );
  const sessionIpcSource = readFileSync(
    new URL("../electron/main/ipc/session-ipc.ts", import.meta.url),
    "utf8",
  );
  // The kernel's own moments, announced from the host side, plus the desktop's
  // two moments the kernel has no hook for.
  assert.match(runtimeSource, /type: "session_before_switch"/);
  assert.match(runtimeSource, /type: "session_before_fork"/);
  assert.match(runtimeSource, /TRUSTED_EXTENSION_SESSION_LIFECYCLE_EVENT/);
  // Informed-only and fire-and-forget: the notice is emitted, never awaited.
  assert.match(runtimeSource, /void runner\.emit\(event, payload as unknown as Record<string, unknown>\)/);
  // The compaction handover carries the segment about to be replaced.
  assert.match(runtimeSource, /messages: preparation\.messagesToSummarize/);
  // The sidecar delivers notices to live runtimes and answers at once.
  assert.match(sidecarSource, /case "agent\.notifyLifecycle": \{/);
  assert.match(sidecarSource, /runtime\.notifySessionLifecycle\(notice\)/);
  // Electron main owns the four moments.
  assert.match(sessionIpcSource, /agentSidecar\.call\("agent\.notifyLifecycle", params\)/);
  for (const change of ['change: "created"', 'change: "deleted"', 'change: "fork"', 'change: "switch"']) {
    assert.equal(sessionIpcSource.includes(change), true, change);
  }
});
