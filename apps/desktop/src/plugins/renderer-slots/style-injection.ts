/**
 * Style isolation for trusted-renderer plugins (ADR 0291).
 *
 * Shadow DOM was rejected: the shell portals 41 call sites across 18 files, so
 * a shadow root would break host portals long before it contained a hostile
 * plugin.
 * Instead every plugin stylesheet goes through this module, which owns the
 * element, namespaces it with the plugin id, and removes it on unload.
 *
 * A sheet that reaches for the host's own roots is refused outright rather than
 * narrowed: silently rewriting a plugin's CSS would make its author debug a
 * layout that is not the one being served.
 */
import { PLUGIN_STYLE_FORBIDDEN_ROOT_SELECTORS } from "@pi-desktop/plugin-sdk";

const STYLE_ATTRIBUTE = "data-pi-plugin-style";

/**
 * The first selector that reaches past the plugin's container, or null when the
 * sheet stays inside it.
 *
 * This is a scanner, not a CSS parser: it strips comments, then looks at every
 * selector segment (the text between a `}`/`;`/start and the next `{`) and
 * checks each comma-separated part on its own. Nested blocks inside `@media`
 * are checked too, which is stricter than top-level-only and is the point —
 * `@media (min-width: 600px) { html { … } }` reaches just as far.
 */
export function forbiddenSelector(css: string): string | null {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Every selector segment, including the nested ones inside `@media`, because
  // a nested block reaches exactly as far as a top-level one.
  // Walk every block, not just the outermost one: a rule nested in `@media`
  // reaches exactly as far as a top-level rule, so `@media (…) { html { … } }`
  // has to be inspected too. The selector runs from the last block, declaration
  // or brace boundary to this `{`.
  for (let brace = withoutComments.indexOf("{"); brace >= 0; brace = withoutComments.indexOf("{", brace + 1)) {
    const start = Math.max(
      withoutComments.lastIndexOf("}", brace - 1),
      withoutComments.lastIndexOf("{", brace - 1),
      withoutComments.lastIndexOf(";", brace),
    );
    const selectorText = withoutComments.slice(start + 1, brace);
    if (!selectorText.trim()) continue;
    if (selectorText.trimStart().startsWith("@")) continue;
    for (const part of selectorText.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      for (const root of PLUGIN_STYLE_FORBIDDEN_ROOT_SELECTORS) {
        // `html` matches `html` and `html > body`, but never `.html-widget`.
        const pattern = new RegExp(`^${root.replace(/[*:]/g, "\\$&")}(?![\\w-])`, "i");
        if (pattern.test(trimmed)) return trimmed;
      }
    }
  }
  return null;
}

export type PluginStyleHandle = { remove(): void };

/**
 * Inject a plugin's stylesheet under the given plugin id. Throws a
 * `PLUGIN_STYLE_REFUSED` error when the sheet targets a host root, so the
 * caller can report it instead of shipping half a stylesheet.
 */
export function injectPluginStyle(pluginId: string, css: string): PluginStyleHandle {
  const forbidden = forbiddenSelector(css);
  if (forbidden) {
    const error = new Error(
      `PLUGIN_STYLE_REFUSED: ${JSON.stringify(forbidden)} targets a host root`,
    ) as Error & { code?: string };
    error.code = "PLUGIN_STYLE_REFUSED";
    throw error;
  }
  const element = document.createElement("style");
  element.setAttribute(STYLE_ATTRIBUTE, pluginId);
  element.textContent = css;
  document.head.appendChild(element);
  return {
    remove: () => {
      element.remove();
    },
  };
}

/** Drop every sheet a plugin owns. Safe to call when it never injected any. */
export function removePluginStyles(pluginId: string): void {
  for (const element of document.querySelectorAll(`style[${STYLE_ATTRIBUTE}="${pluginId}"]`)) {
    element.remove();
  }
}
