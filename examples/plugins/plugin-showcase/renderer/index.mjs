/**
 * Renderer half of the plugin showcase (ADR 0291, ADR 0294, spec
 * 07-plugins/16 §2A).
 *
 * The host fetches this file from
 * `plugin-renderer://acme.plugin-showcase/renderer/index.mjs` and evaluates it
 * inside the app's own window, lazily: the first time one of its slots actually
 * renders. It is a plain ES module with no build step.
 *
 * A slot component is handed exactly two things: the slot's host data as props,
 * and `dispatch(action, payload)` — the plugin's one way to ask the host to do
 * something (ADR 0294 decision 1). `dispatch` acts for `acme.plugin-showcase`
 * and accepts only the actions this manifest lists in `rendererActions`; an
 * action the plugin did not declare is refused with a structured error
 * (`PLUGIN_ACTION_UNDECLARED`) instead of being silently ignored.
 *
 * This example registers a component for every one of the ten declared slots:
 *
 *   `entry`            — the whole-message position. A registration replaces
 *     the row the host draws, so this component states that it is standing in
 *     for the host's bubble rather than trying to re-draw it.
 *   `entryExtra`       — a block appended below a transcript entry.
 *   `codeBlock`        — a component that owns one fenced language, namespaced
 *     with this plugin's id so it cannot shadow `json`, `ts` or `mermaid`.
 *   `toolCard`         — the card body of this plugin's own tool. The host
 *     offers this position only to the tool row's owner (the forced
 *     `plugin_<id>_<tool>` prefix), which is why this plugin contributes
 *     `showcase_note` from its headless half.
 *   `composerControl`  — one registration asked for both composer control rows;
 *     it decides for itself which row it draws in (`position`).
 *   `completionSource` — rows inside the completion popover, below the host's.
 *   `composerReference`— the plugin's own chip beside the composer's chips.
 *   `inlineConfirm`, `modal`, `overlay` — the three layer positions. They are
 *     not registered at load: a modal registered at load would block the window
 *     the moment the module is evaluated, and an inline-confirm registration
 *     replaces the host's permission card, so both are opened from this
 *     plugin's own composer controls and closed by removing the registration.
 *     That is the position's whole lifecycle: registration is appearance,
 *     removal is disappearance (spec 07-plugins/16 2A.5, D10).
 *
 * Nothing here touches `window` or `document`: the props are the whole input
 * and `dispatch` is the whole output (ADR 0294 decision 1). The module shares
 * the host's realm, so that is a contract, not a wall.
 *
 * `react` is a bare specifier on purpose. The host installs an import map that
 * points `react`, `react-dom`, and `react-dom/client` at its own copies, and
 * every plugin shares that one instance. A plugin that ships its own React is
 * refused at load, because two copies break hooks and context.
 */
import { createElement, useEffect, useState } from "react";

const PLUGIN_ID = "acme.plugin-showcase";

/**
 * The one fenced language this plugin claims. A `codeBlock` language is the
 * slot's identity — one language has exactly one renderer — and it has to be
 * namespaced with the registering plugin's own id, which is what
 * `acme.plugin-showcase:kv` is.
 */
const CODE_LANGUAGE = `${PLUGIN_ID}:kv`;

/**
 * The layer positions this plugin opens on demand instead of at load. The two
 * app-level layers and the inline-confirm card are the only positions where a
 * registration at load would change the window before the user asked for
 * anything, so they are opened by a control and closed by their own button.
 */
const LAYER_SLOTS = ["inlineConfirm", "modal", "overlay"];

/**
 * Injected through `pi.ui.injectStyle`. Every selector is namespaced with the
 * plugin id and stays inside the host's `data-pi-plugin="acme.plugin-showcase"`
 * container: a sheet whose top-level selector is `html`, `body`, `:root`, or
 * `*` is refused whole rather than silently narrowed.
 *
 * No host design token is referenced here. An injected sheet is the plugin's
 * own CSS; the host does not promise its token names to plugins, so this uses
 * `currentColor` and nothing theme-specific. The one exception is the layer
 * surface, which has to be opaque because it floats over the window: it uses
 * the CSS system colors `Canvas`/`CanvasText`, which follow the host's
 * `color-scheme` rather than assuming a palette.
 */
const STYLES = `
.acme-plugin-showcase__badge {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.75rem;
  line-height: 1.6;
  opacity: 0.8;
}

.acme-plugin-showcase__muted {
  opacity: 0.75;
}

.acme-plugin-showcase__button {
  padding: 0.125rem 0.625rem;
  border: 1px solid currentColor;
  border-radius: 0.5rem;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.acme-plugin-showcase__action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
}

.acme-plugin-showcase__card {
  display: block;
  margin: 0.25rem 0;
  padding: 0.5rem 0.625rem;
  border: 1px dashed currentColor;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  line-height: 1.6;
}

.acme-plugin-showcase__card-title {
  display: block;
  font-weight: 600;
}

.acme-plugin-showcase__line {
  display: block;
}

.acme-plugin-showcase__layer-card {
  display: block;
  max-width: min(24rem, 90vw);
  padding: 0.75rem 0.875rem;
  border: 1px solid currentColor;
  border-radius: 0.75rem;
  background: Canvas;
  color: CanvasText;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.acme-plugin-showcase__layer-card.is-overlay {
  margin: 0.75rem;
  max-width: 19rem;
}

.acme-plugin-showcase__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
}

.acme-plugin-showcase__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  max-width: 100%;
  padding: 0.0625rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 0.5rem;
  font-size: 0.75rem;
  line-height: 1.6;
  opacity: 0.85;
}

.acme-plugin-showcase__completion {
  display: block;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1.7;
  opacity: 0.85;
}

.acme-plugin-showcase__kv {
  display: block;
  font-size: 0.8125rem;
  line-height: 1.7;
}

.acme-plugin-showcase__kv-head {
  display: block;
  opacity: 0.7;
}

.acme-plugin-showcase__kv-row {
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}

.acme-plugin-showcase__kv-key {
  min-width: 8rem;
  opacity: 0.85;
}

/* A row the block marked with a trailing "!": the plugin's own emphasis. */
.acme-plugin-showcase__kv-flagged {
  text-decoration: underline;
}
`;

/**
 * One pure function the host may call while it renders (ADR 0294 decision 6),
 * registered below as `entry-facts`.
 *
 * The rules a host-callable function has to follow are the reason it is written
 * this way: no I/O, no network, no DOM, no state, and it must return inside the
 * host's one-frame budget (16 ms) or the answer is discarded. It is called with
 * whatever input the calling position passes, so it reads defensively.
 *
 * No host position calls it yet. It is registered so the shape is visible next
 * to the slot components that use the same value, and the smoke test calls it
 * the way a host position would.
 *
 * @param {unknown} input The transcript entry the host is rendering.
 * @returns {{ id: string, role: string, attributedTo: string | null }}
 */
function entryFacts(input) {
  const entry = input && typeof input === "object" ? input : {};
  return {
    id: typeof entry.id === "string" && entry.id ? entry.id : "unknown",
    role: typeof entry.role === "string" && entry.role ? entry.role : "unknown",
    // D14: the host sets this when it attributes the entry to a plugin. It is
    // absent for every entry the host itself produced, which is most of them.
    attributedTo:
      typeof entry.pluginId === "string" && entry.pluginId ? entry.pluginId : null,
  };
}

/**
 * The second host-callable function, registered below as `kv-rows`.
 *
 * It turns the fenced source into rows for `codeBlock`. Pure and synchronous
 * like the one above, and deliberately boring: a parser the host can call on
 * every render of the block it draws has no business touching anything else.
 *
 * Grammar: one `key = value` per line, `#` starts a comment line, and a key
 * ending in `!` marks the row as one the block wants to draw attention to.
 *
 * @param {unknown} input The fenced source the block was handed.
 * @returns {Array<{ key: string, value: string, flagged: boolean }>}
 */
function kvRows(input) {
  const source = typeof input === "string" ? input : "";
  const rows = [];
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (!text || text.startsWith("#")) continue;
    const separator = text.indexOf("=");
    if (separator <= 0) continue;
    const rawKey = text.slice(0, separator).trim();
    rows.push({
      key: rawKey.replace(/!$/, ""),
      value: text.slice(separator + 1).trim(),
      flagged: rawKey.endsWith("!"),
    });
  }
  return rows;
}

/* -------------------------------------------------------------------------
 * The on-demand layer positions
 *
 * `inlineConfirm`, `modal` and `overlay` are opened from this plugin's own
 * composer controls. The `pi` object `onLoad` was handed is kept here because
 * only that object may register a slot, and a control that is already on
 * screen can still call it later. `openLayers` is the truth about which layers
 * are up; `layerListeners` re-renders the controls and the cards when it
 * changes, whichever of them made the change.
 * ---------------------------------------------------------------------- */

/** The `pi` object `onLoad` was handed, or `null` before `onLoad` runs. */
let hostApi = null;

/** slot -> registration handle for every layer this plugin has open. */
const openLayers = new Map();

/** Components that re-read `openLayers` when a layer opens or closes. */
const layerListeners = new Set();

function layerComponent(slot) {
  if (slot === "inlineConfirm") return InlineConfirmCard;
  if (slot === "modal") return ModalCard;
  if (slot === "overlay") return OverlayCard;
  return null;
}

/**
 * Opens or closes one layer. Appearance is the registration and disappearance
 * is its removal, so nothing else has to be tracked: if this plugin is unloaded
 * while a layer is up, the host reclaims the registration and the layer with it
 * (D10).
 */
function setLayerOpen(slot, open) {
  if (open === openLayers.has(slot)) return open;
  if (open) {
    if (!hostApi) return false;
    openLayers.set(slot, hostApi.slots.register(slot, layerComponent(slot)));
  } else {
    openLayers.get(slot).remove();
    openLayers.delete(slot);
  }
  for (const listener of [...layerListeners]) listener();
  return open;
}

/** Re-render the calling component when any layer opens or closes. */
function useLayerState() {
  const [, bump] = useState(0);
  useEffect(() => {
    const listener = () => bump((value) => value + 1);
    layerListeners.add(listener);
    return () => {
      layerListeners.delete(listener);
    };
  }, []);
}

/**
 * The plugin's one host interaction: a button that dispatches `ui.toast` and
 * prints the answer — `toast sent`, or the refusal code. It is shown instead of
 * swallowed, which is what keeps an undeclared or unrouted action legible
 * (ADR 0294 decision 2).
 */
function HostToastButton({ dispatch, message, label = "Notify the host" }) {
  const [status, setStatus] = useState(null);
  const notify = () => {
    if (typeof dispatch !== "function") {
      setStatus("no dispatch prop");
      return;
    }
    setStatus("asking...");
    dispatch("ui.toast", { message, variant: "info" })
      .then(() => setStatus("toast sent"))
      .catch((error) => setStatus(error?.code ?? String(error)));
  };
  return createElement("span", { className: "acme-plugin-showcase__action" }, [
    createElement(
      "button",
      {
        key: "button",
        type: "button",
        className: "acme-plugin-showcase__button",
        "data-pi-showcase-action": "ui.toast",
        onClick: notify,
      },
      label,
    ),
    status
      ? createElement(
          "span",
          { key: "status", className: "acme-plugin-showcase__muted" },
          status,
        )
      : null,
  ]);
}

/**
 * `entry`: the whole-message position.
 *
 * The host draws a registration *instead of* the message it would otherwise
 * render — bubble and actions alike — and hands this component the same
 * `{ entry, sessionId }` shape `entryExtra` gets. The entry is a shape, not the
 * message text, so this component cannot re-draw the host's bubble; it states
 * what it is standing in for instead of pretending. Every prop is read
 * defensively: the host may mount a slot before the data a plugin declared is
 * ready.
 */
function EntryCard({ entry, sessionId, dispatch }) {
  const facts = entryFacts(entry);
  return createElement("div", { className: "acme-plugin-showcase__card", "data-pi-showcase-slot": "entry" }, [
    createElement(
      "span",
      { key: "title", className: "acme-plugin-showcase__card-title" },
      `${PLUGIN_ID} · entry`,
    ),
    createElement(
      "span",
      { key: "what", className: "acme-plugin-showcase__line" },
      `this registration replaced the host's own row for a ${facts.role} message (${facts.id}` +
        (facts.attributedTo ? `, added by ${facts.attributedTo}` : "") +
        ").",
    ),
    createElement(
      "span",
      { key: "session", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
      sessionId ? `session ${sessionId}` : "no session id in props",
    ),
    createElement(
      "span",
      { key: "hint", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
      "The host's bubble, attachments and actions are not drawn while this slot is registered; unload the plugin to get them back.",
    ),
    createElement(HostToastButton, {
      key: "notify",
      dispatch,
      message: `${PLUGIN_ID} · entry slot · message ${facts.id}`,
      label: "Send a toast from the entry slot",
    }),
  ]);
}

/**
 * `entryExtra`: one extra block below a transcript entry.
 *
 * Everything this component gets arrives as a prop: the slot's data as `entry`
 * (the `{ id, role }` of the row the badge sits under, plus `pluginId` when the
 * host attributed the row to a plugin), and `dispatch(action, payload)`. No
 * prop is guaranteed — the host may mount a slot before the data a plugin
 * declared is ready — so the badge reads through `entryFacts`, which tolerates a
 * missing entry exactly the way any React component tolerates a missing prop.
 */
function EntryExtraCard({ entry, dispatch }) {
  const facts = entryFacts(entry);
  return createElement("span", { className: "acme-plugin-showcase__badge" }, [
    `${PLUGIN_ID} · entryExtra`,
    createElement(
      "span",
      { key: "facts", className: "acme-plugin-showcase__muted" },
      facts.attributedTo
        ? `${facts.role} · ${facts.id} · added by ${facts.attributedTo}`
        : `${facts.role} · ${facts.id}`,
    ),
    // The value below is what the registered function returned. A host position
    // that needs a synchronous answer calls exactly this function, in this
    // realm, while it renders (ADR 0294 decision 6).
    createElement(
      "span",
      { key: "fn", className: "acme-plugin-showcase__muted" },
      `fn entry-facts() → ${facts.role}`,
    ),
    createElement(HostToastButton, {
      key: "notify",
      dispatch,
      message: `${PLUGIN_ID} · ${facts.role} entry ${facts.id}`,
    }),
  ]);
}

/**
 * `toolCard`: the card body of this plugin's own tool.
 *
 * The host asks a plugin to draw this position only for a tool row whose forced
 * prefix names that plugin (D015), and it hands over the row as
 * `{ entry, sessionId }` with `entry.pluginId` set to the owner. The component
 * checks that attribution anyway, because "the host only offers me my own rows"
 * is a contract worth making visible rather than assuming.
 */
function ToolCard({ entry, sessionId, dispatch }) {
  const facts = entryFacts(entry);
  const owned = facts.attributedTo === PLUGIN_ID;
  return createElement("div", { className: "acme-plugin-showcase__card", "data-pi-showcase-slot": "toolCard" }, [
    createElement(
      "span",
      { key: "title", className: "acme-plugin-showcase__card-title" },
      `${PLUGIN_ID} · toolCard`,
    ),
    createElement(
      "span",
      { key: "owner", className: "acme-plugin-showcase__line" },
      owned
        ? `this is the plugin's own tool row (${facts.id}), so the host offered it its card body instead of its detail blocks.`
        : `not this plugin's tool row (owner: ${facts.attributedTo ?? "unknown"}); the host does not offer the position for it.`,
    ),
    createElement(
      "span",
      { key: "session", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
      sessionId ? `session ${sessionId}` : "no session id in props",
    ),
    createElement(HostToastButton, {
      key: "notify",
      dispatch,
      message: `${PLUGIN_ID} · toolCard for ${facts.id}`,
      label: "Send a toast from the tool card",
    }),
  ]);
}

/**
 * `inlineConfirm`: the host's inline-confirmation position, taken by the
 * plugin's own card while the registration is up.
 *
 * It is deliberately opened on demand. The host mounts this position only while
 * a permission request is pending and draws the host's own permission card
 * there when no plugin holds it, so a registration at load would replace the
 * user's approval UI. The card says so and closes itself by removing the
 * registration, which is the one action this component needs.
 */
function InlineConfirmCard({ sessionId }) {
  useLayerState();
  return createElement("div", { className: "acme-plugin-showcase__card", "data-pi-showcase-slot": "inlineConfirm" }, [
    createElement(
      "span",
      { key: "title", className: "acme-plugin-showcase__card-title" },
      `${PLUGIN_ID} · inlineConfirm`,
    ),
    createElement(
      "span",
      { key: "what", className: "acme-plugin-showcase__line" },
      "A plugin card at the host's inline-confirmation position. While this registration is up, the host's own permission request card is not drawn here.",
    ),
    createElement(
      "span",
      { key: "limit", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
      "The slot gives this component a session id and nothing else, so it cannot approve or deny the request: close it to bring the host's card back.",
    ),
    createElement(
      "span",
      { key: "session", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
      sessionId ? `session ${sessionId}` : "no session id in props",
    ),
    createElement(
      "button",
      {
        key: "close",
        type: "button",
        className: "acme-plugin-showcase__button",
        "data-pi-showcase-close": "inlineConfirm",
        onClick: () => setLayerOpen("inlineConfirm", false),
      },
      "Close this card (removes its registration)",
    ),
  ]);
}

/**
 * `modal`: a blocking, app-level dialog. The host owns the scrim and the
 * blocking; the plugin owns this box. Escape is the host's dismissal of a
 * plugin layer (it hides the layer without touching the plugin's own state),
 * and this button withdraws the registration for good.
 */
function ModalCard({ sessionId }) {
  useLayerState();
  return createElement(
    "div",
    {
      className: "acme-plugin-showcase__layer-card",
      "data-pi-showcase-slot": "modal",
      role: "dialog",
      "aria-label": `${PLUGIN_ID} modal demo`,
    },
    [
      createElement(
        "span",
        { key: "title", className: "acme-plugin-showcase__card-title" },
        `${PLUGIN_ID} · modal`,
      ),
      createElement(
        "span",
        { key: "what", className: "acme-plugin-showcase__line" },
        "This layer is on screen because this plugin registered a component for the modal position; it is blocking because the host adds its own scrim (D8-like: the host's decision, not the plugin's).",
      ),
      createElement(
        "span",
        { key: "session", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
        sessionId ? `session ${sessionId}` : "no session id in props",
      ),
      createElement(
        "button",
        {
          key: "close",
          type: "button",
          className: "acme-plugin-showcase__button",
          "data-pi-showcase-close": "modal",
          onClick: () => setLayerOpen("modal", false),
        },
        "Close the modal (Escape does the same)",
      ),
    ],
  );
}

/**
 * `overlay`: a transient in-window layer. It does not block: only this box
 * takes the pointer, and the rest of the window stays usable underneath it.
 */
function OverlayCard({ sessionId }) {
  useLayerState();
  return createElement(
    "div",
    {
      className: "acme-plugin-showcase__layer-card is-overlay",
      "data-pi-showcase-slot": "overlay",
      role: "status",
    },
    [
      createElement(
        "span",
        { key: "title", className: "acme-plugin-showcase__card-title" },
        `${PLUGIN_ID} · overlay`,
      ),
      createElement(
        "span",
        { key: "what", className: "acme-plugin-showcase__line" },
        "A non-blocking layer: only this box takes the pointer.",
      ),
      createElement(
        "span",
        { key: "session", className: "acme-plugin-showcase__line acme-plugin-showcase__muted" },
        sessionId ? `session ${sessionId}` : "no session id in props",
      ),
      createElement(
        "button",
        {
          key: "close",
          type: "button",
          className: "acme-plugin-showcase__button",
          "data-pi-showcase-close": "overlay",
          onClick: () => setLayerOpen("overlay", false),
        },
        "Close the overlay (Escape does the same)",
      ),
    ],
  );
}

/**
 * `composerControl`: one registration, two control rows.
 *
 * The host mounts the same registration at the end of the composer's left row
 * and at the end of its right row, and hands it `{ position, draft, sessionId? }`.
 * The component decides for itself which row it draws in and returns `null` for
 * the other, which leaves no hole. The draft is read-only; the host's own
 * controls stay where they are (D8). These buttons control this plugin's own
 * layer registrations, which is something a composer control can really do
 * today.
 */
function ComposerControl({ position, draft, sessionId }) {
  useLayerState();
  const draftLength = typeof draft === "string" ? draft.length : 0;
  const sessionNote = sessionId ? `session ${sessionId}` : "no session yet";
  if (position === "left") {
    const open = openLayers.has("inlineConfirm");
    return createElement(
      "button",
      {
        type: "button",
        className: "acme-plugin-showcase__button",
        "data-pi-showcase-trigger": "inlineConfirm",
        title:
          `Showcase demo · left composer position · draft ${draftLength} char(s) · ${sessionNote}. ` +
          "While this registration is up it takes the host's inline-confirmation position.",
        onClick: () => setLayerOpen("inlineConfirm", !open),
      },
      open ? "Showcase: close inline card" : "Showcase: inline card",
    );
  }
  if (position === "right") {
    const modalOpen = openLayers.has("modal");
    const overlayOpen = openLayers.has("overlay");
    return createElement("span", { className: "acme-plugin-showcase__row" }, [
      createElement(
        "button",
        {
          key: "modal",
          type: "button",
          className: "acme-plugin-showcase__button",
          "data-pi-showcase-trigger": "modal",
          title:
            `Showcase demo · right composer position · draft ${draftLength} char(s) · ${sessionNote}. ` +
            "Registration is what puts the modal layer on screen.",
          onClick: () => setLayerOpen("modal", !modalOpen),
        },
        modalOpen ? "Showcase: close modal" : "Showcase: modal",
      ),
      createElement(
        "button",
        {
          key: "overlay",
          type: "button",
          className: "acme-plugin-showcase__button",
          "data-pi-showcase-trigger": "overlay",
          title:
            `Showcase demo · right composer position · draft ${draftLength} char(s) · ${sessionNote}. ` +
            "Registration is what puts the overlay layer on screen.",
          onClick: () => setLayerOpen("overlay", !overlayOpen),
        },
        overlayOpen ? "Showcase: close overlay" : "Showcase: overlay",
      ),
    ]);
  }
  return null;
}

/**
 * `completionSource`: candidate rows inside the composer's completion popover.
 *
 * The host mounts this position inside the open popover, below its own command
 * or file rows, and hands it `{ mode, query }`. It is a candidate source, not a
 * filter: the host's rows keep their order, and the keyboard highlight and
 * `Enter`/`Tab` acceptance stay host-owned — a plugin row carries its own
 * activation. This one has none to offer: nothing in the interface inserts a
 * candidate into the draft yet, so the rows say exactly that instead of looking
 * selectable.
 */
function CompletionSource({ mode, query }) {
  const text = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!text || (mode !== "slash" && mode !== "file")) return null;
  const names =
    mode === "slash"
      ? ["showcase-inline", "showcase-modal", "showcase-overlay"].filter((name) =>
          name.startsWith(text),
        )
      : text.startsWith("acme") || "acme".startsWith(text)
        ? ["acme"]
        : [];
  if (!names.length) return null;
  return createElement(
    "span",
    { className: "acme-plugin-showcase__completion", "data-pi-showcase-slot": "completionSource" },
    [
      createElement(
        "span",
        { key: "head", className: "acme-plugin-showcase__muted" },
        `${PLUGIN_ID} · completionSource (${mode}) · modelled candidates for "${text}"`,
      ),
      ...names.map((name) =>
        createElement(
          "span",
          {
            key: name,
            className: "acme-plugin-showcase__row",
            "data-pi-showcase-candidate": name,
            "aria-disabled": "true",
          },
          mode === "slash"
            ? `/${name} — demo row: it cannot insert a command into the draft yet`
            : `@${name} — demo row: it cannot add a reference to the draft yet`,
        ),
      ),
    ],
  );
}

/**
 * `composerReference`: this plugin's own chip beside the composer's chips.
 *
 * The host paints its own chips inside the editor, so this position sits after
 * the editor: a plugin chip follows every host chip. The list is read-only and
 * the chip is a React element, not an atomic editor token — it cannot add a
 * reference to the draft, remove a host chip, or change what the draft sends.
 * It reads the props it was handed and says what it sees.
 */
function ComposerReference({ references, draft, sessionId }) {
  const chips = Array.isArray(references) ? references : [];
  const draftLength = typeof draft === "string" ? draft.length : 0;
  const names = chips
    .map((chip) => (chip && typeof chip.name === "string" ? chip.name : ""))
    .filter(Boolean);
  return createElement(
    "span",
    {
      className: "acme-plugin-showcase__chip",
      "data-pi-showcase-slot": "composerReference",
      "data-pi-showcase-reference-count": chips.length,
      title:
        `${PLUGIN_ID} chip · the draft holds ${chips.length} host reference(s) and ${draftLength} character(s)` +
        (sessionId ? ` in session ${sessionId}` : " with no session yet") +
        ". This chip is a React element beside the editor, not an atomic editor token: it cannot add a reference to the draft or remove a host chip.",
    },
    [
      createElement("span", { key: "label" }, `${PLUGIN_ID} chip`),
      createElement(
        "span",
        { key: "count", className: "acme-plugin-showcase__muted" },
        `${chips.length} ref · ${draftLength} ch`,
      ),
      names.length
        ? createElement(
            "span",
            { key: "names", className: "acme-plugin-showcase__muted" },
            names.slice(0, 3).join(", "),
          )
        : null,
    ],
  );
}

/**
 * `codeBlock`: the renderer for the fenced language this plugin claimed.
 *
 * The host hands it `{ language, code, isIncomplete, theme }` and only mounts it
 * for a closed, in-limit block, so `isIncomplete` is always `false` here. The
 * block has no way out to the host at all — it draws what it was given — which
 * is why it is a good place to show a host-callable function being read.
 */
function KeyValueBlock({ language, code }) {
  const rows = kvRows(code);
  return createElement(
    "span",
    { className: "acme-plugin-showcase__kv" },
    [
      createElement(
        "span",
        { key: "head", className: "acme-plugin-showcase__kv-head" },
        `${PLUGIN_ID} draws fenced ${language} · fn kv-rows() → ${rows.length} row(s)`,
      ),
      ...rows.map((row, index) =>
        createElement(
          "span",
          {
            key: `row-${index}`,
            className: row.flagged
              ? "acme-plugin-showcase__kv-row acme-plugin-showcase__kv-flagged"
              : "acme-plugin-showcase__kv-row",
          },
          [
            createElement(
              "span",
              { key: "key", className: "acme-plugin-showcase__kv-key" },
              row.key,
            ),
            createElement("span", { key: "value" }, row.value),
          ],
        ),
      ),
    ],
  );
}

/**
 * Required by the host. There is no `onUnload` here on purpose: the host removes
 * every slot registration, every registered function and the injected sheet when
 * the plugin is unloaded, disabled, or uninstalled (D10), so a plugin that only
 * registers slots and functions has nothing to clean up.
 */
export function onLoad(pi) {
  // A reload re-runs `onLoad` on the module instance the module cache kept, and
  // the host already reclaimed the previous load's registrations on unload, so
  // any handle left in `openLayers` is stale.
  openLayers.clear();
  hostApi = pi;
  pi.ui.injectStyle(STYLES);
  // The two host-callable functions. Names are unique inside this plugin and
  // must match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`.
  pi.functions.register("entry-facts", entryFacts);
  pi.functions.register("kv-rows", kvRows);
  pi.slots.register("entry", EntryCard);
  pi.slots.register("entryExtra", EntryExtraCard);
  // `codeBlock` carries the language it claims; every other slot takes no
  // options.
  pi.slots.register("codeBlock", KeyValueBlock, { language: CODE_LANGUAGE });
  pi.slots.register("toolCard", ToolCard);
  pi.slots.register("composerControl", ComposerControl);
  pi.slots.register("completionSource", CompletionSource);
  pi.slots.register("composerReference", ComposerReference);
  // The three layer positions are registered on demand by the composer controls
  // above, never here: `LAYER_SLOTS` is the list a reader (and the smoke test)
  // can compare against what is actually open.
  void LAYER_SLOTS;
}
