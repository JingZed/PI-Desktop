import type { ThinkingLevel, UiMessage, UiMessageRole } from "@pi-desktop/shared";
import { THINKING_LEVELS } from "@pi-desktop/shared";
import type { SubagentRun } from "../../../lib/assistant-turns";
import { toolResultPayload } from "../../../lib/tool-presentation";
import type { PiRendererEntryExtraProps } from "@pi-desktop/plugin-sdk";
import { pluginToolName } from "@pi-desktop/plugin-sdk";

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

/**
 * The plugin a tool row belongs to, or `undefined` when the host cannot say.
 *
 * Plugin tools are exposed under a forced prefix — `plugin_<pluginIdSafe>_<tool>`
 * (D015) — so that prefix *is* the attribution: the host never guesses an owner
 * from a tool name's shape, it asks which candidate plugin's own prefix the row
 * starts with. A host tool and another plugin's tool therefore never match, and
 * two ids that sanitize to the same prefix cancel out rather than one of them
 * silently taking the other's card.
 */
export function toolOwnerPluginId(
  toolName: string | undefined,
  candidates: readonly { id: string }[],
): string | undefined {
  if (!toolName) return undefined;
  let owner: string | undefined;
  for (const candidate of candidates) {
    if (!toolName.startsWith(pluginToolName(candidate.id, ""))) continue;
    if (owner !== undefined) return undefined;
    owner = candidate.id;
  }
  return owner;
}

/**
 * Props for one `toolCard` registration: the tool row whose card body the
 * component draws, plus the session it belongs to.
 *
 * This is the one position where the host really knows the producing plugin, so
 * `entry.pluginId` is set from the tool's own namespace (D14): the mount offers
 * a plugin only its own rows, and the component can confirm that with
 * `props.entry.pluginId === pi.plugin.id` before drawing anything.
 */
export function toolCardSlotProps(
  message: Pick<UiMessage, "id" | "role">,
  sessionId: string,
  ownerPluginId: string,
): PiRendererEntryExtraProps {
  return entryExtraSlotProps(
    { ...transcriptEntryIdentity(message), pluginId: ownerPluginId },
    sessionId,
  );
}
