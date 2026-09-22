/**
 * The `blockRenderer` slot host (`docs/plugin-plan/ui/block-renderer/`).
 *
 * A claimed fence hands `{ language, source }` to the plugin once (props-once)
 * and the plugin owns the whole block — head, copy button, error display.
 * The host keeps exactly one guarantee: content taller than 4000px counts as
 * a render failure and falls back to the host code block, and so does a
 * component that throws (via the boundary's fallback) — the source code must
 * always stay visible to the user.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { PluginBlockRendererSlotProps } from "@pi-desktop/plugin-sdk";
import { SlotBoundary } from "../plugins/renderer-slots/use-slots";
import type { SlotEntry } from "../plugins/renderer-slots/registry";
import {
  BLOCK_RENDERER_MAX_HEIGHT_PX,
  blockRendererOverflow,
} from "../lib/block-renderer";

export function PluginBlockRenderer({
  entry,
  language,
  source,
  fallback,
}: {
  entry: SlotEntry;
  language: string;
  source: string;
  /** The host default block, shown when the plugin fails the contract. */
  fallback: ReactNode;
}) {
  // props-once: the first mount's projection is the only one there is.
  const onceRef = useRef<PluginBlockRendererSlotProps>({ language, source });
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowed, setOverflowed] = useState(false);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el && blockRendererOverflow(el.scrollHeight)) {
      setOverflowed(true);
    }
  }, []);

  if (overflowed) return fallback;
  return (
    <SlotBoundary entry={entry} slot="blockRenderer" fallback={fallback}>
      <div
        ref={contentRef}
        className="pi-plugin-block-renderer"
        data-pi-language={onceRef.current.language}
        style={{ maxHeight: BLOCK_RENDERER_MAX_HEIGHT_PX }}
      >
        {entry.component(onceRef.current) as ReactNode}
      </div>
    </SlotBoundary>
  );
}
