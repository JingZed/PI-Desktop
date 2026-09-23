/**
 * toolCard + blockRenderer demos (docs/plugin-plan/ui/tool-card and
 * /block-renderer, demo.html): the db-query card draws the plugin's own
 * tool only (no-claim), and the chart block takes over a whole code fence
 * for the pluginId:lang key, falling back to the raw source on parse errors.
 */
import { createElement as h } from "react";

const BAR_COLORS = ["#c27aff", "#a78bff", "#8f7dff", "#7b9bff", "#6cb2ff"];
const DEFAULT_SQL = "SELECT customer, COUNT(*) AS orders\nFROM orders WHERE created_at >= '2026-08-01'\nGROUP BY customer ORDER BY orders DESC LIMIT 5;";

export function StatsCard({ toolName, toolStatus, toolArgs, toolResult, toolError, durationMs }) {
  const head = h("div", { className: "slot-demo-title-row" },
    h("h4", null, "toolCard · " + toolName),
    h("span", { className: "slot-demo-own" }, "只画自己的工具"));
  if (toolStatus === "running") {
    return h("div", { className: "slot-demo-card" }, head, h("div", null, "running…"));
  }
  if (toolStatus === "error") {
    // 失败是数据，不是抛错。
    return h("div", { className: "slot-demo-card" }, head,
      h("div", { className: "slot-demo-error" },
        "failed: " + String(toolError?.message ?? toolError ?? "unknown error")));
  }
  const entries = toolResult && typeof toolResult === "object" ? Object.entries(toolResult) : [];
  return h("div", { className: "slot-demo-card" },
    head,
    h("div", { className: "slot-demo-sql" }, String(toolArgs?.sql ?? DEFAULT_SQL)),
    h("table", { className: "slot-demo-table" },
      h("thead", null, h("tr", null,
        h("th", null, "field"),
        h("th", { style: { textAlign: "right" } }, "value"))),
      h("tbody", null,
        (entries.length ? entries : [["demo", "no result yet"]]).map(([key, value]) =>
          h("tr", { key: String(key) },
            h("td", null, String(key)),
            h("td", { className: "num" }, String(value)))))),
    typeof durationMs === "number"
      ? h("div", { className: "slot-demo-legend" }, durationMs + "ms")
      : null);
}

export function ChartBlock({ language, source }) {
  let bars = null;
  let error = null;
  try {
    const parsed = JSON.parse(source);
    if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
    bars = parsed.map((entry) => ({
      label: String(entry.label ?? "?"),
      value: Number(entry.value) || 0,
    }));
    if (!bars.length) throw new Error("empty data");
  } catch (cause) {
    error = cause;
  }
  const max = bars ? Math.max(...bars.map((bar) => bar.value), 1) : 1;
  return h("div", { className: "slot-demo-card" },
    h("div", { className: "slot-demo-title-row" },
      h("h4", null, "blockRenderer · " + language),
      h("span", { className: "slot-demo-own" }, "整块接管")),
    error
      ? h("div", null,
          h("div", { className: "slot-demo-error" }, "render failed: " + error.message),
          h("pre", { className: "slot-demo-sql" }, source))
      : h("div", null,
          h("svg", {
            viewBox: "0 0 420 140",
            style: { display: "block", width: "100%" },
            "aria-hidden": "true",
          },
            bars.map((bar, index) => {
              const height = Math.max(6, Math.round((bar.value / max) * 110));
              return h("rect", {
                key: bar.label,
                x: 30 + index * 80,
                y: 130 - height,
                width: 48,
                height,
                rx: 6,
                fill: BAR_COLORS[index % BAR_COLORS.length],
              });
            })),
          h("div", { className: "slot-demo-legend" },
            bars.map((bar, index) =>
              h("span", { key: bar.label },
                h("span", {
                  className: "dot",
                  style: { background: BAR_COLORS[index % BAR_COLORS.length] },
                }),
                bar.label + " " + bar.value)))));
}
