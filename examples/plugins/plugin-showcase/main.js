/**
 * Headless half of the plugin showcase.
 *
 * This is the plugin's own process, the third place plugin code can run next to
 * the app window (`renderer/index.mjs`) and the agent sidecar
 * (`agent/extension.js`). It exists for three reasons:
 *
 * 1. A manifest must declare an entry. `main`, `renderer`, or a plugin page is
 *    what makes a plugin runnable; `contributes.agentExtensions` is a
 *    contribution, not an entry, so a manifest that declares only an agent
 *    extension is refused at install (spec 07-plugins/02 §7 rule 19; host-core
 *    says `one of main/renderer/panel/view/destination required`).
 * 2. The command below is this plugin's visible presence in the app: it
 *    registers in the command palette and says what the other halves do.
 * 3. The tool below is what the renderer half's `toolCard` demonstration needs:
 *    that position is offered only to the owner of the tool row, and ownership
 *    is the forced `plugin_<id>_<tool>` prefix, so a plugin with no tool of its
 *    own can never see that slot. The tool is small on purpose — it formats a
 *    note — because the point is the card the renderer draws for it, not the
 *    tool.
 */

/** Command id, declared in `contributes.commands`. */
const COMMAND_ID = "acme.plugin-showcase.about";

/** Tool name as declared in `contributes.agentTools`; the host prefixes it. */
const TOOL_NAME = "showcase_note";

async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: "Plugin Showcase: What this plugin adds",
    keywords: ["showcase", "slots", "runtime", "renderer", "agent", "demo"],
    run: async () => {
      await pi.ui.showToast(
        "Plugin Showcase: its renderer half draws all ten UI slots (three of them only " +
          "when you open them from the composer), its headless half registers the " +
          "showcase_note tool, and its agent half gates shell commands, watches the turn, " +
          "reports turn facts, and notices session lifecycle changes.",
      );
    },
  });

  // `execute` runs in this process, never in the window or the sidecar. The
  // model sees the forced name `plugin_acme_plugin_showcase_showcase_note`.
  await pi.agent.registerTool({
    name: TOOL_NAME,
    description: "Format a short note in the plugin showcase's own tool card",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "the note to format" },
      },
      required: ["text"],
    },
    execute: async (args) => {
      const text = typeof args?.text === "string" ? args.text : "";
      return {
        ok: true,
        note: `Plugin Showcase note: ${text}`,
        characters: text.length,
      };
    },
  });
}

async function onUnload() {
  await pi.commands.unregister(COMMAND_ID);
  await pi.agent.unregisterTool(TOOL_NAME);
}

module.exports = {
  onLoad,
  onUnload,
};
