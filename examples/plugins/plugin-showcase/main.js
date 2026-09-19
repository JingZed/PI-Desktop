/**
 * Headless half of the plugin showcase.
 *
 * This is the plugin's own process, the third place plugin code can run next to
 * the app window (`renderer/index.mjs`) and the agent sidecar
 * (`agent/extension.js`). It exists for two reasons:
 *
 * 1. A manifest must declare an entry. `main`, `renderer`, or a plugin page is
 *    what makes a plugin runnable; `contributes.agentExtensions` is a
 *    contribution, not an entry, so a manifest that declares only an agent
 *    extension is refused at install (spec 07-plugins/02 §7 rule 19; host-core
 *    says `one of main/renderer/panel/view/destination required`).
 * 2. The command below is this plugin's visible presence in the app: it
 *    registers in the command palette and says what the two other halves do.
 *    Nothing else belongs here — the renderer half draws inside the window and
 *    the agent half runs inside the sidecar, and neither of them needs
 *    something to be relayed through this process.
 */

/** Command id, declared in `contributes.commands`. */
const COMMAND_ID = "acme.plugin-showcase.about";

async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: "Plugin Showcase: What this plugin adds",
    keywords: ["showcase", "slots", "runtime", "renderer", "agent", "demo"],
    run: async () => {
      await pi.ui.showToast(
        "Plugin Showcase: its renderer half draws an entryExtra badge and the fenced " +
          "acme.plugin-showcase:kv language, and its agent half gates shell commands, watches " +
          "the turn, reports turn facts, and notices session lifecycle changes.",
      );
    },
  });
}

async function onUnload() {
  await pi.commands.unregister(COMMAND_ID);
}

module.exports = {
  onLoad,
  onUnload,
};
