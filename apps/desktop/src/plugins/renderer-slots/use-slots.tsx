/**
 * React glue over the slot registry: subscriptions + the per-registration
 * error boundary that realizes 出错隔离 (a throwing component collapses only
 * its own region).
 */
import {
  Component,
  type ReactNode,
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import type { PluginRendererSlot } from "@pi-desktop/plugin-sdk";
import {
  slotRegistry,
  type SlotEntry,
  type SlotSide,
} from "./registry";

export function useSlotEntries(slot: PluginRendererSlot, side?: SlotSide): SlotEntry[] {
  const snapshot = useSyncExternalStore(
    slotRegistry.subscribe,
    slotRegistry.getSnapshot,
    slotRegistry.getSnapshot,
  );
  return useMemo(
    () => (side ? slotRegistry.entriesForSide(slot, side) : slotRegistry.entriesFor(slot)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot.version is the change signal
    [snapshot.version, slot, side],
  );
}

export function useSlotEntryForKey(
  slot: PluginRendererSlot,
  key: string | undefined,
): SlotEntry | undefined {
  const snapshot = useSyncExternalStore(
    slotRegistry.subscribe,
    slotRegistry.getSnapshot,
    slotRegistry.getSnapshot,
  );
  return useMemo(
    () => (key ? slotRegistry.entryForKey(slot, key) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot.version is the change signal
    [snapshot.version, slot, key],
  );
}

/**
 * Host chrome around one plugin registration. Every rendered slot component
 * sits inside `.pi-plugin-slot` with `data-pi-plugin`, and inside its own
 * boundary: a render failure removes exactly that registration's region.
 */
export function SlotBoundary({
  entry,
  slot,
  children,
  fallback,
}: {
  entry: SlotEntry;
  slot: PluginRendererSlot;
  children: ReactNode;
  /** Rendered when the registration's component throws (blockRenderer's
   * contract hands back the host code block instead of collapsing). */
  fallback?: ReactNode;
}) {
  return (
    <SlotErrorBoundary entry={entry} fallback={fallback}>
      <div className="pi-plugin-slot" data-pi-plugin={entry.pluginId} data-pi-slot={slot}>
        {children}
      </div>
    </SlotErrorBoundary>
  );
}

type BoundaryProps = { entry: SlotEntry; fallback?: ReactNode; children: ReactNode };

type BoundaryState = { failed: boolean };

class SlotErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const pluginId = this.props.entry.pluginId;
    // Isolated by design; the console line is the diagnosability surface.
    console.warn(
      `[plugin-slot] ${pluginId} component failed; collapsing its own region only`,
      error,
    );
  }

  render(): ReactNode {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}

/**
 * Session identity for slot props. The transcript knows the session a
 * message belongs to; slot hosts pass it down through this context so the
 * props skeleton (`message/messageId/sessionId`) stays uniform.
 */
const SlotSessionContext = createContext<string>("");

export function SlotSessionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  return (
    <SlotSessionContext.Provider value={sessionId}>{children}</SlotSessionContext.Provider>
  );
}

export function useSlotSessionId(): string {
  return useContext(SlotSessionContext);
}
