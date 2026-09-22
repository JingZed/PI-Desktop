/**
 * Props projection and pagination for the additive action slots
 * (`docs/plugin-plan/ui/user-action/`, `docs/plugin-plan/ui/assistant-action/`).
 *
 * The finalized shape is 【left slots】【host keys】【right slots】: plugins
 * may only add around the host keys, which never collapse. Each side shows
 * at most three items; the fourth onward folds into the host "⋯" menu on
 * that side (left ⋯ before the host keys, right ⋯ last). JSX-free so logic
 * tests can drive it directly.
 */
import type {
  PluginActionSlotProps,
  PluginRendererDispatch,
  PluginSlotPosition,
} from "@pi-desktop/plugin-sdk";
import type { UiMessage } from "@pi-desktop/shared";

/** Visible items per side; the rest fold into the host ⋯ menu. */
export const ACTION_SLOT_VISIBLE_LIMIT = 3;

/** The data projection the contract hands to an action item. */
export function actionSlotMessage(
  message: UiMessage,
): PluginActionSlotProps["message"] {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

/** Full props for one action item; rebuilt per render (props-push). */
export function actionSlotPropsFor(
  message: UiMessage,
  position: PluginSlotPosition,
  sessionId: string,
  dispatch: PluginRendererDispatch,
): PluginActionSlotProps {
  return {
    message: actionSlotMessage(message),
    messageId: message.id,
    sessionId,
    position,
    dispatch,
  };
}

/** Split one side's registrations into visible items and ⋯ overflow. */
export function splitActionSide<T>(
  entries: readonly T[],
  limit: number = ACTION_SLOT_VISIBLE_LIMIT,
): { visible: T[]; overflow: T[] } {
  return {
    visible: entries.slice(0, limit),
    overflow: entries.slice(limit),
  };
}
