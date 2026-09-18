import type { BrowserWindow, MessageBoxOptions } from "electron";
import { catalogs, resolveLocale } from "@pi-desktop/i18n";
import type { PermissionDecision } from "@pi-desktop/shared";

/**
 * The native confirmation for a tool the Agent wants to run.
 *
 * A tool-permission approval is the one place where the renderer must not be
 * able to decide: plugin code shares the document, the DOM and the JS realm
 * with the host UI, so anything it can read (including the broadcast
 * `tool_permission_request`) it can also forge, and any nonce or hidden field
 * that lives in the renderer is readable by that same code. The only
 * unforgeable answer is one this process owns, which is why the decision that
 * counts is the user's click in a main-process `showMessageBox` (the same
 * pattern as the plugin file/desktop consent dialogs).
 *
 * The prompt names the tool and shows the arguments and reason the host
 * recorded, never text a plugin authored, so a forged resolution cannot
 * relabel the request.
 *
 * `dialog` is imported lazily inside the service so the prompt shape below can
 * be asserted headlessly, without an Electron runtime.
 */

/** Largest argument preview the dialog shows; the rest is elided. */
export const MAX_ARGS_PREVIEW = 400;

/** What the main process needs to name in the prompt. */
export type ToolPermissionConsentRequest = {
  toolName: string;
  argsPreview?: unknown;
  risk?: "low" | "medium" | "high";
  reason?: string;
};

function argsPreviewText(argsPreview: unknown): string {
  if (argsPreview === undefined || argsPreview === null) return "";
  let text: string;
  if (typeof argsPreview === "string") {
    text = argsPreview;
  } else {
    try {
      text = JSON.stringify(argsPreview);
    } catch {
      text = String(argsPreview);
    }
  }
  return text.length > MAX_ARGS_PREVIEW ? `${text.slice(0, MAX_ARGS_PREVIEW)}…` : text;
}

/** Buttons in the order Electron receives them; the index is the answer. */
export function toolPermissionConsentDialogOptions(
  request: ToolPermissionConsentRequest,
  locale: string,
): MessageBoxOptions {
  const catalog = catalogs[resolveLocale(locale)];
  const strings = catalog.toolPermissionConsent;
  const preview = argsPreviewText(request.argsPreview);
  return {
    type: "warning",
    message: strings.message.replace("{tool}", request.toolName),
    detail: [
      request.risk ? catalog.permission.risk[request.risk] : "",
      preview ? strings.arguments.replace("{args}", preview) : "",
      request.reason ? strings.reason.replace("{reason}", request.reason) : "",
      strings.detail,
    ]
      .filter(Boolean)
      .join("\n\n"),
    buttons: [strings.deny, strings.allowOnce, strings.allowSession],
    // Escape and the red-X both land on Deny; a dismissed dialog must never
    // read as permission.
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

/** Anything that is not an explicit allow is a refusal. */
export function toolPermissionConsentAnswerFromResponse(
  response: number,
): PermissionDecision {
  if (response === 1) return "allow-once";
  if (response === 2) return "allow-session";
  return "deny";
}

/**
 * @param deps.getWindow the window to attach the dialog to, so the prompt
 *   cannot be lost behind it. A permission request can outlive the window and
 *   then the dialog stands on its own.
 */
export function createToolPermissionConsentService(deps: {
  getWindow: () => BrowserWindow | null;
  getLocale: () => string;
}): (request: ToolPermissionConsentRequest) => Promise<PermissionDecision> {
  return async (request) => {
    const options = toolPermissionConsentDialogOptions(request, deps.getLocale());
    const { dialog } = await import("electron");
    const window = deps.getWindow();
    const result =
      window && !window.isDestroyed()
        ? await dialog.showMessageBox(window, options)
        : await dialog.showMessageBox(options);
    return toolPermissionConsentAnswerFromResponse(result.response);
  };
}
