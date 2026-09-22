/**
 * Pure helpers for the `blockRenderer` slot (`docs/plugin-plan/ui/block-renderer/`).
 *
 * The contract: a plugin claims the whole code block for a fence language
 * registered as `<pluginId>:lang`; the host hands `{ language, source }`
 * once when the fence closes (props-once), and the plugin owns the chrome.
 * The host keeps exactly one guarantee — a block taller than 4000px counts
 * as a render failure and falls back to the host code block.
 */

/** The one host-side clamp on a plugin-drawn block. */
export const BLOCK_RENDERER_MAX_HEIGHT_PX = 4000;

/** True when a block's drawn content exceeds the host clamp. */
export function blockRendererOverflow(contentHeight: number): boolean {
  return contentHeight > BLOCK_RENDERER_MAX_HEIGHT_PX;
}

/**
 * Fast path for the render loop: only a label that carries the
 * `<pluginId>:` prefix shape can hit a registration, so plain languages
 * (`json`, `ts`, `mermaid`, …) never touch the slot registry.
 */
export function blockRendererCandidate(lang: string): string | undefined {
  const trimmed = lang.trim();
  return trimmed.includes(":") ? trimmed : undefined;
}
