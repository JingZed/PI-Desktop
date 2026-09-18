/**
 * The host-side mounting point for component slots (ADR 0287).
 *
 * A plugin registers a component; this is where the host puts it. Three rules
 * are enforced here rather than trusted to plugin authors:
 *
 * - `data-pi-plugin="<id>"` wraps every plugin surface, which is what plugin CSS
 *   is expected to scope itself with and what the diagnostics surface counts.
 * - Each registration gets its own error boundary, so one broken component
 *   collapses to the host's own rendering instead of taking the surrounding
 *   list with it (D10: a crashed plugin does not hold a position).
 * - Loading is triggered by the first real render of the slot, never at startup.
 */
import { Component, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { PluginRendererSlot } from "@pi-desktop/plugin-sdk";
import {
  disposeRendererPlugin,
  ensureRendererPlugin,
  loadedRendererPlugins,
} from "../renderer-host/loader";
import { pluginSlots, type PluginSlotRegistration } from "./registry";

/** A plugin that may fill slots, as the shell knows it from its own plugin row. */
export type RendererCandidate = {
  id: string;
  version?: string;
  declared: boolean;
  /**
   * What the manifest says this plugin reads and calls. Carried unchanged so a
   * mount point never has to read a manifest; empty means it declared neither.
   */
  rendererData: string[];
  rendererActions: string[];
};

type BoundaryProps = {
  registration: PluginSlotRegistration;
  fallback: ReactNode;
  children: ReactNode;
};

type BoundaryState = { failed: boolean };

/**
 * Per-slot containment. React has no error boundary hook, so this stays a class
 * component; what it renders on failure is the host's own default for the slot,
 * which is why a failed plugin loses its position instead of leaving a hole.
 */
class PluginSlotBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    pluginSlots.report({
      pluginId: this.props.registration.pluginId,
      slot: this.props.registration.slot,
      code: "PLUGIN_SLOT_RENDER_FAILED",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Live view of one slot's registrations. Re-reads when the registry changes. */
export function useSlotRegistrations(slot: PluginRendererSlot): PluginSlotRegistration[] {
  const version = useSyncExternalStore(
    pluginSlots.subscribe,
    pluginSlots.snapshot,
    pluginSlots.snapshot,
  );
  return useMemo(
    () => pluginSlots.list(slot),
    // `version` is the registry's own change counter; the list rebuilds on it.
    [slot, version],
  );
}

export type PluginSlotProps = {
  slot: PluginRendererSlot;
  /** Data and callbacks this slot's contract promises (spec 07-plugins/16). */
  slotProps?: Record<string, unknown>;
  /** Candidates whose renderer entry may fill this slot. */
  candidates?: readonly RendererCandidate[];
  /** The host's own rendering, used when no plugin fills the slot or one fails. */
  children?: ReactNode;
};

/**
 * Render every plugin that owns `slot`, in registration order, after the host's
 * own content (D8: plugin items never jump ahead of host items).
 */
export function PluginSlot({ slot, slotProps, candidates = [], children }: PluginSlotProps) {
  const registrations = useSlotRegistrations(slot);
  const candidateKey = candidates.map((candidate) => candidate.id).join(",");
  // The array identity changes every render; the ref keeps the effect keyed on
  // the set of plugins that matter instead of on a fresh array each time.
  const latest = useRef(candidates);
  latest.current = candidates;

  useEffect(() => {
    // One place pulls a plugin module and one place releases it: a slot that
    // really renders. A plugin whose entry never appears on screen is never
    // evaluated, and one that has disappeared from the plugin list loses its
    // registrations and its stylesheet here rather than staying on screen.
    const present = new Set(latest.current.map((candidate) => candidate.id));
    for (const pluginId of loadedRendererPlugins()) {
      if (!present.has(pluginId)) void disposeRendererPlugin(pluginId);
    }
    for (const candidate of latest.current) {
      if (!candidate.declared) continue;
      void ensureRendererPlugin(candidate.id, {
        declared: candidate.declared,
        version: candidate.version,
      });
    }
  }, [candidateKey]);

  if (!registrations.length) return <>{children ?? null}</>;

  return (
    <>
      {registrations.map((registration, index) => {
        const PluginComponent = registration.component;
        return (
          <PluginSlotBoundary
            key={`${registration.pluginId}:${slot}:${index}`}
            registration={registration}
            fallback={children ?? null}
          >
            <div
              className="pi-plugin-slot"
              data-pi-plugin={registration.pluginId}
              data-pi-plugin-slot={slot}
            >
              <PluginComponent {...(slotProps ?? {})} />
            </div>
          </PluginSlotBoundary>
        );
      })}
    </>
  );
}
