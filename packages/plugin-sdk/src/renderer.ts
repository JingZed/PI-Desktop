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
 * declaration is what an install review reads. Only `plugin.call`,
 * `composer.replaceDraft`, and `ui.toast` are wired up in this release; the
 * rest are declarable but refuse with an explicit error at call time rather
 * than failing silently.
 */
export const PLUGIN_RENDERER_ACTIONS = [
  /** Runs a method on the plugin's own backend process. */
  "plugin.call",
  /** Replaces the whole composer draft. */
  "composer.replaceDraft",
  /** Inserts text at the composer's current selection. Not implemented yet. */
  "composer.insertText",
  /** Attaches a path as a composer attachment chip. Not implemented yet. */
  "composer.attachPath",
  /** Opens an in-window overlay layer. Not implemented yet. */
  "ui.openOverlay",
  /** Closes the overlay this plugin opened. Not implemented yet. */
  "ui.closeOverlay",
  /** Opens an app-level modal. Not implemented yet. */
  "ui.openModal",
  /** Closes the modal this plugin opened. Not implemented yet. */
  "ui.closeModal",
  /** Shows a host notification. */
  "ui.toast",
] as const;

export type PluginRendererActionName = (typeof PLUGIN_RENDERER_ACTIONS)[number];

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
 * The object handed to a renderer module's `onLoad`. It is the whole host API a
 * renderer plugin is handed, kept per-plugin by the `onLoad` argument. It is a
 * contract, not a boundary: the module shares the host's realm (ADR 0287), so
 * `window.piDesktop` and the host DOM both stay reachable from plugin code.
 */
export type PiRendererApi = {
  readonly plugin: {
    readonly id: string;
    readonly version: string;
  };
  readonly slots: {
    register<Props>(
      slot: PluginRendererSlot,
      component: PiRendererComponent<Props>,
      options?: PiRendererSlotOptions,
    ): PiRendererRegistration;
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
