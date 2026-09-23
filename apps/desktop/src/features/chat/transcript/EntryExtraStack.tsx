/**
 * The `entryExtra` slot mount (`docs/plugin-plan/ui/entry-extra/`).
 *
 * Additive blocks under the assistant reply body, stacked in registration
 * order. The host owns the height contract: a collapsed block clamps at
 * 320px with an edge fade and the host expand toggle; expanded it scrolls
 * internally up to 600px. Blocks appear with the finished reply (the same
 * internally up to 600px. Blocks appear with the finished reply, and the
 * whole stack re-renders per reply the way props-push would rebuild it.
 *
 * 出错隔离 lives in `SlotBoundary`: a throwing block collapses only itself.
 */
import {
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import type { PluginEntryExtraSlotProps } from "@pi-desktop/plugin-sdk";
import {
  SlotBoundary,
  useSlotEntries,
  useSlotSessionId,
} from "../../../plugins/renderer-slots/use-slots";
import type { SlotEntry } from "../../../plugins/renderer-slots/registry";
import { dispatchFor } from "../../../plugins/renderer-host/dispatch";
import {
  ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT,
  ENTRY_EXTRA_EXPANDED_MAX_HEIGHT,
  entryExtraPropsFor,
} from "./entry-extra-props";

export { ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT, ENTRY_EXTRA_EXPANDED_MAX_HEIGHT };

/** One registration's clamped viewport plus the host expand toggle. */
function EntryExtraBlock({
  entry,
  message,
  sessionId,
}: {
  entry: SlotEntry;
  message: UiMessage;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  // The toggle exists only when content actually exceeds the collapsed clamp;
  // ResizeObserver keeps that honest when a block loads data asynchronously.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content || typeof ResizeObserver === "undefined") {
      setOverflows(false);
      return;
    }
    const measure = () => {
      setOverflows(content.scrollHeight > viewport.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  // Rebuilt every render: the contract is props-push, the whole projection.
  const props: PluginEntryExtraSlotProps = entryExtraPropsFor(
    message,
    sessionId,
    dispatchFor(entry.pluginId),
  );
  const showToggle = expanded || overflows;
  return (
    <SlotBoundary entry={entry} slot="entryExtra">
      <div
        className="pi-entry-extra-block"
        data-expanded={expanded ? "true" : undefined}
      >
        <div
          ref={viewportRef}
          className="pi-entry-extra-viewport"
          data-clipped={!expanded && overflows ? "true" : undefined}
          style={{
            maxHeight: expanded
              ? ENTRY_EXTRA_EXPANDED_MAX_HEIGHT
              : ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT,
          }}
        >
          <div ref={contentRef}>{createElement(entry.component as ComponentType<Record<string, unknown>>, props)}</div>
        </div>
        {showToggle ? (
          <button
            type="button"
            className="pi-entry-extra-toggle"
            data-state={expanded ? "expanded" : "collapsed"}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t("chat.entryExtraCollapse")
              : t("chat.entryExtraExpand")}
          </button>
        ) : null}
      </div>
    </SlotBoundary>
  );
}

/**
 * The whole slot region for one assistant reply: zero or more blocks in
 * registration order. Renders nothing when no plugin registered the slot.
 */
export function EntryExtraStack({ message }: { message: UiMessage }) {
  const entries = useSlotEntries("entryExtra");
  const sessionId = useSlotSessionId();
  if (entries.length === 0) return null;
  return (
    <div className="pi-entry-extra-stack" data-pi-slot="entryExtra">
      {entries.map((entry) => (
        <EntryExtraBlock
          key={entry.id}
          entry={entry}
          message={message}
          sessionId={sessionId}
        />
      ))}
    </div>
  );
}
