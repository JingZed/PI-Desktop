/**
 * UI Slots Demo — renderer entry (`demo.ui-slots`).
 *
 * Registers every finalized UI slot in one plugin, plus the self-dialog
 * sample (`docs/plugin-plan/ui/self-dialog/`): a plugin-drawn modal using
 * the host's p-overlay/p-dialog tool classes, honoring the four ground
 * rules — drawn inside its own component, gone on unload, never above the
 * host safety layer (z 600..899 < 900), later plugins stack above earlier
 * ones with no host arbitration.
 *
 * Plain ES module, no build step: `react` resolves to the host's single
 * React through the document import map.
 */
import { createElement as h, useState } from "react";

const TOOL_NAME = "slot_demo_stats";
const CHART_LANGUAGE = "demo.ui-slots:chart";

/* ---------- shared bits ------------------------------------------------- */

function useDemoStyles(pi) {
  const cssId = pi.plugin.id.replace(/[^A-Za-z0-9_-]/g, "-");
  pi.ui.injectStyle(`
.pi-plugin-slot.${cssId} .slot-demo-card {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(255 255 255 / 0.08);
  border-radius: 10px;
  background: rgb(255 255 255 / 0.04);
  font-size: 12.5px;
  line-height: 1.55;
}
.pi-plugin-slot.${cssId} .slot-demo-card h4 {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.75;
}
.pi-plugin-slot.${cssId} .slot-demo-btn {
  margin: 4px 6px 0 0;
  padding: 2px 10px;
  border: 1px solid rgb(255 255 255 / 0.16);
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.pi-plugin-slot.${cssId} .slot-demo-btn:hover {
  background: rgb(255 255 255 / 0.08);
}
.pi-plugin-slot.${cssId} .slot-demo-bar {
  height: 10px;
  margin: 3px 0;
  border-radius: 4px;
  background: rgb(124 92 255 / 0.55);
}
.pi-plugin-slot.${cssId} .slot-demo-mono {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: 11.5px;
  white-space: pre-wrap;
}
`);
  return cssId;
}

/* ---------- entryExtra -------------------------------------------------- */

function EntryExtraCard({ message, dispatch }) {
  const [result, setResult] = useState("no call yet");
  const rows = Array.from({ length: 18 }, (_, i) => `metric-${i + 1}`);
  return h("div", { className: "slot-demo-card" },
    h("h4", null, `entryExtra · reply ${message.id.slice(0, 8)}`),
    h("div", { className: "slot-demo-mono" },
      rows.map((row) => `${row.padEnd(12, " ")} ██████ 42.5\n`).join("")),
    h("button", {
      className: "slot-demo-btn",
      onClick: () => {
        dispatch("plugin.call", { method: "stats.summary", args: { scale: 2 } })
          .then((answer) => setResult(JSON.stringify(answer)))
          .catch((error) => setResult(`${error.code ?? "ERROR"}: ${error.message}`));
      },
    }, "plugin.call → stats.summary"),
    h("button", {
      className: "slot-demo-btn",
      onClick: () => dispatch("composer.insertText", "Inserted by demo.ui-slots"),
    }, "composer.insertText"),
    h("div", { className: "slot-demo-mono" }, result),
  );
}

/* ---------- user / assistant actions ------------------------------------ */

function ActionButton({ position, dispatch }) {
  const [clicked, setClicked] = useState(0);
  return h("button", {
    className: "slot-demo-btn",
    title: `plugin action (${position})`,
    onClick: () => {
      setClicked((n) => n + 1);
      dispatch("composer.insertText", `demo action (${position}) #${clicked + 1} `);
    },
  }, clicked > 0 ? `demo ×${clicked}` : "demo");
}

/* ---------- toolCard ---------------------------------------------------- */

function StatsCard({ toolName, toolCallId, toolStatus, toolArgs, toolResult, toolError, durationMs }) {
  if (toolStatus === "running") {
    return h("div", { className: "slot-demo-card" },
      h("h4", null, `toolCard · ${toolName} · call ${toolCallId.slice(0, 8)}`),
      h("div", null, "running…"));
  }
  if (toolStatus === "error") {
    // Failure is data, drawn by the card.
    return h("div", { className: "slot-demo-card" },
      h("h4", null, `toolCard · ${toolName}`),
      h("div", { style: { color: "#ff6764" } },
        `failed: ${String(toolError?.message ?? toolError ?? "unknown error")}`));
  }
  const rows = toolResult && typeof toolResult === "object" ? Object.entries(toolResult) : [];
  return h("div", { className: "slot-demo-card" },
    h("h4", null, `toolCard · ${toolName}${typeof durationMs === "number" ? ` · ${durationMs}ms` : ""}`),
    h("div", { className: "slot-demo-mono" },
      rows.map(([key, value]) => `${key}: ${String(value)}\n`).join("") ||
        `args: ${JSON.stringify(toolArgs ?? null)}`));
}

/* ---------- blockRenderer ------------------------------------------------ */

function ChartBlock({ language, source }) {
  let bars = null;
  let error = null;
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    bars = parsed.map((entry) => ({
      label: String(entry.label ?? "?"),
      value: Number(entry.value) || 0,
    }));
  } catch (cause) {
    error = cause;
  }
  return h("div", { className: "slot-demo-card" },
    h("h4", null, `blockRenderer · ${language}`),
    error
      ? h("div", null,
          h("div", { style: { color: "#ff6764" } }, `render failed: ${error.message}`),
          h("pre", { className: "slot-demo-mono" }, source))
      : h("div", null,
          bars.map((bar) =>
            h("div", { key: bar.label, style: { display: "flex", alignItems: "center", gap: 6 } },
              h("span", { style: { width: 64 } }, bar.label),
              h("div", {
                className: "slot-demo-bar",
                style: { width: Math.min(220, bar.value) },
              }),
              h("span", { className: "slot-demo-mono" }, String(bar.value)))),
          h("div", { className: "slot-demo-mono" }, source)));
}

/* ---------- composer slots ---------------------------------------------- */

function ComposerControl({ position, dispatch }) {
  return h("button", {
    className: "slot-demo-btn",
    title: `composer control (${position})`,
    onClick: () => dispatch("composer.insertText", "[demo token] "),
  }, "＋demo");
}

function ComposerTrigger({ query, dispatch }) {
  const items = ["alpha", "beta", "gamma"]
    .filter((name) => name.toLowerCase().startsWith(query.toLowerCase()))
    .map((name) => ({ label: name, value: { intent: "demo", name } }));
  return h("div", { className: "slot-demo-card" },
    h("h4", null, `composerTrigger "#${query}" — click to accept`),
    items.length
      ? items.map((item) =>
          h("button", {
            key: item.label,
            className: "slot-demo-btn",
            style: { display: "block", width: "100%", textAlign: "left" },
            onClick: () =>
              dispatch("composer.acceptTriggerItem", {
                label: item.label,
                value: item.value,
              }).catch((error) =>
                console.warn("[ui-slots-demo] accept rejected", error.code ?? error)),
          }, `#${item.label}`))
      : h("div", null, "no match"));
}

function ComposerToken({ label }) {
  return h("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      padding: "0 6px",
      borderRadius: 6,
      border: "1px solid rgb(124 92 255 / 0.5)",
      fontSize: 11,
    },
  }, `#${label}`);
}

/* ---------- self-dialog sample ------------------------------------------ */

function SelfDialogLauncher() {
  const [open, setOpen] = useState(false);
  return h("div", null,
    h("button", {
      className: "slot-demo-btn",
      onClick: () => setOpen(true),
    }, "open self-dialog"),
    open
      ? h("div", { className: "p-overlay", onClick: (event) => {
          if (event.target === event.currentTarget) setOpen(false);
        } },
          h("div", { className: "p-dialog", role: "dialog", "aria-label": "UI Slots Demo dialog" },
            h("div", { className: "p-dialog-head" },
              h("span", null, "UI Slots Demo"),
              h("button", { className: "p-notice__dismiss", onClick: () => setOpen(false) }, "✕")),
            h("div", { className: "p-dialog__body" },
              h("p", null, "Plugin-drawn modal. z 600..899 — the host safety layer (900) always wins; Esc does not close it, only this ✕ does.")),
            h("div", { className: "p-dialog__foot" },
              h("button", { className: "slot-demo-btn", onClick: () => setOpen(false) }, "close"))))
      : null);
}

/* ---------- registration ------------------------------------------------ */

export function onLoad(pi) {
  const cssId = useDemoStyles(pi);
  void cssId;

  pi.slots.register("entryExtra", EntryExtraCard);
  pi.slots.register("userAction", ActionButton);
  // positions subset demo: only the right side of the assistant bar.
  pi.slots.register("assistantAction", ActionButton, { positions: ["right"] });
  // toolCard no-claim: this tool is declared in this plugin's manifest.
  pi.slots.register("toolCard", StatsCard, { toolName: TOOL_NAME });
  pi.slots.register("blockRenderer", ChartBlock, { language: CHART_LANGUAGE });
  pi.slots.register("composerControl", ComposerControl, { positions: ["left"] });
  pi.slots.register("composerTrigger", ComposerTrigger, { trigger: "#" });
  pi.slots.register("composerToken", ComposerToken);

  // The self-dialog sample rides inside the entryExtra card.
  pi.slots.register("entryExtra", SelfDialogLauncher);
}

export function onUnload() {
  // Registrations and injected styles are torn down by the host
  // (卸载摘注册); the self-dialog disappears with this module's components.
}
