/**
 * The trusted renderer host (spec 07-plugins/16).
 *
 * A plugin that declares `manifest.renderer` may register React components into
 * slots the host owns. The entry is fetched and evaluated lazily — the first
 * time one of its slots is really rendered — and it only runs at all when the
 * plugin was granted the `renderer.extension` permission.
 *
 * The host draws every registered component with its own React instance, in the
 * same JavaScript realm as the host UI. A plugin that ships its own React is
 * refused at load, because two React copies break hooks and context. Write
 * components against the types here instead of importing React: this module
 * deliberately carries no React dependency so the SDK stays renderer-agnostic.
 *
 * A plugin may also register pure synchronous functions (`pi.functions`) that
 * the host calls directly while it renders — the positions that cannot wait
 * for an async round trip (ADR 0294 decision 6).
 */


/**
 * Scheme the host serves plugin renderer bundles over. It is deliberately
 * separate from `plugin-asset`, whose MIME allowlist is images and fonts only:
 * widening that allowlist would turn every already-issued theme asset URL into
 * a script URL.
 */
export const PLUGIN_RENDERER_SCHEME = "plugin-renderer";
/**
 * Slots that draw a component inside the host's own React tree. `.`-free ids
 * are part of the plugin contract: they appear in diagnostics and in
 * `data-pi-plugin` containers. Non-component capabilities (attachment sources,
 * draft rewriting, Markdown transforms, plugin copy) are separate APIs.
 */
export const PLUGIN_RENDERER_SLOTS = [
  /** Whole-message rendering: a message that is an object, not a paragraph. */
  "entry",
  /** Turn / tool card body for the plugin's own tools. */
  "toolCard",
  /** Fenced code-block renderer for one language. */
  "codeBlock",
  /** Extra block appended below one transcript entry. */
  "entryExtra",
  /** Controls in the composer's left and right positions. */
  "composerControl",
  /** Candidate source for the composer's completion popover. */
  "completionSource",
  /** Inline confirmation card above the composer. */
  "inlineConfirm",
  /** Blocking, app-level dialog. */
  "modal",
  /** In-window overlay layer, independent of the current view. */
  "overlay",
  /** Composer reference chips and their resolve() contract. */
  "composerReference",
] as const;

export type PluginRendererSlot = (typeof PLUGIN_RENDERER_SLOTS)[number];

/**
 * Data the host can hand a renderer component when the plugin declares
 * `manifest.rendererData`. A name is a whole slice whose shape the host owns,
 * not a free-form string. Omitted means the plugin declares no data at all,
 * which is what every manifest written before this field means.
 */
export const PLUGIN_RENDERER_DATA = [
  /** The transcript entry the component is mounted for. */
  "entry",
  /** Facts about the session that entry belongs to. */
  "session",
  /** The fenced source a code-block component was handed. */
  "code",
  /** The host's current light/dark theme. */
  "theme",
  /** The user's current text selection inside the host UI. */
  "selection",
  /** A read-only copy of the composer draft. */
  "draft",
  /** The attachment chips currently on the composer. */
  "attachments",
  /** The locale the host UI is showing. */
  "locale",
] as const;

export type PluginRendererDataKey = (typeof PLUGIN_RENDERER_DATA)[number];

/**
 * Actions a renderer component may ask the host to run. The vocabulary is
 * host-owned, so a plugin declares intent instead of inventing verbs, and the
 * declaration is what an install review reads.
 *
 * Three are implemented in this release and say so below. Every other name is
 * declarable but has no host handler yet: calling one rejects with a coded
 * `PLUGIN_ACTION_UNROUTED` refusal rather than resolving `undefined`.
 */
export const PLUGIN_RENDERER_ACTIONS = [
  /**
   * Runs a method inside the plugin's own headless entry (`onRendererCall`) and
   * resolves with its answer. Payload `{ method: string, args?: unknown }`.
   * Refused with a coded error when the plugin's manifest does not declare this
   * action, when the plugin has no entry or no such handler, or when the call
   * times out.
   */
  "plugin.call",
  /**
   * Replaces the active session's whole composer draft. Payload
   * `{ text: string }`; the resulting draft text is exactly that string and its
   * attachment chips are cleared. Resolves once a mounted composer consumed the
   * write, and refuses with `PLUGIN_ACTION_DRAFT_UNCONSUMED` when none did.
   */
  "composer.replaceDraft",
  /**
   * Inserts text at the composer's current selection. Not implemented yet:
   * calling it rejects with a coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "composer.insertText",
  /**
   * Attaches a path as a composer attachment chip. Not implemented yet: calling
   * it rejects with a coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "composer.attachPath",
  /**
   * Opens an in-window overlay layer. Not implemented yet: calling it rejects
   * with a coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "ui.openOverlay",
  /**
   * Closes the overlay this plugin opened. Not implemented yet: calling it
   * rejects with a coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "ui.closeOverlay",
  /**
   * Opens an app-level modal. Not implemented yet: calling it rejects with a
   * coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "ui.openModal",
  /**
   * Closes the modal this plugin opened. Not implemented yet: calling it
   * rejects with a coded `PLUGIN_ACTION_UNROUTED` refusal.
   */
  "ui.closeModal",
  /**
   * Shows the shell's toast. Payload
   * `{ message: string, variant?: "info" | "success" | "error" }`; omitted
   * variant uses the host default (`info`). A blank message or an unknown
   * variant is refused with `PLUGIN_ACTION_INVALID_PAYLOAD`.
   */
  "ui.toast",
] as const;

export type PluginRendererActionName = (typeof PLUGIN_RENDERER_ACTIONS)[number];

/**
 * The host method a slot component calls to act (ADR 0294). It arrives as the
 * `dispatch` prop on every render, bound to exactly one plugin: an action that
 * plugin did not declare in `manifest.rendererActions` is refused with a
 * `PLUGIN_ACTION_UNDECLARED` error, and a declared action the host has no
 * handler for yet is refused with `PLUGIN_ACTION_UNROUTED` rather than resolving
 * `undefined`. It is a contract for plugins that behave, not a security
 * boundary.
 */
export type PiRendererDispatch = (
  action: PluginRendererActionName,
  payload?: unknown,
) => Promise<unknown>;

/**
 * A React component, typed structurally: the host renders it, and the plugin
 * must not assume which React version or module instance it came from.
 */
export type PiRendererComponent<Props = Record<string, unknown>> = (props: Props) => unknown;

/** Handle returned by `pi.slots.register`. The host also revokes it on unload. */
export type PiRendererRegistration = {
  readonly slot: PluginRendererSlot;
  /** Removes this one registration; the slot stops rendering immediately. */
  remove(): void;
};

/** Handle returned by `pi.ui.injectStyle`; the host removes the sheet on unload. */
export type PiRendererStyleHandle = {
  remove(): void;
};
/**
 * A function a plugin hands the host to call *while it renders* (ADR 0294
 * decision 6). Some positions cannot wait for an async round trip — a
 * per-message block whose height the transcript has to know, a code-block
 * decoration, a value read while a composer control is computed — so these
 * functions are called directly, in the host's realm, synchronously. They must
 * be pure and synchronous: no I/O, no network, no DOM mutation, no long work.
 * The host may call one on any render of the position that registered it, and
 * stops calling it if it misbehaves.
 */
export type PiRendererHostFunction = (input: unknown) => unknown;

/** Handle returned by `pi.functions.register`; the host also revokes it on unload. */
export type PiRendererFunctionHandle = {
  readonly name: string;
  /** Removes this one function; the host stops calling the name immediately. */
  remove(): void;
};

/** Why a host call of a registered function produced no value. */
export type PiRendererFunctionFailureCode =
  | "PLUGIN_FUNCTION_MISSING"
  | "PLUGIN_FUNCTION_THREW"
  | "PLUGIN_FUNCTION_OVER_BUDGET"
  | "PLUGIN_FUNCTION_DISABLED";

/**
 * The answer to one host call. `ok: true` carries the function's value
 * unchanged; a failure carries the code the host refused the call under and a
 * human-readable `detail`. `PLUGIN_FUNCTION_OVER_BUDGET` means the function
 * returned, but past the host's one-frame budget, so its value was discarded:
 * a render that needed a synchronous answer cannot wait another frame for it.
 * Three consecutive throwing or over-budget calls disable the function for the
 * rest of that plugin's loaded lifetime.
 */
export type PiRendererFunctionCallResult =
  | { ok: true; value: unknown }
  | { ok: false; code: PiRendererFunctionFailureCode; detail?: string };

/**
 * The object handed to a renderer module's `onLoad`. It is the whole host API a
 * renderer plugin is handed, kept per-plugin by the `onLoad` argument. It is a
 * contract, not a boundary: the module shares the host's realm (ADR 0291), so
 * `window.piDesktop` and the host DOM both stay reachable from plugin code.
 */
export type PiRendererApi = {
  readonly plugin: {
    readonly id: string;
    readonly version: string;
  };
  readonly slots: {
    /**
     * Registers one component for a slot. The host renders it with the slot's
     * data as props plus a `dispatch` prop (`PiRendererDispatch`) bound to this
     * plugin. The same function object is handed over on every render, so it is
     * safe to list as a `useEffect` dependency.
     */
    register<Props>(
      slot: PluginRendererSlot,
      component: PiRendererComponent<Props>,
      options?: PiRendererSlotOptions,
    ): PiRendererRegistration;
  };
  readonly functions: {
    /**
     * Registers one host-callable function under a name that is unique inside
     * this plugin. The host may call it *while it renders* — synchronously, in
     * this realm, on any render — so the function must be pure and synchronous:
     * no I/O, no network, no DOM mutation, no long work. A throwing call, or an
     * answer past the host's one-frame budget, is discarded and reported; three
     * consecutive such calls disable the function for the rest of that
     * plugin's loaded lifetime.
     *
     * A name must match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$` and be at most
     * 64 characters; a name that does not, or one this plugin already
     * registered, is refused with a coded error rather than silently replaced.
     * Names are per plugin, and registration only ever goes through this `pi`
     * object: the host calls the function directly, with no ambient handle and
     * no channel.
     */
    register(name: string, fn: PiRendererHostFunction): PiRendererFunctionHandle;
  };
  readonly ui: {
    /**
     * Injects a stylesheet owned by the host, which removes it on unload. A
     * sheet that targets the host's own roots is refused at call time.
     */
    injectStyle(css: string): PiRendererStyleHandle;
  };
};

/**
 * The module shape `manifest.renderer` must export. `onLoad` is required — a
 * module that never registers anything is a manifest mistake rather than a
 * quiet no-op, and the loader refuses it with a diagnostic.
 */
export type PiRendererModule = {
  onLoad(pi: PiRendererApi): void | Promise<void>;
  onUnload?(): void | Promise<void>;
};

/**
 * Selectors that make an injected stylesheet reach past the plugin's own
 * `data-pi-plugin` container. The host refuses the whole sheet when one of
 * these appears as a top-level selector instead of silently narrowing it.
 */
export const PLUGIN_STYLE_FORBIDDEN_ROOT_SELECTORS = ["html", "body", ":root", "*"] as const;

/**
 * Extra registration data a slot needs. Only `codeBlock` uses it today: the
 * host has to know which fenced language a component claims, and the language
 * name must carry the plugin's own prefix so a plugin cannot shadow `json`,
 * `ts` or `mermaid` (spec 07-plugins/16 §2A.5).
 */
export type PiRendererSlotOptions = {
  /** `codeBlock` only: the fenced language this component renders. */
  language?: string;
};

/**
 * What the host hands a `codeBlock` renderer. The three protections the issue
 * asks for are visible here: a block whose fence is still open never reaches a
 * component, an oversized block is degraded to source text before this runs,
 * and a component that throws falls back to the host's own code block.
 */
export type PiRendererCodeBlockProps = {
  /** The fenced language as written, e.g. `acme:chart`. */
  language: string;
  /** The block's source, exactly as the model wrote it. */
  code: string;
  /** True while the fence is still open; the host does not render these. */
  isIncomplete: boolean;
  /** The host's current theme, so a diagram can match its surroundings. */
  theme: "light" | "dark";
};

/**
 * What the host hands an `entryExtra` renderer: the entry it is appended to, so
 * a plugin can decide for itself whether it has anything to add. The entry id is
 * the identity the transcript is keyed by, which is also what lets a failed
 * component be reported against the row the user is looking at.
 */
export type PiRendererEntryExtraProps = {
  entry: {
    id: string;
    role: "user" | "assistant" | "system";
    /** Set when the host attributes this entry to a plugin (D14). */
    pluginId?: string;
  };
  sessionId: string;
};

/**
 * What the host hands a `composerControl` renderer: which of the composer's two
 * control rows this mount is, and the draft those controls act on.
 *
 * The slot is mounted twice — once at the end of the composer's left control
 * row and once at the end of its right one — so one registration is asked for
 * both positions and decides for itself which one it draws in; returning `null`
 * for the other leaves no hole. The host's own controls are already in the row
 * when a component is mounted, so plugin controls follow them and can never
 * push the host's mode, permission, model, enhancement, or send controls out of
 * place (D8). A component renders one control, and may dispatch the actions its
 * manifest declares; it cannot remove, wrap, or reorder the host's controls.
 */
export type PiRendererComposerControlProps = {
  /** Which control row this mount fills. */
  position: "left" | "right";
  /**
   * The session the composer is drafting for. Absent for a draft that has no
   * session yet (a new-task composer), rather than an empty id.
   */
  sessionId?: string;
  /**
   * The draft as the host currently holds it, exactly as typed and including
   * the sentinel characters that stand for attachment chips. Read-only: a
   * component that wants to change the draft dispatches an action.
   */
  draft: string;
};

/**
 * What the host hands a `completionSource` renderer: the query the completion
 * popover is open for.
 *
 * The slot is mounted inside the popover, below the host's own candidate rows,
 * and only while the popover is open — a closed popover asks a plugin for
 * nothing. It is a candidate source, not a filter: the host's own command and
 * file rows keep their own order and are never hidden or reordered by a plugin,
 * and a plugin contributes its rows after them (D8). The keyboard highlight,
 * `Enter`/`Tab` acceptance, and the accept mapping stay host-owned and cover
 * the host's rows; a plugin's own row carries its own activation.
 */
export type PiRendererCompletionSourceProps = {
  /** Which trigger opened the popover: `/` commands, or `@` file paths. */
  mode: "slash" | "file";
  /**
   * The text typed after the trigger, as the host tokenizes it; empty when the
   * user has typed the trigger alone. A component should answer with candidates
   * for this query and render nothing when it has none.
   */
  query: string;
};

/**
 * One reference chip the composer already holds, as a `composerReference`
 * component reads it. Deliberately not the host's own reference record: the
 * sentinel token and MIME details a chip is painted from stay host-owned.
 */
export type PiRendererComposerReference = {
  /** Workspace-relative path, as the chip's own title uses it. */
  path: string;
  /** Display name shown on the host's chip. */
  name: string;
  /** `file` for a text/document chip, `image` for an image attachment chip. */
  kind: "file" | "image";
};

/**
 * What the host hands a `composerReference` renderer: the chips the composer
 * holds for the current draft, plus the draft itself.
 *
 * The host's reference chips are painted inside the editor, so the slot is
 * mounted in the composer's input surface directly after the editor: a plugin
 * chip follows every host chip, and no host chip is moved or rewritten (D8).
 * The list is read-only — a component may draw its own chip for the draft and
 * dispatch the actions its manifest declares, but it cannot add a reference to
 * the draft from here, remove a host chip, or change what the draft sends.
 * A component that has no chip for the current draft renders nothing.
 */
export type PiRendererComposerReferenceProps = {
  /** The host's own chips, in the order the draft shows them. Read-only. */
  references: PiRendererComposerReference[];
  /**
   * The draft as the host currently holds it, including the editor's sentinel
   * characters. Read-only; a component derives what it needs from it.
   */
  draft: string;
  /**
   * The session the composer is drafting for. Absent for a draft that has no
   * session yet (a new-task composer), rather than an empty id.
   */
  sessionId?: string;
};
