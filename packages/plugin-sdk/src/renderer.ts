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
 *
 * Two roles (ADR 0294 D7, narrowed):
 * - Install-review / declaration metadata for every name in this list.
 * - Ambient props the host actually injects when the value already exists:
 *   only `theme` and `locale` (PLUGIN_RENDERER_AMBIENT_DATA). Slot-contract
 *   props (draft, entry, references, …) always arrive from the slot's own
 *   mount and are not gated by this list. `selection` is declarable but not
 *   served this cycle — the host reports `PLUGIN_DATA_UNSERVED` rather than
 *   silently ignoring the declaration.
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
 * Ambient keys the host injects at `SlotOutlet` when the plugin declared them
 * and the host already holds the value. Narrow on purpose: this is not a
 * live subscription engine.
 */
export const PLUGIN_RENDERER_AMBIENT_DATA = ["theme", "locale"] as const;

export type PluginRendererAmbientDataKey = (typeof PLUGIN_RENDERER_AMBIENT_DATA)[number];

/**
 * Declarable data keys the host does not serve yet. Declaration stays valid
 * for install review; the runtime answers with `PLUGIN_DATA_UNSERVED`.
 */
export const PLUGIN_RENDERER_UNSERVED_DATA = ["selection"] as const;

/**
 * Component slots that *replace* a host surface: at most one registration
 * holds the position (first claim wins). Additive slots may stack in
 * registration order (D8). `codeBlock` uses language claims instead of a
 * whole-slot claim.
 */
export const PLUGIN_RENDERER_REPLACE_SLOTS = [
  "entry",
  "toolCard",
  "inlineConfirm",
  "modal",
] as const;

export function isPluginRendererReplaceSlot(
  slot: PluginRendererSlot,
): slot is (typeof PLUGIN_RENDERER_REPLACE_SLOTS)[number] {
  return (PLUGIN_RENDERER_REPLACE_SLOTS as readonly string[]).includes(slot);
}

/**
 * Public design tokens a renderer slot may use. Host-maintained aliases of
 * internal `--ds-*` values, defined on `.pi-plugin-slot` only. The stability
 * contract is this prefix + this list: additions only; renames or removals
 * require a spec + ADR change. Internal host tokens and host class names are
 * not part of the plugin contract.
 */
export const PLUGIN_SLOT_DESIGN_TOKENS = [
  "--pi-slot-bg",
  "--pi-slot-bg-elevated",
  "--pi-slot-text",
  "--pi-slot-text-muted",
  "--pi-slot-text-faint",
  "--pi-slot-border",
  "--pi-slot-accent",
  "--pi-slot-success",
  "--pi-slot-warning",
  "--pi-slot-error",
  "--pi-slot-radius-sm",
  "--pi-slot-radius-md",
  "--pi-slot-text-xs",
  "--pi-slot-text-sm",
  "--pi-slot-text-base",
  "--pi-slot-shadow",
  "--pi-slot-font",
] as const;

export type PluginSlotDesignToken = (typeof PLUGIN_SLOT_DESIGN_TOKENS)[number];

/** Ambient props the host may merge into a slot component. All optional. */
export type PiRendererAmbientProps = {
  /** Host light/dark theme, when the plugin declared `theme`. */
  theme?: "light" | "dark";
  /** Host UI locale (e.g. `zh-CN`), when the plugin declared `locale`. */
  locale?: string;
};

/**
 * Diagnostic codes owned by the slot/style contract (registry + style injection).
 * Kept here so the SDK is the single place plugin authors and host code look.
 */
export type PluginRendererSlotDiagnosticCode =
  | "PLUGIN_SLOT_DUPLICATE"
  | "PLUGIN_DATA_UNSERVED"
  | "PLUGIN_STYLE_REFUSED"
  | "PLUGIN_STYLE_SCOPED"
  | "PLUGIN_STYLE_PRIVATE_TOKEN";

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
     * Injects a stylesheet owned by the host, which removes it on unload.
     *
     * The host auto-scopes every selector under this plugin's
     * `data-pi-plugin` container before the sheet is served. Top-level `html`,
     * `body`, or `*` (including nested in `@media`) are refused with
     * `PLUGIN_STYLE_REFUSED`. `:root` is rewritten to the plugin container so
     * theme branches stay writable. Public design tokens are the
     * `--pi-slot-*` names in `PLUGIN_SLOT_DESIGN_TOKENS`; host-internal
     * `--ds-*` names are not part of the contract.
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
 * Selectors the host refuses entirely when they appear as a top-level selector
 * in an injected sheet. `:root` is not listed: the host rewrites it to the
 * plugin's own `[data-pi-plugin="<id>"]` container so theme branches stay
 * writable without reaching the document root.
 */
export const PLUGIN_STYLE_FORBIDDEN_ROOT_SELECTORS = ["html", "body", "*"] as const;

/**
 * Scope every non-at-rule selector in `css` under the plugin's own container.
 * `:root` becomes the container (and `:root[data-theme=…]` becomes the
 * container carrying `data-pi-theme`). Selectors already prefixed with this
 * plugin's container are left alone. `@keyframes` / `@font-face` names are
 * rewritten to `pi-<pluginId>-<name>`.
 *
 * Throws `PLUGIN_STYLE_REFUSED` for forbidden root selectors or `@import`.
 * This is the author-facing preview helper; the host runs the same rewrite at
 * inject time, so the served CSS is always scoped.
 */
export function scopePluginStyle(pluginId: string, css: string): string {
  return scopePluginStyleImpl(pluginId, css);
}

/**
 * Implementation lives behind this indirection only so the pure rewrite can be
 * unit-tested without pulling the desktop app. Host injectors import
 * `scopePluginStyle` from the SDK or their local copy of the same algorithm.
 */
function scopePluginStyleImpl(pluginId: string, css: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import\b/i.test(withoutComments)) {
    throw styleRefused("@import is not allowed in an injected plugin sheet");
  }
  const container = containerSelector(pluginId);
  const keyframePrefix = `pi-${pluginId.replace(/[^a-zA-Z0-9_-]/g, "_")}-`;

  // Rename keyframes / font-faces first so later selector work cannot touch them.
  let working = withoutComments.replace(
    /@(?:-webkit-)?keyframes\s+([A-Za-z_][\w-]*)/gi,
    (_match, name: string) => `@keyframes ${keyframePrefix}${name}`,
  );
  working = working.replace(
    /@(?:-webkit-)?font-face\s*\{[\s\S]*?font-family\s*:\s*(['"]?)([^'";]+)\1/gi,
    (match, quote: string, family: string) =>
      match.replace(new RegExp(`font-family\\s*:\\s*(['"]?)${escapeRegExp(family)}\\1`, "i"), `font-family: ${quote || '"'}${keyframePrefix}${family}${quote || '"'}`),
  );
  // Rewrite animation-name / animation shorthands that referenced the old names.
  working = working.replace(
    /(animation(?:-name)?\s*:\s*)([^;}]+)/gi,
    (match, prop: string, value: string) => {
      const rewritten = value.replace(
        /(^|[\s,])([A-Za-z_][\w-]*)/g,
        (part: string, lead: string, name: string) => {
          if (/^(infinite|linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end|forwards|backwards|both|none|normal|reverse|alternate|alternate-reverse|paused|running|\d|\.)/i.test(name)) {
            return part;
          }
          if (name.startsWith(keyframePrefix)) return part;
          return `${lead}${keyframePrefix}${name}`;
        },
      );
      return `${prop}${rewritten}`;
    },
  );

  const out: string[] = [];
  let index = 0;
  while (index < working.length) {
    const brace = working.indexOf("{", index);
    if (brace < 0) {
      out.push(working.slice(index));
      break;
    }
    const start = Math.max(
      working.lastIndexOf("}", brace - 1),
      working.lastIndexOf("{", brace - 1),
      working.lastIndexOf(";", brace),
    );
    const selectorText = working.slice(start + 1, brace);
    const blockStart = brace;
    const blockEnd = findBlockEnd(working, brace);
    const body = working.slice(blockStart, blockEnd + 1);

    if (!selectorText.trim() || selectorText.trimStart().startsWith("@")) {
      // At-rule: recurse into its body when it is a conditional group.
      const at = selectorText.trimStart();
      if (/^@(?:media|supports|container|layer|scope)\b/i.test(at) && blockEnd > blockStart) {
        const inner = working.slice(blockStart + 1, blockEnd);
        const scopedInner = scopePluginStyleImpl(pluginId, inner);
        out.push(working.slice(index, start + 1), selectorText, "{", scopedInner, "}");
      } else {
        out.push(working.slice(index, blockEnd + 1));
      }
      index = blockEnd + 1;
      continue;
    }

    const scopedSelector = selectorText
      .split(",")
      .map((part) => scopeSelector(part.trim(), pluginId, container))
      .filter((part) => part.length > 0)
      .join(", ");
    out.push(working.slice(index, start + 1), scopedSelector, body);
    index = blockEnd + 1;
  }
  return out.join("").trim();
}

function scopeSelector(selector: string, pluginId: string, container: string): string {
  if (!selector) return "";
  const forbidden = forbiddenRootSelector(selector);
  if (forbidden) {
    throw styleRefused(`${JSON.stringify(forbidden)} targets a host root`);
  }
  if (selector === container || selector.startsWith(`${container} `) || selector.startsWith(`${container}:`) || selector.startsWith(`${container}.`) || selector.startsWith(`${container}[`) || selector.startsWith(`${container}>`) || selector.startsWith(`${container}+`) || selector.startsWith(`${container}~`)) {
    return selector;
  }
  // `:root` / `:root[data-theme=light]` → container (+ theme attribute).
  if (selector === ":root" || selector.startsWith(":root[") || selector.startsWith(":root:") || selector.startsWith(":root ") || selector.startsWith(":root>") || selector.startsWith(":root.") || selector.startsWith(":root#")) {
    return container + selector.slice(":root".length);
  }
  return `${container} ${selector}`;
}

function forbiddenRootSelector(selector: string): string | null {
  for (const root of PLUGIN_STYLE_FORBIDDEN_ROOT_SELECTORS) {
    const pattern = new RegExp(`^${root.replace(/[*:]/g, "\\$&")}(?![\\w-])`, "i");
    if (pattern.test(selector)) return selector;
  }
  return null;
}

function containerSelector(pluginId: string): string {
  return `[data-pi-plugin="${pluginId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

function styleRefused(detail: string): Error & { code?: string } {
  const error = new Error(`PLUGIN_STYLE_REFUSED: ${detail}`) as Error & { code?: string };
  error.code = "PLUGIN_STYLE_REFUSED";
  return error;
}

function findBlockEnd(css: string, openBrace: number): number {
  let depth = 0;
  for (let i = openBrace; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return css.length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
