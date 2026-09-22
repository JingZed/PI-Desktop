/**
 * Props projection and push cadence for the `toolCard` slot
 * (`docs/plugin-plan/ui/tool-card/`).
 *
 * The contract fixes the fields (toolName / toolCallId / toolArgs? /
 * toolStatus / toolResult? / toolError? / durationMs? + ids + dispatch) and
 * the cadence: while the tool runs, the whole projection is pushed on a
 * 500ms merged beat; a status transition and the final result push
 * immediately. Failure is data (`toolError`), never a throw. JSX-free so
 * logic tests can drive it directly.
 */
import type {
  PluginRendererDispatch,
  PluginToolCardSlotProps,
} from "@pi-desktop/plugin-sdk";
import type { UiMessage } from "@pi-desktop/shared";

/** Merged-push beat while a call is still running. */
export const TOOL_CARD_RUNNING_INTERVAL_MS = 500;

/**
 * The props vocabulary carries three statuses; `denied` is host vocabulary,
 * so a denied row keeps the host default card and never reaches a plugin.
 */
export function toolCardStatusOf(
  message: UiMessage,
): PluginToolCardSlotProps["toolStatus"] {
  return message.toolStatus === "running" || message.toolStatus === "error"
    ? message.toolStatus
    : "success";
}

/** Full props for one card; rebuilt per render (props-push). */
export function toolCardPropsFor(
  message: UiMessage,
  sessionId: string,
  dispatch: PluginRendererDispatch,
): PluginToolCardSlotProps {
  return {
    toolName: message.toolName ?? "",
    toolCallId: message.toolCallId ?? message.id,
    toolArgs: message.toolArgs,
    toolStatus: toolCardStatusOf(message),
    toolResult: message.toolResult,
    toolError: message.isError ? message.error : undefined,
    durationMs: message.toolDurationMs,
    messageId: message.id,
    sessionId,
    dispatch,
  };
}

/**
 * The push decision: a status transition or a finished result is immediate;
 * running-tick updates merge onto the 500ms beat.
 */
export function shouldEmitToolCard(
  lastEmittedAt: number,
  lastStatus: PluginToolCardSlotProps["toolStatus"],
  nextStatus: PluginToolCardSlotProps["toolStatus"],
  now: number,
  interval: number = TOOL_CARD_RUNNING_INTERVAL_MS,
): boolean {
  if (nextStatus !== lastStatus) return true;
  if (nextStatus !== "running") return true;
  return now - lastEmittedAt >= interval;
}
