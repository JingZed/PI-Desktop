/**
 * The shared action-bar gutters for `userAction` / `assistantAction`
 * (`docs/plugin-plan/ui/user-action/`, `docs/plugin-plan/ui/assistant-action/`).
 *
 * The finalized shape is 【left slots】【host keys】【right slots】: the host
 * keys render through `children` and can never be changed, hidden, removed,
 * or folded by a plugin. Each side shows at most three visible items; the
 * fourth onward folds into the host "⋯" menu on that side (left ⋯ before
 * the host keys, right ⋯ last). 装卸插件时 the registry recompute re-renders
 * the gutters, so install/uninstall reflows immediately. 出错隔离 and the
 * `.pi-plugin-slot` chrome live in `SlotBoundary`.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { UiMessage } from "@pi-desktop/shared";
import type { PluginActionSlotProps } from "@pi-desktop/plugin-sdk";
import { SlotBoundary, useSlotSessionId } from "../../../plugins/renderer-slots/use-slots";
import type { SlotEntry, SlotSide } from "../../../plugins/renderer-slots/registry";
import { dispatchFor } from "../../../plugins/renderer-host/dispatch";
import {
  actionSlotPropsFor,
  splitActionSide,
} from "./action-slot-props";

type ActionBarSlotsProps = {
  slot: "userAction" | "assistantAction";
  message: UiMessage;
  left: SlotEntry[];
  right: SlotEntry[];
  /** The host keys, rendered between the two sides; plugins never own them. */
  children: ReactNode;
};

function ActionSlotItem({
  entry,
  slot,
  message,
  side,
  sessionId,
}: {
  entry: SlotEntry;
  slot: "userAction" | "assistantAction";
  message: UiMessage;
  side: SlotSide;
  sessionId: string;
}) {
  // Rebuilt every render: the contract is props-push, the whole projection.
  const props: PluginActionSlotProps = actionSlotPropsFor(
    message,
    side,
    sessionId,
    dispatchFor(entry.pluginId),
  );
  return (
    <SlotBoundary entry={entry} slot={slot}>
      {entry.component(props) as ReactNode}
    </SlotBoundary>
  );
}

/** One side's "⋯" menu for the folded registrations. */
function ActionOverflowMenu({
  slot,
  message,
  entries,
  side,
  sessionId,
}: {
  slot: "userAction" | "assistantAction";
  message: UiMessage;
  entries: SlotEntry[];
  side: SlotSide;
  sessionId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on any click outside the menu; the folded items must not trap
  // the pointer the way a stray popover would.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  if (entries.length === 0) return null;
  return (
    <div ref={rootRef} className="pi-action-overflow" data-side={side}>
      <button
        type="button"
        className="copy-btn icon pi-action-overflow-btn"
        aria-label={t("chat.actionSlotMore")}
        title={t("chat.actionSlotMore")}
        aria-expanded={open ? "true" : "false"}
        onClick={() => setOpen((value) => !value)}
      >
        ⋯
      </button>
      {open ? (
        <div className="pi-action-overflow-panel" role="menu">
          {entries.map((entry) => (
            <ActionSlotItem
              key={entry.id}
              entry={entry}
              slot={slot}
              message={message}
              side={side}
              sessionId={sessionId}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Both plugin sides of one action bar around the host keys. With no
 * registrations it renders exactly the children — a plugin-free bar keeps
 * its exact current DOM.
 */
export function ActionBarSlots({
  slot,
  message,
  left,
  right,
  children,
}: ActionBarSlotsProps) {
  const sessionId = useSlotSessionId();
  if (left.length === 0 && right.length === 0) return <>{children}</>;
  const leftSplit = splitActionSide(left);
  const rightSplit = splitActionSide(right);
  const renderItem = (entry: SlotEntry, side: SlotSide) => (
    <ActionSlotItem
      key={entry.id}
      entry={entry}
      slot={slot}
      message={message}
      side={side}
      sessionId={sessionId}
    />
  );
  return (
    <>
      {leftSplit.overflow.length ? (
        <ActionOverflowMenu
          slot={slot}
          message={message}
          entries={leftSplit.overflow}
          side="left"
          sessionId={sessionId}
        />
      ) : null}
      {leftSplit.visible.map((entry) => renderItem(entry, "left"))}
      {children}
      {rightSplit.visible.map((entry) => renderItem(entry, "right"))}
      {rightSplit.overflow.length ? (
        <ActionOverflowMenu
          slot={slot}
          message={message}
          entries={rightSplit.overflow}
          side="right"
          sessionId={sessionId}
        />
      ) : null}
    </>
  );
}
