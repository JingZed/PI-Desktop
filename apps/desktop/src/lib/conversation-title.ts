/** Maximum number of Unicode code points shown in the conversation top bar. */
export const CONVERSATION_TITLE_MAX_LENGTH = 20;

/**
 * Keep the top-bar label compact without changing the full session title.
 * The ellipsis occupies one character in the display budget, so the result
 * never exceeds CONVERSATION_TITLE_MAX_LENGTH code points.
 */
export function truncateConversationTitle(
  title: string,
  maxLength = CONVERSATION_TITLE_MAX_LENGTH,
): string {
  const characters = Array.from(title);
  if (characters.length <= maxLength) return title;
  if (maxLength <= 0) return "";
  return `${characters.slice(0, maxLength - 1).join("")}…`;
}
