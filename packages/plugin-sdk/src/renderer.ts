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
 * The object handed to a renderer module's `onLoad`. It is the only host
 * surface a renderer plugin gets: no `window.piDesktop`, no DOM authority
 * beyond its own container.
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
