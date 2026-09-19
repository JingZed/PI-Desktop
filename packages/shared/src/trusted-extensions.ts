/**
 * Trusted extensions (D387, ADR 0214, spec 07-plugins/16-trusted-extensions.md).
 *
 * Plain data shared by the renderer, Electron main, and the Agent sidecar.
 */

/** `plugin` is the only source in v1.1: modules come from `contributes.agentExtensions`. */
export type TrustedExtensionSource = "user" | "project" | "manual" | "plugin";

/** One loadable entry, keyed by the realpath of its entry file. */
export type TrustedExtensionSpec = {
  /** Realpath of the entry file. Stable identity for enablement and diagnostics. */
  id: string;
  /** Absolute entry file path as the loader should import it. */
  entry: string;
  /** Short label: package name, directory name, or file stem. */
  label: string;
  source: TrustedExtensionSource;
  /** Directory the entry was discovered from (the extensions root). */
  root: string;
  /**
   * Permissions the owning plugin holds, exactly as the loader granted them.
   * The runtime slot gate consults this list (ADR 0291 rule 2); absent means
   * none, because a tier permission must never imply a slot permission.
   */
  permissions?: readonly string[];
};

export type TrustedExtensionDiagnosticKind =
  | "load_error"
  | "factory_error"
  | "unsupported_api"
  | "stub_symbol"
  | "rejected_registration"
  | "permission_denied"
  | "handler_error"
  | "handler_timeout";

export type TrustedExtensionDiagnostic = {
  extensionId: string;
  kind: TrustedExtensionDiagnosticKind;
  message: string;
  /** API member, event name, tool name, or command name the diagnostic is about. */
  member?: string;
  /** How many times the same (extension, kind, member) triple fired. */
  count: number;
  /** Stack of the first occurrence, when the source threw. */
  stack?: string;
};

export type TrustedExtensionCommand = {
  extensionId: string;
  extensionLabel: string;
  name: string;
  description?: string;
};

export type TrustedExtensionLoadState = "loaded" | "error";

export type TrustedExtensionLoadReport = {
  extensionId: string;
  state: TrustedExtensionLoadState;
  toolNames: string[];
  commandNames: string[];
  agentNames: string[];
  eventNames: string[];
};

/** Interactive and status calls the sidecar sends to the desktop (spec §9). */
export type TrustedExtensionUiRequest =
  | { kind: "notify"; message: string; level: "info" | "warning" | "error" }
  | { kind: "confirm"; title: string; message: string }
  | { kind: "select"; title: string; options: string[] }
  | { kind: "input"; title: string; placeholder?: string }
  | { kind: "setStatus"; key: string; text: string | undefined }
  | { kind: "setWorkingMessage"; text: string | undefined };

export type TrustedExtensionUiResponse =
  | { kind: "notify" }
  | { kind: "confirm"; value: boolean }
  | { kind: "select"; value: string | undefined }
  | { kind: "input"; value: string | undefined }
  | { kind: "setStatus" }
  | { kind: "setWorkingMessage" };

/** Envelope for `extensions.ui.request` (sidecar → main). */
export type TrustedExtensionUiRequestEnvelope = {
  sessionId: string;
  extensionId: string;
  extensionLabel: string;
  request: TrustedExtensionUiRequest;
};

/** Modal prompt shown to the user (main → renderer). */
export type TrustedExtensionUiPrompt = {
  promptId: string;
  sessionId: string;
  extensionId: string;
  extensionLabel: string;
  request: Extract<TrustedExtensionUiRequest, { kind: "confirm" | "select" | "input" }>;
};

/** Renderer answer to a prompt (`extensions/ui/respond`). */
export type TrustedExtensionUiPromptResponse = {
  promptId: string;
  /** Omitted or `undefined` means the user dismissed the prompt. */
  value?: string | boolean;
};

/** Status text an extension set for a session (`ui.setStatus` / `ui.setWorkingMessage`). */
export type TrustedExtensionStatusEvent = {
  sessionId: string;
  extensionId: string;
  /** `working` is the working message; other keys are `setStatus` keys. */
  key: string;
  text: string | undefined;
};

/** Enablement scope as stored by the desktop (spec §3.2). */
export type TrustedExtensionScope = "user" | "manual" | { project: string };

/** `enabled` means switched on but not loaded by any session in this app run yet. */
export type TrustedExtensionEntryState = "disabled" | "enabled" | "loaded" | "error" | "missing";

/** One row of the Settings → Extensions list. */
export type TrustedExtensionEntry = {
  id: string;
  entry: string;
  label: string;
  source: TrustedExtensionSource;
  root: string;
  enabled: boolean;
  scope: TrustedExtensionScope;
  /** True when the entry file no longer exists on disk. */
  missing: boolean;
  /** Last known load state from any session, or `disabled`. */
  state: TrustedExtensionEntryState;
  /** Names registered in the most recent successful load. */
  toolNames: string[];
  commandNames: string[];
  /** Diagnostics from the most recent session that loaded this entry. */
  diagnostics: TrustedExtensionDiagnostic[];
};

export type TrustedExtensionsListResult = {
  entries: TrustedExtensionEntry[];
  /** Directories the desktop scanned, for the trust notice and empty state. */
  roots: { user: string; project?: string; manual: string[] };
};

/** Handler timeout for result-bearing events (spec §6). */
export const TRUSTED_EXTENSION_HANDLER_TIMEOUT_MS = 30_000;

/**
 * Runtime slot behind each wired extension event (ADR 0291 rule 2).
 *
 * A tier permission says where plugin code runs (`agent.extension`); a slot
 * permission says what that code may do to a running turn. This map is the
 * contract between the two: the runner resolves it before a handler runs, and
 * an event that is absent here has no slot and stays unrestricted —
 * `session_start` and `session_shutdown` are the runner's own boundaries and
 * `session_info_changed` is a rename notice, so none of them changes a turn.
 *
 * A mapped name whose slot is not implemented yet is reserved, not enforced:
 * see {@link REGISTERED_SLOT_PERMISSIONS}.
 */
export const TRUSTED_EXTENSION_EVENT_PERMISSIONS = {
  // Slot 7: consulted before a turn closes.
  turn_closing: "runtime.turn.closing",
  // Slot 4: block a call with a reason, replace a tool's result.
  tool_call: "runtime.tool.gate",
  tool_result: "runtime.tool.gate",
  // Slot 6: rewrite what is sent to the model (system prompt, model and
  // thinking level, request payload, message list).
  before_agent_start: "runtime.request.before",
  context: "runtime.request.before",
  before_provider_request: "runtime.request.before",
  before_provider_headers: "runtime.request.before",
  model_select: "runtime.request.before",
  thinking_level_select: "runtime.request.before",
  // Slot 2: live observation of the running turn.
  agent_start: "runtime.turn.watch",
  agent_end: "runtime.turn.watch",
  agent_settled: "runtime.turn.watch",
  turn_start: "runtime.turn.watch",
  turn_end: "runtime.turn.watch",
  message_start: "runtime.turn.watch",
  message_update: "runtime.turn.watch",
  message_end: "runtime.turn.watch",
  tool_execution_start: "runtime.turn.watch",
  tool_execution_update: "runtime.turn.watch",
  tool_execution_end: "runtime.turn.watch",
  after_provider_response: "runtime.turn.watch",
  // Slot 11: create / switch / delete / fork, and compaction.
  project_trust: "runtime.session.lifecycle",
  resources_discover: "runtime.session.lifecycle",
  session_before_compact: "runtime.session.lifecycle",
  session_compact: "runtime.session.lifecycle",
  session_compact_failed: "runtime.session.lifecycle",
  session_before_fork: "runtime.session.lifecycle",
  // Slot 1: after send, before the message is queued.
  input: "runtime.send.before",
} as const satisfies Record<string, string>;

/** The events this map knows about: every wired event that has a slot behind it. */
export type TrustedExtensionSlotEvent = keyof typeof TRUSTED_EXTENSION_EVENT_PERMISSIONS;

/**
 * The slot permission a handler for `event` must hold; `undefined` means the
 * event has no slot and stays unrestricted (ADR 0291 rule 2).
 */
export function trustedExtensionEventPermission(event: string): string | undefined {
  return Object.hasOwn(TRUSTED_EXTENSION_EVENT_PERMISSIONS, event)
    ? TRUSTED_EXTENSION_EVENT_PERMISSIONS[event as TrustedExtensionSlotEvent]
    : undefined;
}

/**
 * Slot permissions the permission registry holds today (spec 13 §2).
 *
 * {@link TRUSTED_EXTENSION_EVENT_PERMISSIONS} is the whole contract; this is
 * the subset a plugin can actually be granted, and therefore the subset a gate
 * may refuse on. A name enters the registry together with its slot (ADR 0291,
 * Consequences): a mapped name that is missing here leaves its event
 * unrestricted, exactly as it is today, until that slot's batch registers it.
 * `apps/desktop/test/runtime-slot-permissions.test.mjs` fails when this list
 * and `PLUGIN_PERMISSIONS` disagree.
 */
export const REGISTERED_SLOT_PERMISSIONS = [
  "runtime.send.before",
  "runtime.tool.extend",
  "runtime.turn.abort",
  "runtime.turn.closing",
  "runtime.turn.facts",
] as const;

/** True when `permission` is a slot permission the registry holds, so a gate may refuse on it. */
export function isRegisteredSlotPermission(permission: string): boolean {
  return (REGISTERED_SLOT_PERMISSIONS as readonly string[]).includes(permission);
}

/** Modal prompt timeout (spec §9). */
export const TRUSTED_EXTENSION_PROMPT_TIMEOUT_MS = 5 * 60_000;

/** The pinned kernel version every pi package in the sidecar must share (spec §13). */
export const TRUSTED_EXTENSION_KERNEL_VERSION = "0.85.1";

/** Palette command id prefix for extension commands. */
export const TRUSTED_EXTENSION_COMMAND_ID_PREFIX = "extension:";

export function trustedExtensionCommandId(name: string): string {
  return `${TRUSTED_EXTENSION_COMMAND_ID_PREFIX}${name}`;
}

export function trustedExtensionCommandName(commandId: string): string | undefined {
  return commandId.startsWith(TRUSTED_EXTENSION_COMMAND_ID_PREFIX)
    ? commandId.slice(TRUSTED_EXTENSION_COMMAND_ID_PREFIX.length)
    : undefined;
}
/** Public model metadata a trusted extension may register for its own agent. */
export type TrustedExtensionAgentModelConfig = {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevels?: Array<"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max">;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
};

/** Stable provider id used when a session is bound to a plugin-owned agent. */
export const TRUSTED_EXTENSION_AGENT_PROVIDER_PREFIX = "extension-agent:";

export function trustedExtensionAgentProviderId(agentKey: string): string {
  return `${TRUSTED_EXTENSION_AGENT_PROVIDER_PREFIX}${encodeURIComponent(agentKey)}`;
}

export function trustedExtensionAgentKeyFromProviderId(providerId: string): string | undefined {
  if (!providerId.startsWith(TRUSTED_EXTENSION_AGENT_PROVIDER_PREFIX)) return undefined;
  try {
    return decodeURIComponent(providerId.slice(TRUSTED_EXTENSION_AGENT_PROVIDER_PREFIX.length));
  } catch {
    return undefined;
  }
}
