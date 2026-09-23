/**
 * One draft token chip (`docs/plugin-plan/ui/composer/`).
 *
 * A plugin that registered `composerToken` for this label draws the token's
 * face through its own component; without a registration the host chip
 * renders. The ✕ removal stays host-owned either way so the fold records
 * (折叠不丢弃) can never strand a token inside the draft.
 */
import { createElement, type ComponentType } from "react";
import type { PluginComposerTokenProps } from "@pi-desktop/plugin-sdk";
import {
  SlotBoundary,
  useSlotEntryForKey,
} from "../../../plugins/renderer-slots/use-slots";
import { dispatchFor } from "../../../plugins/renderer-host/dispatch";
import type { ComposerPluginToken } from "./plugin-trigger";

export function ComposerTokenChip({
  token,
  onRemove,
}: {
  token: ComposerPluginToken;
  onRemove: (label: string) => void;
}) {
  const entry = useSlotEntryForKey("composerToken", token.label);
  const removeButton = (
    <button
      type="button"
      className="pi-plugin-token-chip-remove"
      aria-label={`remove #${token.label}`}
      onClick={() => onRemove(token.label)}
    >
      ×
    </button>
  );
  if (!entry) {
    return (
      <span className="pi-plugin-token-chip" role="listitem">
        #{token.label}
        {removeButton}
      </span>
    );
  }
  return (
    <span
      className="pi-plugin-token-chip"
      role="listitem"
      data-pi-plugin={entry.pluginId}
    >
      <SlotBoundary entry={entry} slot="composerToken">
        {createElement(
          entry.component as ComponentType<PluginComposerTokenProps>,
          {
            label: token.label,
            send: token.send,
            dispatch: dispatchFor(entry.pluginId),
          },
        )}
      </SlotBoundary>
      {removeButton}
    </span>
  );
}
