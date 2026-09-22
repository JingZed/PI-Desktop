/**
 * UI Slots Demo — headless entry (`demo.ui-slots`).
 *
 * Registers one low-risk tool (the toolCard no-claim gate only accepts cards
 * for tools the plugin itself declares) and answers one `plugin.call` method
 * so the slot components have something real to fetch across the relay.
 */

async function onLoad() {
  await pi.agent.registerTool({
    name: "slot_demo_stats",
    description: "Return fake usage stats for the toolCard demo",
    risk: "low",
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
    },
    execute: async (args) => {
      const query = String(args?.query ?? "");
      let calls = 0;
      try {
        calls = parseInt(query.replace(/\D+/g, ""), 10) || 0;
      } catch {
        calls = 0;
      }
      return {
        ok: true,
        query,
        total: 1200 + calls * 37,
        average: 42.5,
        label: "slot-demo stats",
      };
    },
  });
}

async function onUnload() {
  await pi.agent.unregisterTool("slot_demo_stats");
}

/**
 * The `plugin.call` relay target (`stats.summary`). Args come from the
 * renderer slot components; the answer must stay serializable JSON.
 */
async function onRendererCall(method, args) {
  if (method === "stats.summary") {
    const scale = Number(args?.scale) || 1;
    return {
      total: Math.round(1200 * scale),
      average: 42.5,
      generatedAt: new Date().toISOString(),
    };
  }
  throw new Error(`unknown renderer method: ${method}`);
}

module.exports = {
  onLoad,
  onUnload,
  onRendererCall,
};
