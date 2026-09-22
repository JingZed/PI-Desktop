/**
 * Pure helpers for the composer's plugin trigger slot
 * (`docs/plugin-plan/ui/composer/`).
 *
 * Triggers are fixed to `@` `#` `/` (one symbol per plugin, duplicates
 * refuse with PLUGIN_SLOT_DUPLICATE). `@` and `/` stay host-owned for file
 * references and slash commands; a plugin claim of either is refused at
 * registration. A `#` token fires only from line start or after whitespace,
 * never mid-word, and the host resolves candidates with `query`.
 */

/** Detect a `#plugin` token at the cursor; null when none is active. */
export function detectPluginHashTrigger(
  value: string,
  cursor: number,
): { query: string; tokenStart: number; tokenEnd: number } | null {
  if (cursor < 0 || cursor > value.length) return null;
  // Scan back to the nearest delimiter; the token must start with "#".
  let start = cursor;
  while (start > 0 && !isTriggerDelimiter(value[start - 1])) start -= 1;
  const token = value.slice(start, cursor);
  if (!token.startsWith("#") || token.length < 1) return null;
  // 行首或空白后: the character before "#" must be a boundary. The scan-back
  // already guarantees the token has no delimiter inside, so this only
  // rejects tokens that begin mid-word ("abc#def").
  if (start > 0 && !isTriggerDelimiter(value[start - 1])) return null;
  // A quoted or markdown-ish prefix ("#tag" inside emphasis, headings) is out
  // of scope: any "#" that starts a boundary token is the plugin trigger.
  return { query: token.slice(1), tokenStart: start, tokenEnd: cursor };
}

function isTriggerDelimiter(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * In-draft token records for the composerToken slot: label shown in the
 * draft chip, send data serialized into the submit payload.
 */
export type ComposerPluginToken = {
  readonly pluginId: string;
  readonly label: string;
  readonly send: unknown;
};

/**
 * The single-draft cap: tokens up to this many stay individual; the 9th
 * onward folds into the host ⧉ +N chip. Data is never dropped — the
 * overflow chips keep their records and serialize at send time.
 */
export const COMPOSER_PLUGIN_TOKEN_LIMIT = 8;

/** True when the draft already holds the cap and a new token must fold. */
export function pluginTokenAtLimit(count: number): boolean {
  return count >= COMPOSER_PLUGIN_TOKEN_LIMIT;
}

/**
 * Serialized `#token` payload for the model prompt: visible labels plus a
 * fenced data block carrying every token's `send` value (folded overflow
 * included), so 发送 payload 不丢.
 */
export function serializePluginTokens(
  draft: string,
  tokens: readonly ComposerPluginToken[],
): string {
  if (tokens.length === 0) return draft;
  const dataLines = tokens
    .map((token) =>
      JSON.stringify({
        pluginId: token.pluginId,
        label: token.label,
        send: token.send,
      }),
    )
    .join("\n");
  const visible = tokens.map((token) => `#${token.label}`).join(" ");
  return `${draft}\n\n${visible}\n\`\`\`pi-plugin-tokens\n${dataLines}\n\`\`\``;
}
