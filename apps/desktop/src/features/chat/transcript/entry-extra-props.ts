/**
 * Props projection for the `entryExtra` slot (`docs/plugin-plan/ui/entry-extra/`).
 *
 * The contract fixes the shape: the assistant message data, the ids, and the
 * plugin's own dispatch relay — no host functions, no extra data. Kept
 * JSX-free so logic tests can drive it directly.
 */
import type {
  PluginEntryExtraSlotProps,
  PluginRendererDispatch,
} from "@pi-desktop/plugin-sdk";
import type { UiMessage } from "@pi-desktop/shared";

/** The data projection the contract hands to an entryExtra block. */
export function entryExtraMessage(
  message: UiMessage,
): PluginEntryExtraSlotProps["message"] {
  return {
    id: message.id,
    role: "assistant",
    content: message.content,
    createdAt: message.createdAt,
  };
}

/** Full props for one entryExtra block; rebuilt per render (props-push). */
export function entryExtraPropsFor(
  message: UiMessage,
  sessionId: string,
  dispatch: PluginRendererDispatch,
): PluginEntryExtraSlotProps {
  return {
    message: entryExtraMessage(message),
    messageId: message.id,
    sessionId,
    dispatch,
  };
}

/** Collapsed-state clamp: taller content fades and shows the host toggle. */
export const ENTRY_EXTRA_COLLAPSED_MAX_HEIGHT = 320;

/** Expanded state scrolls internally up to this height. */
export const ENTRY_EXTRA_EXPANDED_MAX_HEIGHT = 600;
