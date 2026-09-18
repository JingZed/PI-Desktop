import { IPC, type Result } from "@pi-desktop/shared";

/**
 * The preload bridge, captured once and then removed from `window`.
 *
 * A trusted plugin's renderer code runs in this same realm (ADR 0287), so
 * anything left on `window` is reachable from plugin code. The host UI needs
 * the bridge — `invoke`, the event subscriptions, the platform and locale
 * strings — and nothing else does, so this module captures the reference at
 * import time and deletes the global before the first plugin can look for it.
 *
 * Every shell module reads the bridge through here. Nothing else may touch
 * `window.piDesktop`, because by the time a component renders it is gone.
 */
export type PiDesktopBridge = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<Result<T>>;
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void;
  channels: typeof IPC;
  platform: NodeJS.Platform;
  locale?: string;
  getDroppedFilePath?: (file: File) => string | null;
};

type BridgeGlobal = { piDesktop?: PiDesktopBridge };

const globalScope = globalThis as BridgeGlobal;

const bridge: PiDesktopBridge | null = globalScope.piDesktop ?? null;

/**
 * Whether the bridge global is really gone. A plugin that finds it can call all
 * 234 whitelisted channels, so this is worth knowing rather than assuming:
 * `contextBridge` owns how the property was defined, and a future Electron that
 * seals it would otherwise fail silently.
 */
function removeBridgeGlobal(): boolean {
  try {
    return delete globalScope.piDesktop;
  } catch {
    // A non-configurable property throws; the capture above is still the only
    // reference the shell holds, so the app keeps working while the exposure
    // stays visible in `bridgeGlobalRemoved`.
    return false;
  }
}

export const bridgeGlobalRemoved = removeBridgeGlobal();

/** The captured bridge, or null in a browser-only context (tests, previews). */
export function getBridge(): PiDesktopBridge | null {
  return bridge;
}

/**
 * The platform string shortcut rendering keys off. Falls back to `darwin` for
 * the contexts that have no bridge at all.
 */
export function bridgePlatform(fallback = "darwin"): string {
  return bridge?.platform ?? fallback;
}

/** The locale the preload resolved, if there was a bridge to ask. */
export function bridgeLocale(): string | undefined {
  return bridge?.locale;
}
