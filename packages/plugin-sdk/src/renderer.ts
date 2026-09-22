/**
 * UI slot contract shared by all renderer slots (`docs/plugin-plan/ui/`).
 *
 * A plugin ships a **renderer entry** — an ES module loaded into the host
 * renderer process — and registers slot components through the `pi.slots`
 * API handed to `onLoad`. The slot vocabulary below is the finalized
 * catalog (`docs/plugin-plan/slot-contract.html`):
 *
 * - `userAction` / `assistantAction` — additive left/right positions on the
 *   user / assistant message card action bars.
 * - `entryExtra` — additive block below the assistant reply body.
 * - `toolCard` — no-claim card for the plugin's **own** registered tool.
 * - `blockRenderer` — keyed `<pluginId>:lang` code-block takeover.
 * - `composerControl` — additive left/right controls in the composer toolbar.
 * - `composerTrigger` — one trigger symbol per plugin (`@`, `#`, `/`).
 * - `composerToken` — how a selected item is written into the draft.
 *
 * Self-dialog (modal/overlay) is deliberately **not** a slot: plugins draw
 * it themselves inside their own components (`docs/plugin-plan/ui/self-dialog/`).
 */

/** Privileged scheme that serves renderer entry modules. */
export const PLUGIN_RENDERER_SCHEME = "plugin-renderer";

/** Every renderer slot the host mounts. */
export const PLUGIN_RENDERER_SLOTS = [
  "userAction",
  "assistantAction",
  "entryExtra",
  "toolCard",
  "blockRenderer",
  "composerControl",
  "composerTrigger",
  "composerToken",
] as const;

export type PluginRendererSlot = (typeof PLUGIN_RENDERER_SLOTS)[number];

/** Positions of the additive action bars and composer controls. */
export type PluginSlotPosition = "left" | "right";

/** Position vocabulary, used by `validateSlotOptions`. */
export const PLUGIN_SLOT_POSITIONS = ["left", "right"] as const;

/** Trigger symbols fixed by contract — one plugin per symbol. */
export const PLUGIN_COMPOSER_TRIGGERS = ["@", "#", "/"] as const;

export type PluginComposerTrigger = (typeof PLUGIN_COMPOSER_TRIGGERS)[number];

/** In-draft token cap: the 9th token onward collapses into a host `⧉ +N` chip. */
export const PLUGIN_COMPOSER_TOKEN_LIMIT = 8;

/** Message shape the host hands to message-anchored slots. */
export type PluginSlotMessage = {
  readonly id: string;
  readonly role: "user" | "assistant" | "system" | "tool";
  readonly content: string;
  readonly createdAt?: string;
};

/**
 * Props skeleton for the additive message slots (`slot-contract.html` §2):
 * `message` + ids + `position`. No host functions, no extra data.
 */
export type PluginActionSlotProps = {
  readonly message: PluginSlotMessage;
  readonly messageId: string;
  readonly sessionId: string;
  readonly position: PluginSlotPosition;
  /** Bound per plugin; the only outbound channel for slot components. */
  readonly dispatch: PluginRendererDispatch;
};

/** Props for `entryExtra` — assistant messages only, no `position` field. */
export type PluginEntryExtraSlotProps = {
  readonly message: PluginSlotMessage & { readonly role: "assistant" };
  readonly messageId: string;
  readonly sessionId: string;
  readonly dispatch: PluginRendererDispatch;
};

/** Props for `toolCard` — keyed to one of the plugin's own tools.
 * Failure is data (`toolError`), never a throw. */
export type PluginToolCardSlotProps = {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly toolArgs?: unknown;
  readonly toolStatus: "running" | "success" | "error";
  readonly toolResult?: unknown;
  readonly toolError?: unknown;
  readonly durationMs?: number;
  readonly messageId: string;
  readonly sessionId: string;
  readonly dispatch: PluginRendererDispatch;
};

/** Props for `blockRenderer` — the raw fence content, once, on close. */
export type PluginBlockRendererSlotProps = {
  readonly language: string;
  readonly source: string;
};

/** Props for the composer control slot — a rendering position, no data. */
export type PluginComposerControlSlotProps = {
  readonly position: PluginSlotPosition;
  readonly dispatch: PluginRendererDispatch;
};

/** Filter text the user typed after a trigger symbol; plugin answers candidates. */
export type PluginComposerTriggerProps = {
  readonly query: string;
  readonly dispatch: PluginRendererDispatch;
};

/** One selectable item a trigger plugin contributes. */
export type PluginComposerTriggerItem = {
  readonly label: string;
  readonly detail?: string;
  /** Data carried into the draft token when this item is picked. */
  readonly value: unknown;
};

/** Token props — label for display, send data preserved into the submit payload. */
export type PluginComposerTokenProps = {
  readonly label: string;
  readonly send: unknown;
  readonly dispatch: PluginRendererDispatch;
};

/** Host → plugin, once per `plugin.call`. Plugin answers with a JSON value. */
export type PluginRendererCall = {
  readonly pluginId: string;
  readonly method: string;
  readonly args?: unknown;
};

/** Plugin → host, the only outbound channel for slot components. */
export type PluginRendererDispatch = (
  action: PluginRendererActionName,
  payload?: unknown,
) => Promise<unknown>;

/**
 * Actions a slot component may dispatch. Declared per plugin in
 * `manifest.rendererActions`; an undeclared action is refused with
 * `PLUGIN_ACTION_UNDECLARED`. The wider vocabulary in
 * `slot-contract.html` §3 (entry.copy, message.mutate, …) lands with the
 * rounds that consume it; the gate below is real from day one.
 */
export type PluginRendererActionName =
  | "plugin.call"
  | "composer.insertText"
  | "composer.acceptTriggerItem";

/** `plugin.call` payload — `pluginId` is host-injected, never plugin-supplied. */
export type PluginCallPayload = {
  readonly method: string;
  readonly args?: unknown;
};

/** A registration handle; `remove()` unregisters (卸载摘注册). */
export type PluginRendererRegistration = {
  readonly slot: PluginRendererSlot;
  remove(): void;
};

/** A style handle; `remove()` drops the injected sheet. */
export type PluginRendererStyleHandle = {
  remove(): void;
};

/**
 * The `pi` object handed to a renderer entry's `onLoad`.
 *
 * `pi.functions` (the F layer: `measureHeight` / `deriveSummary`) is
 * deliberately absent from this milestone — no finalized ui/ slot consumes
 * it yet; the vocabulary stays reserved in `slot-contract.html` §3.
 */
export type PiRendererApi = {
  readonly plugin: {
    readonly id: string;
    readonly version: string;
  };
  readonly slots: {
    /**
     * Register a slot component. Throws a coded error when the host refuses:
     * `PLUGIN_SLOT_DUPLICATE` (keyed slot already taken),
     * `PLUGIN_SLOT_INVALID_COMPONENT` (component not a function),
     * `PLUGIN_SLOT_INVALID_KEY` (malformed key), or
     * `PLUGIN_SLOT_UNKNOWN` (slot not in the vocabulary).
     */
    register<Props>(
      slot: PluginRendererSlot,
      component: (props: Props) => unknown,
      options?: PluginRendererSlotOptions,
    ): PluginRendererRegistration;
  };
  readonly ui: {
    /** Inject a style sheet scoped under `.pi-plugin-slot.<pluginId>`. */
    injectStyle(css: string): PluginRendererStyleHandle;
  };
};

/** Renderer entry module shape — plain ES module, no build step required. */
export type PiRendererModule = {
  onLoad(pi: PiRendererApi): void | Promise<void>;
  onUnload?(): void | Promise<void>;
};

/** Options accepted by `pi.slots.register` per slot. Keyed slots carry
 * their key here (`language`, `toolName`, `trigger`); additive slots take
 * optional position subsets. */
export type PluginRendererSlotOptions = {
  /**
   * `userAction` / `assistantAction` / `composerControl` — which sides to
   * occupy; omit for both.
   */
  readonly positions?: readonly PluginSlotPosition[];
  /** `toolCard` — must match one of the plugin's own `contributes.agentTools[].name`. */
  readonly toolName?: string;
  /** `blockRenderer` — must be `<pluginId>:lang`. */
  readonly language?: string;
  /** `composerTrigger` — exactly one of `@` `#` `/`; one plugin per symbol. */
  readonly trigger?: PluginComposerTrigger;
};

/** Diagnostic codes the slot subsystem reports (also surfaced as thrown errors). */
export type PluginRendererSlotDiagnosticCode =
  | "PLUGIN_SLOT_UNKNOWN"
  | "PLUGIN_SLOT_DUPLICATE"
  | "PLUGIN_SLOT_INVALID_COMPONENT"
  | "PLUGIN_SLOT_INVALID_KEY"
  | "PLUGIN_SLOT_INVALID_POSITION"
  | "PLUGIN_SLOT_NOT_DECLARED"
  | "PLUGIN_SLOT_RENDER_FAILED"
  | "PLUGIN_SLOT_LOAD_FAILED"
  | "PLUGIN_ACTION_UNDECLARED"
  | "PLUGIN_ACTION_UNROUTED"
  | "PLUGIN_ACTION_INVALID_PAYLOAD"
  | "PLUGIN_CALL_NO_HANDLER"
  | "PLUGIN_CALL_UNSERIALIZABLE"
  | "PLUGIN_CALL_TIMEOUT"
  | "PLUGIN_CALL_TOO_LARGE"
  | "PLUGIN_CALL_RATE_LIMITED"
  | "PLUGIN_CALL_DISABLED";

/** A refusal the host reports for a renderer plugin, for the plugin row UI. */
export type PluginRendererDiagnostic = {
  readonly pluginId: string;
  readonly code: PluginRendererSlotDiagnosticCode;
  readonly detail?: string;
};

/**
 * Guard used by keyed registration: `blockRenderer` keys must be
 * `<pluginId>:lang`; `toolCard` keys are the tool name; `composerTrigger`
 * keys are the single symbol. Returns an error message or `null`.
 */
export function slotKeyError(
  slot: PluginRendererSlot,
  pluginId: string,
  options: PluginRendererSlotOptions | undefined,
): string | null {
  if (slot === "blockRenderer") {
    const language = options?.language;
    if (typeof language !== "string" || language.length === 0) {
      return "blockRenderer requires options.language";
    }
    const prefix = `${pluginId}:`;
    if (
      language === prefix ||
      !language.startsWith(prefix) ||
      language.slice(prefix.length).trim().length === 0
    ) {
      return `blockRenderer language must be "<pluginId>:lang" (got ${JSON.stringify(language)})`;
    }
    const lang = language.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(lang)) {
      return `blockRenderer language suffix must match [A-Za-z0-9_-]+ (got ${JSON.stringify(lang)})`;
    }
    return null;
  }
  if (slot === "toolCard") {
    const toolName = options?.toolName;
    if (typeof toolName !== "string" || toolName.trim().length === 0) {
      return "toolCard requires options.toolName";
    }
    return null;
  }
  if (slot === "composerTrigger") {
    const trigger = options?.trigger;
    if (
      typeof trigger !== "string" ||
      !(PLUGIN_COMPOSER_TRIGGERS as readonly string[]).includes(trigger)
    ) {
      return `composerTrigger requires options.trigger to be one of ${PLUGIN_COMPOSER_TRIGGERS.join(" ")}`;
    }
    // 宿主先占: `@` drives file references and `/` drives slash commands;
    // plugins claim only `#` this round (docs/plugin-plan/ui/composer/).
    if (trigger !== "#") {
      return `composerTrigger trigger "${trigger}" is host-owned; plugins claim "#"`;
    }
    return null;
  }
  return null;
}

/**
 * The no-claim gate for `toolCard` (`docs/plugin-plan/ui/tool-card/`):
 * a plugin may only register a card for a tool its own manifest declares
 * in `contributes.agentTools`. Returns an error message or `null`.
 *
 * `declaredTools` comes from the plugin's `PluginSummary.tools` row; an
 * absent row means the registry predates the renderer milestone, so the
 * declaration is unprovable and the registration is refused.
 */
export function toolCardOwnershipError(
  toolName: string,
  declaredTools: readonly string[] | undefined,
): string | null {
  if (!declaredTools || declaredTools.length === 0) {
    return `toolCard requires the manifest to declare contributes.agentTools (no tools found for this plugin)`;
  }
  if (!declaredTools.includes(toolName)) {
    return `toolCard toolName ${JSON.stringify(toolName)} is not in the plugin's own contributes.agentTools`;
  }
  return null;
}

/**
 * Position-subset validation for the additive slots (`userAction`,
 * `assistantAction`, `composerControl`). Entries must come from the
 * vocabulary; an empty array registers nothing and is refused.
 */
export function slotPositionsError(
  slot: PluginRendererSlot,
  options: PluginRendererSlotOptions | undefined,
): string | null {
  if (slot !== "userAction" && slot !== "assistantAction" && slot !== "composerControl") {
    return null;
  }
  const raw = options?.positions;
  if (raw === undefined) return null;
  if (!Array.isArray(raw) || raw.length === 0) {
    return `${slot} options.positions must be a non-empty array`;
  }
  for (const entry of raw) {
    if (entry !== "left" && entry !== "right") {
      return `${slot} options.positions entries must be "left" or "right"`;
    }
  }
  return null;
}
