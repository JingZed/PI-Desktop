/**
 * Renderer-internal bridge for the `composer.acceptTriggerItem` outbound
 * action.
 *
 * The trigger menu lives in the composer, so the dispatch relay routes that
 * action here. The trigger host registers its accept implementation while a
 * plugin trigger menu is open and clears it on close; with no menu open the
 * relay answers `PLUGIN_ACTION_UNROUTED` — never a silent drop.
 */

import type { PluginComposerTriggerItem } from "@pi-desktop/plugin-sdk";

type TriggerItemAccept = (item: PluginComposerTriggerItem) => void;

let handler: TriggerItemAccept | null = null;

/** Called by the trigger host while a plugin trigger menu is open. */
export function registerComposerTriggerAccept(fn: TriggerItemAccept | null): void {
  handler = fn;
}

export function acceptComposerTriggerItem(payload: unknown): boolean {
  if (!handler) return false;
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { label?: unknown; value?: unknown };
  if (typeof candidate.label !== "string" || candidate.label.length === 0) {
    return false;
  }
  const item: PluginComposerTriggerItem = {
    label: candidate.label,
    value: candidate.value,
  };
  handler(item);
  return true;
}

/** Test seam. */
export function resetComposerTriggerBridge(): void {
  handler = null;
}
