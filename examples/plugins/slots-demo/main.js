/**
 * Headless half of the slots demo.
 *
 * A plugin may declare both entries: this module runs in the plugin's own
 * process with the host-injected `pi` global, and `renderer/index.mjs` runs
 * inside the app window (spec 07-plugins/16 §2A.1 — the tiers are orthogonal).
 * Only the command below lives here; everything visible is registered by the
 * renderer module, which is the part this example is about.
 */

/** Command id, declared in `contributes.commands`. */
const COMMAND_ID = "acme.slots-demo.about";

async function onLoad() {
  await pi.commands.register({
    id: COMMAND_ID,
    title: "Slots Demo: What this plugin adds",
    keywords: ["slots", "renderer", "demo"],
    run: async () => {
      // `renderer` unread by the host is a diagnostic, not a crash, so this
      // toast is the only way to tell "loaded" from "loaded but never drawn".
      await pi.ui.showToast(
        "Slots Demo registered an entryExtra badge, a modal, and one stylesheet.",
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
