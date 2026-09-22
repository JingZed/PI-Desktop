/**
 * Outbound dispatch gate (`slot-contract.html` §3).
 *
 * A slot component's only way out is `dispatch(action, payload)`. The relay
 * is bound to one plugin id, so a component can never act as another plugin,
 * and every action must be in that plugin's `manifest.rendererActions`
 * whitelist (`PLUGIN_ACTION_UNDECLARED` otherwise). `plugin.call` is
 * forwarded to the plugin's own headless entry over the main-process relay;
 * `composer.insertText` is renderer-local and routes through the insert
 * bridge.
 */
import { api } from "../../lib/api";
import { insertComposerText } from "../../features/chat/composer/insert-bridge";
import { acceptComposerTriggerItem } from "../../features/chat/composer/trigger-bridge";
import type { PluginRendererDispatch } from "@pi-desktop/plugin-sdk";

export type DispatchErrorCode =
  | "PLUGIN_ACTION_UNDECLARED"
  | "PLUGIN_ACTION_UNROUTED"
  | "PLUGIN_ACTION_INVALID_PAYLOAD";

/** A coded refusal from the dispatch path; rejects rather than throws. */
export class DispatchError extends Error {
  readonly code: DispatchErrorCode;
  constructor(code: DispatchErrorCode, message: string) {
    super(message);
    this.name = "DispatchError";
    this.code = code;
  }
}

export type RendererDispatchContext = {
  /** The whitelists from `manifest.rendererActions`, via PluginSummary. */
  actions: readonly string[];
  /** The plugin's own tool names, for the toolCard no-claim gate. */
  tools?: readonly string[];
};

export function createDispatch(
  pluginId: string,
  context: RendererDispatchContext,
): PluginRendererDispatch {
  const dispatch: PluginRendererDispatch = async (action, payload) => {
    if (!context.actions.includes(action)) {
      throw new DispatchError(
        "PLUGIN_ACTION_UNDECLARED",
        `action ${String(action)} is not in ${pluginId}'s rendererActions`,
      );
    }
    if (action === "plugin.call") {
      const call = (payload ?? {}) as { method?: unknown; args?: unknown };
      if (typeof call.method !== "string" || call.method.length === 0) {
        throw new DispatchError(
          "PLUGIN_ACTION_INVALID_PAYLOAD",
          "plugin.call requires { method, args? }",
        );
      }
      return api.pluginRendererCall(pluginId, call.method, call.args);
    }
    if (action === "composer.insertText") {
      if (typeof payload !== "string" || payload.length === 0) {
        throw new DispatchError(
          "PLUGIN_ACTION_INVALID_PAYLOAD",
          "composer.insertText requires a non-empty string",
        );
      }
      if (!insertComposerText(payload)) {
        throw new DispatchError(
          "PLUGIN_ACTION_UNROUTED",
          "no composer is mounted to receive text",
        );
      }
      return { ok: true };
    }
    if (action === "composer.acceptTriggerItem") {
      // Routed by the composer trigger host; without a live listener the
      // answer is UNROUTED, never a silent drop.
      if (!acceptComposerTriggerItem(payload)) {
        throw new DispatchError(
          "PLUGIN_ACTION_UNROUTED",
          "no trigger menu is open to accept the item",
        );
      }
      return { ok: true };
    }
    throw new DispatchError("PLUGIN_ACTION_UNROUTED", `no route for action ${String(action)}`);
  };
  return dispatch;
}


/**
 * One dispatch per loaded plugin, bound when its module loads. Slot outlets
 * hand the bound relay to components as the `dispatch` prop.
 */
const dispatchCache = new Map<string, PluginRendererDispatch>();

export function bindDispatch(pluginId: string, actions: readonly string[]): void {
  dispatchCache.set(pluginId, createDispatch(pluginId, { actions }));
}

export function unbindDispatch(pluginId: string): void {
  dispatchCache.delete(pluginId);
}

/**
 * The relay for one plugin's components. Falls back to a gate with an empty
 * whitelist when the plugin has no live binding — every call then refuses
 * with `PLUGIN_ACTION_UNDECLARED` instead of leaking a route.
 */
export function dispatchFor(pluginId: string): PluginRendererDispatch {
  return (
    dispatchCache.get(pluginId) ??
    createDispatch(pluginId, { actions: [] })
  );
}

/** Test seam: drop cached dispatches. */
export function resetDispatchForTests(): void {
  dispatchCache.clear();
}
