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
 * The renderer half of this example shows the three parts of that interface:
 *
 *   `entryExtra` — a component per transcript entry, reading the `entry` data
 *     the host hands it and dispatching `ui.toast`.
 *   `codeBlock`  — a component that owns one fenced language, namespaced with
 *     this plugin's id so it cannot shadow `json`, `ts` or `mermaid`.
 *   `pi.functions.register` — a pure, synchronous function the host may call
 *     *while it renders* (ADR 0294 decision 6), registered here so the shape is
 *     visible next to the slot that reads it.
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
import { createElement, useState } from "react";

const PLUGIN_ID = "acme.plugin-showcase";

/**
 * The one fenced language this plugin claims. A `codeBlock` language is the
 * slot's identity — one language has exactly one renderer — and it has to be
 * namespaced with the registering plugin's own id, which is what
 * `acme.plugin-showcase:kv` is.
 */
const CODE_LANGUAGE = `${PLUGIN_ID}:kv`;

/**
 * Injected through `pi.ui.injectStyle`. Every selector is namespaced with the
 * plugin id and stays inside the host's `data-pi-plugin="acme.plugin-showcase"`
 * container: a sheet whose top-level selector is `html`, `body`, `:root`, or
 * `*` is refused whole rather than silently narrowed.
 *
 * No host design token is referenced here. An injected sheet is the plugin's
 * own CSS; the host does not promise its token names to plugins, so this uses
 * `currentColor` and nothing theme-specific.
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
 * This function is the whole reason the badge below can show anything about its
 * entry: the host never hands a component the host API, so a value that has to
 * be derived is derived here, in a function the host also knows about.
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
  const [status, setStatus] = useState(null);
  const facts = entryFacts(entry);

  /**
   * `ui.toast` is the one action this manifest declares in `rendererActions`,
   * so the host runs it against its own UI and answers. A dispatch is a promise:
   * it resolves once the host is done and rejects with a structured error when
   * the action is not declared (`error.code` is `PLUGIN_ACTION_UNDECLARED`) or
   * the host has no handler for it (`PLUGIN_ACTION_UNROUTED`). The rejection is
   * shown right here, because swallowing it would make that refusal look like a
   * broken button.
   */
  const notifyHost = () => {
    setStatus("asking...");
    dispatch("ui.toast", {
      message: `${PLUGIN_ID} · ${facts.role} entry ${facts.id}`,
      variant: "info",
    })
      .then(() => setStatus("toast sent"))
      .catch((error) => setStatus(error?.code ?? String(error)));
  };

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
    createElement(
      "button",
      {
        key: "notify",
        type: "button",
        className: "acme-plugin-showcase__button",
        onClick: notifyHost,
      },
      "Notify the host",
    ),
    status ? createElement("span", { key: "status" }, status) : null,
  ]);
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
  pi.ui.injectStyle(STYLES);
  // The two host-callable functions. Names are unique inside this plugin and
  // must match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$`.
  pi.functions.register("entry-facts", entryFacts);
  pi.functions.register("kv-rows", kvRows);
  pi.slots.register("entryExtra", EntryExtraCard);
  // `codeBlock` carries the language it claims; every other slot takes no
  // options.
  pi.slots.register("codeBlock", KeyValueBlock, { language: CODE_LANGUAGE });
}
