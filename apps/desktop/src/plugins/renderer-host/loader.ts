/**
 * Loads one plugin's renderer entry into the app document and hands it the
 * `pi` API (`PiRendererApi` in @pi-desktop/plugin-sdk).
 *
 * The entry is a plain ES module served from `plugin-renderer://<id>/...`.
 * Loads are single-flight per plugin: the first caller starts the fetch and
 * everyone else awaits the same promise. A module without `onLoad` is
 * refused with `PLUGIN_SLOT_LOAD_FAILED`; a module that throws during
 * registration leaves the registrations it already made behind, so the
 * unload path still tears them down.
 */
import {
  PLUGIN_RENDERER_SCHEME,
  type PiRendererApi,
  type PiRendererModule,
  type PluginRendererSlotOptions,
  toolCardOwnershipError,
} from "@pi-desktop/plugin-sdk";
import { slotRegistry, type SlotRegistrationHandle } from "../renderer-slots/registry";
import {
  injectStyle,
  removePluginStyles,
  type PluginStyleHandle,
} from "../renderer-slots/style-injection";
import {
  bindDispatch,
  createDispatch,
  unbindDispatch,
  type RendererDispatchContext,
} from "./dispatch";

export type RendererModuleRecord = {
  pluginId: string;
  module: PiRendererModule;
};

const loaded = new Map<string, Promise<RendererModuleRecord | null>>();

function rendererModuleUrl(pluginId: string, entry: string): string {
  return `${PLUGIN_RENDERER_SCHEME}://${encodeURIComponent(pluginId)}/${entry.replace(/^\//, "")}`;
}

function codedError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function buildPiApi(
  pluginId: string,
  version: string,
  context: RendererDispatchContext,
): PiRendererApi {
  const handles: (SlotRegistrationHandle | PluginStyleHandle)[] = [];
  const api: PiRendererApi = {
    plugin: { id: pluginId, version },
    slots: {
      register<Props>(
        slot: Parameters<PiRendererApi["slots"]["register"]>[0],
        component: (props: Props) => unknown,
        options?: PluginRendererSlotOptions,
      ) {
        // The toolCard no-claim gate: a card may only serve a tool the
        // plugin's own manifest declares (`contributes.agentTools`).
        if (slot === "toolCard") {
          const ownershipError = toolCardOwnershipError(
            options?.toolName ?? "",
            context.tools,
          );
          if (ownershipError) {
            throw codedError("PLUGIN_SLOT_INVALID_KEY", ownershipError);
          }
        }
        const handle = slotRegistry.register(
          pluginId,
          slot,
          component as unknown,
          options,
        );
        handles.push(handle);
        return handle;
      },
    },
    ui: {
      injectStyle(css: string) {
        const handle = injectStyle(pluginId, css);
        handles.push(handle);
        return handle;
      },
    },
  };
  // Keeps the handles reachable for host-side teardown even if the plugin
  // drops its own registration handles.
  handlesAtLoad.set(api, handles);
  return api;
}

const handlesAtLoad = new WeakMap<object, (SlotRegistrationHandle | PluginStyleHandle)[]>();

/**
 * Load and `onLoad` one renderer module. Resolves `null` when the plugin
 * declares no renderer entry. Single-flight per plugin. `context.tools` is
 * the plugin's own declared tool names (the no-claim gate for `toolCard`).
 */
export function loadRendererModule(
  pluginId: string,
  entry: string | undefined,
  version: string,
  context: RendererDispatchContext,
): Promise<RendererModuleRecord | null> {
  if (!entry) return Promise.resolve(null);
  const existing = loaded.get(pluginId);
  if (existing) return existing;
  const promise = (async () => {
    const url = rendererModuleUrl(pluginId, entry);
    let namespace: unknown;
    try {
      namespace = await import(/* @vite-ignore */ url);
    } catch (error) {
      throw codedError(
        "PLUGIN_SLOT_LOAD_FAILED",
        `renderer entry for ${pluginId} failed to load: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const candidate = namespace as { default?: unknown } & Record<string, unknown>;
    const mod = ((candidate.default ?? candidate) ?? {}) as Partial<PiRendererModule>;
    if (typeof mod.onLoad !== "function") {
      throw codedError(
        "PLUGIN_SLOT_LOAD_FAILED",
        `renderer entry for ${pluginId} must export onLoad`,
      );
    }
    bindDispatch(pluginId, context.actions);
    try {
      await mod.onLoad(buildPiApi(pluginId, version, context));
    } catch (error) {
      // A throwing onLoad still leaves the registrations it already made;
      // surface the failure but keep the host consistent.
      unbindDispatch(pluginId);
      slotRegistry.unregisterPlugin(pluginId);
      removePluginStyles(pluginId);
      throw codedError(
        "PLUGIN_SLOT_LOAD_FAILED",
        `onLoad for ${pluginId} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { pluginId, module: mod as PiRendererModule };
  })();
  loaded.set(pluginId, promise);
  promise.catch(() => {
    // Failed loads are retryable: drop the memo so a fixed plugin can reload.
    loaded.delete(pluginId);
  });
  return promise;
}

/** Plugin ids with a live renderer module (host teardown diffing). */
export function loadedRendererPluginIds(): string[] {
  return [...loaded.keys()];
}

/**
 * 卸载摘注册: registrations, injected styles, the dispatch binding, then the
 * plugin's own onUnload. Teardown never blocks on a plugin's own failure.
 */
export async function unloadRendererModule(pluginId: string): Promise<void> {
  const record = loaded.get(pluginId);
  loaded.delete(pluginId);
  slotRegistry.unregisterPlugin(pluginId);
  removePluginStyles(pluginId);
  unbindDispatch(pluginId);
  if (!record) return;
  try {
    const settled = await record;
    if (settled && typeof settled.module.onUnload === "function") {
      await settled.module.onUnload();
    }
  } catch {
    // Ignored by design: the plugin is going away regardless.
  }
}

/** Test seam. */
export function resetRendererModulesForTests(): void {
  for (const id of loaded.keys()) {
    void unloadRendererModule(id);
  }
}
