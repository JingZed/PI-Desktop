/**
 * Mounts once per app window and keeps the set of loaded renderer modules in
 * step with the plugin list: load on enable, unload on disable/uninstall —
 * 卸载摘注册, exactly as the slot contract promises.
 */
import { useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import {
  loadedRendererPluginIds,
  loadRendererModule,
  unloadRendererModule,
} from "./loader";
import { installRendererImportMap } from "./import-map";
import "../renderer-slots/slot-shell.css";

function eligible(summary: {
  enabled: boolean;
  status: string;
  permissions: string[];
  renderer?: { entry: string; actions: string[]; callMethods: string[] } | null;
}): boolean {
  if (!summary.renderer) return false;
  if (!summary.enabled) return false;
  if (summary.status === "disabled" || summary.status === "load_error") return false;
  return summary.permissions.includes("renderer.extension");
}

export function PluginRendererHost(): null {
  const plugins = useAppStore((state) => state.plugins);

  useEffect(() => {
    // Must run before the first plugin import resolves bare `react`.
    installRendererImportMap();
  }, []);

  useEffect(() => {
    const wanted = new Set<string>();
    for (const summary of plugins) {
      if (!eligible(summary)) continue;
      wanted.add(summary.id);
      void loadRendererModule(
        summary.id,
        summary.renderer?.entry,
        summary.version,
        { actions: summary.renderer?.actions ?? [], tools: summary.tools },
      ).catch((error: unknown) => {
        const code = (error as { code?: string } | null)?.code ?? "PLUGIN_SLOT_LOAD_FAILED";
        console.warn(`[plugin-renderer] ${code}:`, error instanceof Error ? error.message : error);
      });
    }
    for (const id of loadedRendererPluginIds()) {
      if (!wanted.has(id)) void unloadRendererModule(id);
    }
  }, [plugins]);

  return null;
}

