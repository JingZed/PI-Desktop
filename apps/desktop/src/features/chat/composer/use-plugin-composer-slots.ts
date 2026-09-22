/**
 * React glue for the composer's plugin slots
 * (`docs/plugin-plan/ui/composer/`): toolbar controls (left/right), the `#`
 * trigger dropdown, and token records with the host ⧉ +N fold.
 *
 * The trigger list is plugin-drawn: the host detects the `#token` at the
 * cursor and renders the plugin's component with `{ query, dispatch }`; the
 * plugin answers per keystroke by rendering candidates, and a picked item
 * flows back through `dispatch("composer.acceptTriggerItem", { label,
 * value })` — routed by the trigger bridge to the composer.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { normalizeFullWidthTrigger } from "@pi-desktop/shared";
import { slotRegistry, type SlotEntry } from "../../../plugins/renderer-slots/registry";
import { registerComposerTriggerAccept } from "./trigger-bridge";
import {
  COMPOSER_PLUGIN_TOKEN_LIMIT,
  detectPluginHashTrigger,
  pluginTokenAtLimit,
  type ComposerPluginToken,
} from "./plugin-trigger";

/** Left / right control registrations, subscription-live. */
export function useComposerControlEntries(side: "left" | "right"): SlotEntry[] {
  const snapshot = useSyncExternalStore(slotRegistry.subscribe, slotRegistry.getSnapshot);
  return useMemo(
    () => slotRegistry.entriesForSide("composerControl", side),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot.version is the change signal
    [snapshot.version, side],
  );
}

/** The one plugin trigger registration (a keyed slot, symbol `#`). */
export function useComposerTriggerEntry(): SlotEntry | undefined {
  const snapshot = useSyncExternalStore(slotRegistry.subscribe, slotRegistry.getSnapshot);
  return useMemo(
    () => slotRegistry.entryForKey("composerTrigger", "#"),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot.version is the change signal
    [snapshot.version],
  );
}

/** An active `#plugin` token at the cursor. */
export type PluginTriggerState = {
  query: string;
  tokenStart: number;
  tokenEnd: number;
  entry: SlotEntry;
};

/**
 * The `#` trigger detector: locate the token at the cursor and expose the
 * matched registration. During IME composition the state freezes (the same
 * rule as the host autocomplete); a programmatic insert never moves the
 * caret into a `#token`, so it can not fire the trigger.
 */
export function useComposerPluginTrigger({
  value,
  cursor,
  composing,
  enabled,
}: {
  value: string;
  cursor: number;
  composing: boolean;
  enabled: boolean;
}): PluginTriggerState | null {
  const entry = useComposerTriggerEntry();
  const frozenRef = useRef<PluginTriggerState | null>(null);
  const live = useMemo<PluginTriggerState | null>(() => {
    if (!enabled || !entry) return null;
    // 全角归一化: ＠＃／ rewrite to @#/ before detection. Every replacement
    // is one code unit for one, so cursor offsets stay valid against the
    // raw draft the accept path slices.
    const normalized = normalizeFullWidthTrigger(value);
    const hit = detectPluginHashTrigger(normalized, cursor);
    return hit ? { ...hit, entry } : null;
  }, [enabled, entry, value, cursor]);
  const trigger = composing ? frozenRef.current : live;
  useEffect(() => {
    if (!composing) frozenRef.current = live;
  }, [composing, live]);
  return trigger;
}

/**
 * Token records for the draft with the finalized cap: up to eight tokens
 * stay individual; the ninth onward folds into the host ⧉ +N chip. Folded
 * tokens keep their records — 发送 payload 不丢.
 */
export function useComposerPluginTokens(): {
  tokens: ComposerPluginToken[];
  /** Records one accept; `folded` reports whether it went into the fold. */
  addToken: (token: ComposerPluginToken) => { folded: boolean };
  removeToken: (label: string) => void;
  foldedCount: number;
} {
  const [tokens, setTokens] = useState<ComposerPluginToken[]>([]);
  const addToken = useCallback(
    (token: ComposerPluginToken) => {
      // 折叠不丢弃: every accept is recorded; `folded` only reports that
      // this token renders inside the host ⧉ +N chip instead of its own.
      const folded = pluginTokenAtLimit(tokens.length);
      setTokens((current) => [...current, token]);
      return { folded };
    },
    [tokens.length],
  );
  const removeToken = useCallback((label: string) => {
    setTokens((current) => current.filter((token) => token.label !== label));
  }, []);
  const foldedCount = Math.max(0, tokens.length - COMPOSER_PLUGIN_TOKEN_LIMIT);
  return { tokens, addToken, removeToken, foldedCount };
}

/**
 * Bridges the trigger menu's accept route: while a menu is open the dispatch
 * relay hands `composer.acceptTriggerItem` payloads here; with no menu open
 * the bridge answers UNROUTED.
 */
export function useComposerTriggerAcceptBridge({
  active,
  onAccept,
}: {
  active: boolean;
  onAccept: (item: { label: string; value?: unknown }) => void;
}): void {
  const acceptRef = useRef(onAccept);
  acceptRef.current = onAccept;
  useEffect(() => {
    if (!active) {
      registerComposerTriggerAccept(null);
      return;
    }
    registerComposerTriggerAccept((item) => acceptRef.current(item));
    return () => registerComposerTriggerAccept(null);
  }, [active]);
}
