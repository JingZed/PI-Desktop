import type { ThinkingLevel, UiMessage, UiMessageRole } from "@pi-desktop/shared";
import { THINKING_LEVELS } from "@pi-desktop/shared";
import type { SubagentRun } from "../../../lib/assistant-turns";
import { toolResultPayload } from "../../../lib/tool-presentation";
import type { PiRendererEntryExtraProps } from "@pi-desktop/plugin-sdk";

export function delegateAgentName(
  message: UiMessage,
  delegate?: SubagentRun,
): string {
  if (delegate?.agentName) return delegate.agentName;
  const args = message.toolArgs;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const requested = (args as { agent?: unknown }).agent;
    if (typeof requested === "string") return requested;
  }
  return "";
}

/** Effective model resolved for this delegation, recorded by the Task result. */
export function delegateModelId(message: UiMessage): string {
  const payload = toolResultPayload(message);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "";
  }
  const modelId = (payload as { modelId?: unknown }).modelId;
  return typeof modelId === "string" ? modelId.trim() : "";
}

/** Effective thinking level resolved for this delegation, from the Task result.
 * `off` and `omit` deliberately have no visible suffix. */
export function delegateThinkingLevel(message: UiMessage): ThinkingLevel | undefined {
  const payload = toolResultPayload(message);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as { thinkingLevel?: unknown }).thinkingLevel;
  if (
    typeof value !== "string" ||
    value === "off" ||
    !THINKING_LEVELS.includes(value as ThinkingLevel)
  ) {
    return undefined;
  }
  return value as ThinkingLevel;
}

/**
 * Copies a run row's command from its head. The expanded body holds only the
 * output, so this is the one place the command can be taken from (D226).
 */

/**
 * What the host knows about one transcript entry's identity (D14).
 *
 * A renderer slot is handed this instead of the entry's own content: enough to
 * name the row a plugin is attached to, and enough for that plugin to tell
 * whether the entry is its own.
 */
export type TranscriptEntryIdentity = {
  id: string;
  /** The entry's own role, before the slot contract narrows it. */
  role: UiMessageRole;
  /**
   * The plugin the host attributes this entry to. It is set only when the host
   * knows the producer, and it exists so a plugin can decide whether an entry
   * is its own; it is never guessed from a tool name or from message text.
   *
   * This is not the cross-session origin (`UiMessage.sessionMessage`, drawn by
   * `SessionMessageOrigin`): that says which session sent a message and
   * carries no plugin identity.
   */
  pluginId?: string;
};

/**
 * The identity `entryExtra` receives for a transcript row.
 *
 * Nothing in the transcript pipeline reports which plugin produced an entry
 * today, so `pluginId` is deliberately left unset rather than inferred; the
 * host fills it only once a producer can report itself (D14).
 */
export function transcriptEntryIdentity(
  message: Pick<UiMessage, "id" | "role">,
): TranscriptEntryIdentity {
  return { id: message.id, role: message.role };
}

/**
 * The slot contract's role set. A tool row is neither user input nor a host
 * notice: the transcript already groups it under the assistant's own turn
 * (`data-row-role="assistant"`), so that is the role it reports.
 */
export function rendererEntryRole(
  role: UiMessageRole,
): PiRendererEntryExtraProps["entry"]["role"] {
  return role === "tool" ? "assistant" : role;
}

/**
 * Props for one `entryExtra` registration. `pluginId` is omitted rather than
 * blanked when the host knows no producer, so a plugin's own
 * `props.entry.pluginId === pi.plugin.id` check can never match an empty id.
 */
export function entryExtraSlotProps(
  entry: TranscriptEntryIdentity,
  sessionId: string,
): PiRendererEntryExtraProps {
  const pluginId = entry.pluginId?.trim();
  return {
    entry: {
      id: entry.id,
      role: rendererEntryRole(entry.role),
      ...(pluginId ? { pluginId } : {}),
    },
    sessionId,
  };
}
