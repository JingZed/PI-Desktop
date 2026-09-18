/**
 * The renderer-side loader for trusted plugin modules (ADR 0287).
 *
 * Loading is lazy (D6 + ADR 0287 decision 5): nothing is fetched until a slot a
 * plugin might fill is actually rendered. That keeps a plugin that never draws
 * anything from costing an evaluation, and it keeps the application start free
 * of plugin code.
 *
 * Every failure path ends in a diagnostic rather than silence: a plugin author
 * who sees nothing on screen has to be able to find out which of the four gates
 * refused them — no declared entry, no permission, a module that does not
 * export `onLoad`, or a module that threw.
 */
import {
  PLUGIN_RENDERER_SCHEME,
  type PiRendererApi,
  type PiRendererModule,
  type PiRendererSlotOptions,
  type PiRendererStyleHandle,
  type PluginRendererSlot,
} from "@pi-desktop/plugin-sdk";
import { api } from "../../lib/api";
import { pluginSlots } from "../renderer-slots/registry";
import { injectPluginStyle, removePluginStyles } from "../renderer-slots/style-injection";
import { installRendererImportMap } from "./react-shim";

/** One entry per plugin: in flight or settled, so a slot never loads twice. */
const attempts = new Map<string, Promise<void>>();

const modules = new Map<string, PiRendererModule>();

/** `plugin-renderer://<pluginId>/<path>`, path segments encoded individually. */
export function rendererEntryUrl(pluginId: string, entry: string): string {
  const clean = entry.replace(/^\.\//, "").replace(/\\/g, "/");
  const encoded = clean
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${PLUGIN_RENDERER_SCHEME}://${pluginId}/${encoded}`;
}

/**
 * The object a plugin's `onLoad` receives. It is the whole surface: there is no
 * `pi` global and no bridge, so a plugin gets slots, styles and its own id, and
 * nothing else the shell can reach.
 */
function buildApi(pluginId: string, version: string): PiRendererApi {
  const styles = new Set<PiRendererStyleHandle>();
  return {
    plugin: { id: pluginId, version },
    slots: {
      register<Props>(
        slot: PluginRendererSlot,
        component: (props: Props) => unknown,
        options?: PiRendererSlotOptions,
      ): ReturnType<PiRendererApi["slots"]["register"]> {
        const handle = pluginSlots.register(pluginId, slot, component, options);
        if (!handle) {
          // `register` already reported why; returning a no-op handle would
          // only invite the plugin to think it succeeded.
          throw Object.assign(new Error("PLUGIN_SLOT_INVALID_COMPONENT"), {
            code: "PLUGIN_SLOT_INVALID_COMPONENT",
          });
        }
        return {
          slot,
          remove: () => {
            handle.remove();
          },
        };
      },
    },
    ui: {
      injectStyle(css: string): PiRendererStyleHandle {
        const handle = injectPluginStyle(pluginId, css);
        styles.add(handle);
        return {
          remove: () => {
            styles.delete(handle);
            handle.remove();
          },
        };
      },
    },
  };
}

/** True while a plugin's module is loaded and its slots are live. */
export function isRendererPluginLoaded(pluginId: string): boolean {
  return modules.has(pluginId);
}

/**
 * Load one plugin's renderer entry, once. `declared` is the plugin row's own
 * answer — a plugin that never declared `renderer` is skipped here and reported
 * rather than fetched, which is the host side of D12.
 */
export function ensureRendererPlugin(
  pluginId: string,
  options: { declared: boolean; version?: string },
): Promise<void> {
  const inFlight = attempts.get(pluginId);
  if (inFlight) return inFlight;
  const attempt = load(pluginId, options);
  attempts.set(pluginId, attempt);
  return attempt;
}

async function load(pluginId: string, options: { declared: boolean; version?: string }): Promise<void> {
  if (!options.declared) {
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_SLOT_NOT_DECLARED",
      detail: "the manifest declares no renderer entry, so it cannot own a slot",
    });
    return;
  }
  let entry: string | null = null;
  try {
    entry = (await api.pluginRendererEntry(pluginId)).entry;
  } catch (error) {
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_SLOT_LOAD_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  if (!entry) {
    // Declared, but the host is not serving it: no `renderer.extension` grant,
    // or the plugin is no longer loaded. Both are answers, not accidents.
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_SLOT_NOT_DECLARED",
      detail: "no renderer entry is being served for this plugin",
    });
    return;
  }
  installRendererImportMap();
  let namespace: Record<string, unknown>;
  try {
    // The scheme is host-owned and served by the main process, so this is a
    // fetch of the plugin's own package rather than an arbitrary URL.
    namespace = (await import(/* @vite-ignore */ rendererEntryUrl(pluginId, entry))) as Record<
      string,
      unknown
    >;
  } catch (error) {
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_SLOT_LOAD_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  const module = (namespace.default ?? namespace) as PiRendererModule;
  if (typeof module?.onLoad !== "function") {
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_INVALID: renderer entry must export onLoad",
      detail: entry,
    });
    return;
  }
  try {
    await module.onLoad(buildApi(pluginId, options.version ?? ""));
  } catch (error) {
    pluginSlots.report({
      pluginId,
      code: "PLUGIN_SLOT_LOAD_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  modules.set(pluginId, module);
}

/**
 * Release everything one plugin owns: its unload hook, its slots and its
 * stylesheets (D10). A plugin that disappears leaves no position, no style and
 * no registration behind.
 */
export async function disposeRendererPlugin(pluginId: string): Promise<void> {
  const module = modules.get(pluginId);
  modules.delete(pluginId);
  attempts.delete(pluginId);
  pluginSlots.unregisterPlugin(pluginId);
  removePluginStyles(pluginId);
  if (typeof module?.onUnload === "function") {
    try {
      await module.onUnload();
    } catch {
      // A throwing unload hook must not keep the position alive.
    }
  }
}

/**
 * Plugins whose renderer module is live right now. The shell reconciles this
 * against its plugin list: anything here that is no longer installed, loaded or
 * granted gets disposed, which is what makes an uninstall release its positions
 * and its stylesheet without the plugin cooperating.
 */
export function loadedRendererPlugins(): string[] {
  return [...modules.keys()];
}

/** Test seam. */
export function resetRendererPlugins(): void {
  attempts.clear();
  modules.clear();
}
