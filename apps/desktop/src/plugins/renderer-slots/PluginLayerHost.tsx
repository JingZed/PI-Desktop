/**
 * The host's app-level layer positions: `modal` and `overlay` (spec
 * 07-plugins/16 2A.5, ADR 0291).
 *
 * A layer has no place in the host's own tree, so the registration *is* the
 * layer: a plugin says its dialog or overlay is up by registering one, and says
 * it is gone by removing that registration (`handle.remove()`, or its own
 * component rendering nothing). Everything the shell already does on unload,
 * disable, or uninstall therefore reclaims the layer with it (D10), which is the
 * rule this file exists for: no orphan layer is left on screen, and any layer
 * that is on screen can be left with Escape.
 *
 * The two positions differ in one thing only, and it is the host's decision
 * rather than the plugin's: a `modal` is blocking and takes the host's own
 * `.overlay` scrim, while an `overlay` is a transient layer that leaves the rest
 * of the window usable (only the plugin's own box takes the pointer). Neither is
 * portaled while no plugin fills it, so a window with no renderer plugin keeps
 * today's DOM exactly.
 */
import { useEffect, useMemo, useState } from "react";
import { portalOverlay } from "../../components/ui";
import { useAppStore } from "../../stores/app-store";
import { PluginSlot, useSlotRegistrations } from "./SlotOutlet";
import { useRendererCandidates } from "./use-renderer-candidates";

type LayerSlot = "modal" | "overlay";

function PluginLayer({ slot, blocking }: { slot: LayerSlot; blocking: boolean }) {
  const registrations = useSlotRegistrations(slot);
  const candidates = useRendererCandidates();
  const sessionId = useAppStore((state) => state.activeSessionId);
  // One host dismissal per plugin. It is the *host's* way out of a layer a
  // plugin drew, so it is deliberately not part of the plugin interface: the
  // plugin's own state is untouched, and a fresh registration — the same plugin
  // registering again — gives it the position back.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set());
  const slotProps = useMemo(
    () => (sessionId ? { sessionId } : {}),
    [sessionId],
  );

  useEffect(() => {
    setDismissed((current) => (current.size === 0 ? current : new Set()));
  }, [registrations]);

  const shown = useMemo(
    () => registrations.filter((registration) => !dismissed.has(registration.pluginId)),
    [dismissed, registrations],
  );

  useEffect(() => {
    if (!shown.length) return;
    // Escape is the host's close affordance for a plugin layer. The key is
    // neither captured nor prevented: the host's own dialogs keep handling it
    // exactly as before, and this only drops the layer it owns.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDismissed(new Set(shown.map((registration) => registration.pluginId)));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shown]);

  if (!shown.length) return null;

  return portalOverlay(
    <div
      className={blocking ? "overlay pi-plugin-layer is-modal" : "pi-plugin-layer is-overlay"}
      data-pi-plugin-layer={slot}
      role="presentation"
    >
      <PluginSlot
        slot={slot}
        slotProps={slotProps}
        candidates={candidates}
        registrations={shown}
      />
    </div>,
  );
}

/** Both layer positions, mounted once by the app shell beside its own dialog host. */
export function PluginLayerHost() {
  return (
    <>
      <PluginLayer slot="modal" blocking />
      <PluginLayer slot="overlay" blocking={false} />
    </>
  );
}
