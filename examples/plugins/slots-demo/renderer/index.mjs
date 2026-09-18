/**
 * Renderer half of the slots demo (ADR 0287, spec 07-plugins/16 §2A).
 *
 * The host fetches this file from
 * `plugin-renderer://acme.slots-demo/renderer/index.mjs` and evaluates it inside
 * the app's own window, lazily: the first time one of its slots actually
 * renders. It is a plain ES module with no build step — the host serves `mjs`
 * from the plugin package and needs no bundler to read it.
 *
 * `react` is a bare specifier on purpose. The host installs an import map that
 * points `react`, `react-dom`, and `react-dom/client` at its own copies, and
 * every plugin shares that one instance. A plugin that ships its own React is
 * refused at load, because two copies break hooks and context.
 */
import { createElement, useState } from "react";

const PLUGIN_ID = "acme.slots-demo";

/**
 * Injected through `pi.ui.injectStyle`. Every selector is namespaced with the
 * plugin id and stays inside the host's `data-pi-plugin="acme.slots-demo"`
 * container: a sheet whose top-level selector is `html`, `body`, `:root`, or `*`
 * is refused whole rather than silently narrowed.
 *
 * No host design token is referenced here. An injected sheet is the plugin's own
 * CSS; the host does not promise its token names to plugins, so this uses
 * `currentColor` and nothing theme-specific.
 */
const STYLES = `
.acme-slots-demo__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid currentColor;
  border-radius: 999px;
  font-size: 0.75rem;
  line-height: 1.6;
  opacity: 0.75;
}

.acme-slots-demo__card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-width: 24rem;
  padding: 1rem;
  border: 1px solid currentColor;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  line-height: 1.5;
}

.acme-slots-demo__button {
  align-self: flex-start;
  padding: 0.25rem 0.75rem;
  border: 1px solid currentColor;
  border-radius: 0.5rem;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
`;

/**
 * `entryExtra`: one extra block below a transcript entry. The slot is
 * component-only, so this needs no other API — and it tolerates missing props,
 * like any React component the host might render before its data is ready.
 */
function EntryExtraBadge() {
  return createElement(
    "span",
    { className: "acme-slots-demo__badge" },
    `${PLUGIN_ID} · renderer slot`,
  );
}

/**
 * `modal`: a blocking, app-level dialog. The counter is the point of the
 * example — `useState` comes from the host's React, so a hook used here behaves
 * exactly as it does in host UI, and nothing is duplicated to make that work.
 */
function SlotsDemoModal() {
  const [renders, setRenders] = useState(0);

  return createElement("div", { className: "acme-slots-demo__card" }, [
    createElement(
      "p",
      { key: "title" },
      `${PLUGIN_ID} is running inside the host renderer`,
    ),
    createElement(
      "p",
      { key: "state" },
      `Re-renders through the host's React: ${renders}.`,
    ),
    createElement(
      "button",
      {
        key: "button",
        type: "button",
        className: "acme-slots-demo__button",
        onClick: () => setRenders((value) => value + 1),
      },
      "Re-render",
    ),
  ]);
}

/**
 * Required by the host. There is no `onUnload` here on purpose: the host removes
 * every registration and the injected sheet when the plugin is unloaded,
 * disabled, or uninstalled, so a plugin that only registers slots has nothing to
 * clean up (D10).
 */
export function onLoad(pi) {
  pi.ui.injectStyle(STYLES);
  pi.slots.register("entryExtra", EntryExtraBadge);
  pi.slots.register("modal", SlotsDemoModal);
}
