/**
 * Style injection for renderer slot plugins (`slot-contract.html` §4).
 *
 * The host's promise is: a sheet a plugin injects is removed when the plugin
 * unloads, with nothing left behind. Scoping is best-effort — the contract
 * records "样式重写可被绕过" as an accepted cost, so the host does not police
 * selectors; it tags every sheet with the plugin that owns it.
 */

type InjectedSheet = {
  pluginId: string;
  element: HTMLStyleElement;
};

const sheets: InjectedSheet[] = [];

export type PluginStyleHandle = {
  remove(): void;
};

function removeSheet(sheet: InjectedSheet): void {
  sheet.element.remove();
  const index = sheets.indexOf(sheet);
  if (index >= 0) sheets.splice(index, 1);
}

/** Inject one stylesheet owned by `pluginId`. Returns a removal handle. */
export function injectStyle(pluginId: string, css: string): PluginStyleHandle {
  const element = document.createElement("style");
  element.setAttribute("data-pi-plugin", pluginId);
  element.textContent = css;
  document.head.appendChild(element);
  const sheet: InjectedSheet = { pluginId, element };
  sheets.push(sheet);
  return {
    remove: () => {
      removeSheet(sheet);
    },
  };
}

/** 卸载摘样式: drop every sheet one plugin injected. */
export function removePluginStyles(pluginId: string): void {
  for (const sheet of [...sheets]) {
    if (sheet.pluginId === pluginId) removeSheet(sheet);
  }
}
