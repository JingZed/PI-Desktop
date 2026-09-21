import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  truncateConversationTitle,
} from "../src/lib/conversation-title.ts";

const topbarSource = await readFile(
  new URL("../src/components/ConversationTopbar.tsx", import.meta.url),
  "utf8",
);

test("conversation top-bar titles stay within the 20-character display budget", () => {
  assert.equal(CONVERSATION_TITLE_MAX_LENGTH, 20);
  assert.equal(
    truncateConversationTitle("12345678901234567890"),
    "12345678901234567890",
  );
  assert.equal(
    truncateConversationTitle("123456789012345678901"),
    "1234567890123456789…",
  );
  assert.equal(
    truncateConversationTitle("修复同步代码并更新对话区顶部标题显示逻辑"),
    "修复同步代码并更新对话区顶部标题显示逻辑",
  );
  assert.equal(
    truncateConversationTitle("😀".repeat(21)),
    `${"😀".repeat(19)}…`,
  );
});

test("the top bar keeps the full title for its tooltip while rendering the capped label", () => {
  assert.match(topbarSource, /truncateConversationTitle\(fullTaskTitle\)/);
  assert.match(
    topbarSource,
    /className="ct-title-wrap"[\s\S]*?title=\{project \? `\$\{project\} · \$\{fullTaskTitle\}` : fullTaskTitle\}/,
  );
  assert.match(topbarSource, /<span className="ct-title">\{visibleTaskTitle\}<\/span>/);
});
