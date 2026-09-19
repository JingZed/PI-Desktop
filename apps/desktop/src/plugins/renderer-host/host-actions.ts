/**
 * The host's implementations of the renderer actions this release performs
 * (ADR 0294). The relay (`./relay`) owns the declaration check and the routing;
 * this module is what it routes to, and it is installed once at app start from
 * `src/main.tsx` next to the other renderer-side installs.
 *
 * Three of the nine vocabulary names are implemented here:
 *
 * - `plugin.call { method, args? }` forwards to the plugin's own headless entry
 *   through `api.pluginRendererCall`, which re-checks the manifest in the main
 *   process and relays to that plugin's process.
 * - `ui.toast { message, variant? }` raises the shell's existing toast.
 * - `composer.replaceDraft { text }` writes the draft through the one external
 *   path a mounted composer consumes.
 *
 * The other six names have no handler, so the relay refuses them as
 * `PLUGIN_ACTION_UNROUTED` instead of resolving `undefined`.
 *
 * Every failure is a coded error and exactly one diagnostic on the plugin's
 * row. A payload refused here is reported here; a rejection that came back from
 * the main process or from the plugin's own entry is reported here too, and
 * rethrown unchanged — the relay must not report a handler rejection, so no
 * failure lands on the row twice. It is a contract for plugins that behave, not
 * a security boundary.
 */
import { api } from "../../lib/api";
import { useAppStore } from "../../stores/app-store";
import { pluginSlots, type PluginSlotDiagnostic } from "../renderer-slots/registry";
import { refuseRendererAction, registerHostRendererAction } from "./relay";

/**
 * How long a `composer.replaceDraft` write waits for a mounted composer to
 * consume it. A composer consumes the prefill on its next commit, so this is
 * only ever spent when there is no composer — a frame is not a deadline.
 */
export const DRAFT_PREFILL_DEADLINE_MS = 500;

const TOAST_VARIANTS = ["info", "success", "error"] as const;
type ToastVariant = (typeof TOAST_VARIANTS)[number];

function isToastVariant(value: unknown): value is ToastVariant {
  return typeof value === "string" && (TOAST_VARIANTS as readonly string[]).includes(value);
}

/** Payloads are plugin input: an object, or nothing this host can read. */
function payloadRecord(payload: unknown): Record<string, unknown> | null {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/**
 * `plugin.call`: runs `method` inside the calling plugin's own entry and answers
 * with its value. A missing method is refused here, before anything crosses IPC.
 *
 * A rejection that comes back from `api.pluginRendererCall` was produced by the
 * main process or by the plugin's own headless entry, and this is where it
 * becomes visible: the same refusal is recorded once on the plugin's row, and
 * the error is rethrown unchanged so the component still reads its code and
 * message. Reporting it here rather than in the wrapper keeps the generic
 * preload module free of plugin-row concerns.
 */
async function forwardRendererCall(payload: unknown, pluginId: string): Promise<unknown> {
  const record = payloadRecord(payload);
  const method = record?.method;
  if (typeof method !== "string" || !method.trim()) {
    throw refuseRendererAction(
      pluginId,
      "plugin.call",
      "PLUGIN_ACTION_INVALID_PAYLOAD",
      'plugin.call needs a non-empty "method" string',
    );
  }
  try {
    return await api.pluginRendererCall(pluginId, method, record?.args);
  } catch (error) {
    reportForwardedCallFailure(pluginId, method, error);
    throw error;
  }
}

/**
 * One forwarded call's failure on the plugin's row, under exactly the code the
 * caller has to branch on: a refusal from the main process (`PLUGIN_CALL_*`), a
 * code the plugin's own entry threw with, or the blanket class when it named
 * none. The detail names the method that failed, because a row that only says
 * "a call was refused" is not something a plugin author can act on.
 */
function reportForwardedCallFailure(pluginId: string, method: string, error: unknown): void {
  const raw = (error as { code?: unknown } | null)?.code;
  const code = typeof raw === "string" && raw ? raw : "PLUGIN_CALL_FAILED";
  pluginSlots.report({
    pluginId,
    code: code as PluginSlotDiagnostic["code"],
    detail: `${method}: ${error instanceof Error ? error.message : String(error)}`,
  });
}

/** `ui.toast`: the shell's existing toast, with the store's own default variant. */
async function showHostToast(payload: unknown, pluginId: string): Promise<void> {
  const record = payloadRecord(payload);
  const message = record?.message;
  if (typeof message !== "string" || !message.trim()) {
    throw refuseRendererAction(
      pluginId,
      "ui.toast",
      "PLUGIN_ACTION_INVALID_PAYLOAD",
      'ui.toast needs a non-empty "message" string',
    );
  }
  const variant = record?.variant;
  if (variant !== undefined && !isToastVariant(variant)) {
    throw refuseRendererAction(
      pluginId,
      "ui.toast",
      "PLUGIN_ACTION_INVALID_PAYLOAD",
      `ui.toast "variant" must be one of ${TOAST_VARIANTS.join(", ")}`,
    );
  }
  useAppStore.getState().showToast(message, variant === undefined ? undefined : { variant });
}

/**
 * `composer.replaceDraft`: replaces the active session's draft text.
 *
 * The live draft is React state inside `useComposerDraft`; the one external
 * write a mounted composer consumes is the store's `composerPrefill`, which the
 * composer applies verbatim and then clears. This writes that prefill for the
 * active session and resolves only once the composer has cleared it. A request
 * no composer consumes — no session open, or a surface with no composer mounted
 * — is cleared again and refused rather than reported as written.
 *
 * `fileReferences: []` is part of the write: the action replaces the *whole*
 * draft, so the resulting draft is exactly the payload text and no references.
 */
async function replaceComposerDraft(payload: unknown, pluginId: string): Promise<void> {
  const record = payloadRecord(payload);
  const text = record?.text;
  if (typeof text !== "string") {
    throw refuseRendererAction(
      pluginId,
      "composer.replaceDraft",
      "PLUGIN_ACTION_INVALID_PAYLOAD",
      'composer.replaceDraft needs a "text" string',
    );
  }
  const sessionId = useAppStore.getState().activeSessionId;
  if (!sessionId) {
    throw refuseRendererAction(
      pluginId,
      "composer.replaceDraft",
      "PLUGIN_ACTION_DRAFT_UNCONSUMED",
      "composer.replaceDraft found no active session to write into",
    );
  }
  useAppStore.setState({ composerPrefill: { sessionId, text, fileReferences: [] } });
  if (await prefillConsumed(DRAFT_PREFILL_DEADLINE_MS)) return;
  useAppStore.getState().clearComposerPrefill();
  throw refuseRendererAction(
    pluginId,
    "composer.replaceDraft",
    "PLUGIN_ACTION_DRAFT_UNCONSUMED",
    `composer.replaceDraft was not consumed within ${DRAFT_PREFILL_DEADLINE_MS} ms`,
  );
}

/** True once the store's prefill is gone, which is how the composer consumes it. */
function prefillConsumed(deadlineMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (consumed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(consumed);
    };
    unsubscribe = useAppStore.subscribe(() => {
      if (useAppStore.getState().composerPrefill === null) finish(true);
    });
    if (useAppStore.getState().composerPrefill === null) finish(true);
    else timer = setTimeout(() => finish(false), deadlineMs);
  });
}

/**
 * Registers the three implemented actions. Called once from the app entry;
 * calling it again registers the same functions, so the relay is never left
 * half wired.
 */
export function installRendererHostActions(): void {
  registerHostRendererAction("plugin.call", forwardRendererCall);
  registerHostRendererAction("ui.toast", showHostToast);
  registerHostRendererAction("composer.replaceDraft", replaceComposerDraft);
}
