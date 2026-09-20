/**
 * The `composerControl` position: a plugin's controls in one composer control
 * row.
 *
 * Mounted once per row — `position="left"` at the end of the composer's left
 * controls and `position="right"` at the end of its right ones — so the host's
 * own controls are already in place and a plugin control follows them (D8).
 * With nothing registered the outlet renders nothing at all, so the composer's
 * own DOM is untouched for a user who has no such plugin.
 */
import { useMemo } from "react";
import { useAppStore } from "../../../stores/app-store";
import { PluginSlot } from "../../../plugins/renderer-slots/SlotOutlet";
import { useRendererCandidates } from "../../../plugins/renderer-slots/use-renderer-candidates";

export function ComposerControlSlot({
  position,
  draft,
}: {
  position: "left" | "right";
  /** The draft the composer already holds; no new state is read for the slot. */
  draft: string;
}) {
  const candidates = useRendererCandidates();
  const sessionId = useAppStore((s) => s.activeSessionId);
  // A draft with no session reports no id at all, rather than an empty one a
  // plugin could mistake for a real session.
  const slotProps = useMemo(
    () => ({ position, draft, ...(sessionId ? { sessionId } : {}) }),
    [position, draft, sessionId],
  );
  return (
    <PluginSlot
      slot="composerControl"
      slotProps={slotProps}
      candidates={candidates}
      containerProps={{ "data-pi-control-position": position }}
    />
  );
}
