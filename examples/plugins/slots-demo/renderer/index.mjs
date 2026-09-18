/**
 * Renderer half of the slots demo (ADR 0287, spec 07-plugins/16 §2A).
 *
 * The host fetches this file from
 * `plugin-renderer://acme.slots-demo/renderer/index.mjs` and evaluates it inside
 * the app's own window, lazily: the first time one of its slots actually
 * renders. It is a plain ES module with no build step — the host serves `mjs`
 * from the plugin package and needs no bundler to read it.
 *
 * A slot component is handed exactly two things: the slot's host data as props,
 * and `dispatch(action, payload)` — the plugin's one way to ask the host to do
 * something (ADR 0290). `dispatch` acts for `acme.slots-demo`, and it accepts
 * only the actions this manifest lists in `rendererActions`: an action the
 * plugin did not declare is refused with a structured error
 * (`PLUGIN_ACTION_UNDECLARED`) instead of being silently ignored.
 *
 * The two actions it declares are the two classes the host relays: `ui.toast`
 * is performed by the host itself, and `plugin.call` is forwarded to this
 * plugin's own headless entry (`main.js`), which answers. The badge's second
 * button is that round trip, and the value it shows came out of the plugin's
 * own process — the window could not have produced it.
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

/*
 * The entry's answer is printed verbatim, so it can be long: it stays inside
 * the badge instead of stretching the row.
 */
.acme-slots-demo__call-result {
  max-width: 24rem;
  overflow-wrap: anywhere;
  opacity: 0.9;
}
`;

/**
 * `entryExtra`: one extra block below a transcript entry.
 *
 * Everything this component gets arrives as a prop. The slot's data comes in as
 * `entry` — the `{ id, role }` of the row the badge sits under — and the
 * plugin's one way out to the host comes in as `dispatch(action, payload)`
 * (ADR 0290). Nothing is ambient and nothing is guaranteed: the host may mount
 * a slot before the data a plugin declared is ready, so this reads `entry?.id`
 * and falls back, the way any React component tolerates a missing prop.
 */
function EntryExtraBadge({ entry, dispatch }) {
  const [status, setStatus] = useState(null);
  const [forwarded, setForwarded] = useState(null);

  /**
   * `ui.toast` is one of the actions this manifest declares in
   * `rendererActions`, so the host runs it and answers. A dispatch is a promise:
   * it resolves once the host is done, and it rejects with a structured error
   * when the action is not declared (`error.code` is `PLUGIN_ACTION_UNDECLARED`)
   * — a refusal, never a silent no-op. The rejection is shown right here,
   * because swallowing it would make that refusal look like a broken button.
   */
  const notifyHost = () => {
    setStatus("asking...");
    dispatch("ui.toast", {
      message: `${PLUGIN_ID} · entry ${entry?.id ?? "unknown"}`,
    })
      .then(() => setStatus("toast sent"))
      .catch((error) => setStatus(error?.code ?? String(error)));
  };

  /**
   * `plugin.call` is the other class of action: the host forwards
   * `{ method, args }` to this plugin's own headless entry — the same child
   * channel a panel call uses — and this promise resolves with whatever that
   * entry returned. `demo.echo` answers with the arguments it was handed plus a
   * counter that lives in that process, so what the button shows is a value the
   * window could not have produced by itself.
   *
   * Every refusal arrives the same way, as `error.code`: an action the manifest
   * does not declare (`PLUGIN_ACTION_UNDECLARED`), a plugin with no headless
   * entry (`PLUGIN_CALL_NO_ENTRY`), an entry that implements no renderer methods
   * (`PLUGIN_CALL_NO_HANDLER`), or a call that never answered
   * (`PLUGIN_CALL_TIMEOUT`). Showing that code instead of a tick is what makes
   * this example honest about which half ran.
   */
  const askHeadless = () => {
    setForwarded("asking...");
    dispatch("plugin.call", { method: "demo.echo", args: { from: "badge" } })
      .then((answer) =>
        setForwarded(
          `entry ${answer?.entry} answered call #${answer?.calls}: ${JSON.stringify(answer)}`,
        ),
      )
      .catch((error) => setForwarded(error?.code ?? String(error)));
  };

  return createElement("span", { className: "acme-slots-demo__badge" }, [
    `${PLUGIN_ID} · renderer slot`,
    createElement(
      "button",
      {
        key: "notify",
        type: "button",
        className: "acme-slots-demo__button",
        onClick: notifyHost,
      },
      "Notify the host",
    ),
    createElement(
      "button",
      {
        key: "headless",
        type: "button",
        className: "acme-slots-demo__button acme-slots-demo__call",
        onClick: askHeadless,
      },
      "Ask the entry",
    ),
    status ? createElement("span", { key: "status" }, status) : null,
    forwarded
      ? createElement(
          "span",
          { key: "forwarded", className: "acme-slots-demo__call-result" },
          forwarded,
        )
      : null,
  ]);
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
