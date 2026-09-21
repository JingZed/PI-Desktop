import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { catalogs } from "@pi-desktop/i18n";
import { createServer } from "vite";

test("topbar caps visible titles while preserving complete tooltip text", async () => {
  const server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    server: { middlewareMode: true, hmr: false, ws: false },
    esbuild: { jsx: "automatic" },
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { ConversationTopbar } = await server.ssrLoadModule("/src/components/ConversationTopbar.tsx");
    const { truncateConversationTitle } = await server.ssrLoadModule("/src/lib/conversation-title.ts");
    const { useAppStore } = await server.ssrLoadModule("/src/stores/app-store.ts");
    const i18n = createInstance();
    await i18n.init({ lng: "en", resources: { en: { translation: catalogs.en } } });
    for (const title of ["Draft reference check", "修复会话标题在窗口顶部的显示", "New task"]) {
      Object.assign(useAppStore.getInitialState(), {
        activeSessionId: "title-test",
        sessions: [{ id: "title-test", title }],
        workspace: { path: "/project", name: "Project" },
      });
      for (const sidebarCollapsed of [false, true]) {
        const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n },
          createElement(ConversationTopbar, {
            sidebarCollapsed, workPanelOpen: false,
            onToggleSidebar() {}, onNewTask() {}, onOpenSearch() {},
          }),
        ));
        const fullTitle = title === "New task" ? catalogs.en.chat.untitledTask : title;
        assert.equal(
          html.match(/class="ct-title">([^<]*)<\/span>/)?.[1],
          truncateConversationTitle(fullTitle),
        );
        assert.ok(html.includes(`title="Project · ${fullTitle}"`));
      }
    }
  } finally {
    await server.close();
  }
});
