/**
 * entryExtra demos (docs/plugin-plan/ui/entry-extra/demo.html): the runnable
 * panel and the metric sparkline stack additively under the reply. The
 * self-dialog launcher (docs/plugin-plan/ui/self-dialog/demo.html) rides in
 * this slot too — the modal and the corner notice draw inside this
 * component's own tree, disappear on unload, stay under the host safety
 * layer, and close only through explicit UI actions.
 */
import { createElement as h, useState } from "react";

export function RunnerPanel({ message, dispatch }) {
  const [result, setResult] = useState("no call yet");
  return h("div", { className: "slot-demo-card" },
    h("div", { className: "slot-demo-title-row" },
      h("h4", null, "plugin_demo_runner · 可运行面板"),
      h("span", { className: "slot-demo-own" }, "additive")),
    h("div", { className: "slot-demo-run-row" },
      h("code", null, "pnpm test -- filter retry"),
      h("button", {
        className: "slot-demo-btn",
        onClick: () =>
          dispatch("plugin.call", { method: "stats.summary", args: { scale: 1 } })
            .then((answer) => setResult("ok total=" + answer.total + " average=" + answer.average))
            .catch((error) => setResult((error.code ?? "ERROR") + ": " + error.message)),
      }, "运行")),
    h("div", { className: "slot-demo-rows" }, result));
}

export function SparkPanel() {
  const points = "0,40 40,36 80,28 120,30 160,18 200,22 240,10 280,14";
  return h("div", { className: "slot-demo-card" },
    h("div", { className: "slot-demo-title-row" },
      h("h4", null, "plugin_demo_spark · 指标缩略图"),
      h("span", { className: "slot-demo-own" }, "additive")),
    h("svg", {
      className: "slot-demo-spark",
      viewBox: "0 0 280 54",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    },
      h("polyline", { fill: "none", stroke: "#c27aff", "stroke-width": "2", points }),
      h("polyline", {
        fill: "rgb(194 122 255 / 0.18)",
        stroke: "none",
        points: points + " 280,54 0,54",
      })));
}

export function SelfDialogLauncher() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState(false);
  return h("div", { className: "slot-demo-card" },
    h("div", { className: "slot-demo-title-row" },
      h("h4", null, "self-dialog · 自理弹层"),
      h("span", { className: "slot-demo-own" }, "no slot")),
    h("div", { className: "slot-demo-run-row" },
      h("button", { className: "slot-demo-btn", onClick: () => setOpen(true) }, "翻译助手弹窗"),
      h("button", { className: "slot-demo-btn", onClick: () => setNotice(true) }, "翻译队列浮层")),
     // 模态: p-overlay + p-dialog, z 600..899, Esc 不关安全层, 关闭只走明确动作;
     // 宿主安全层 (z 900) always wins — 插件层之间不做仲裁, 后注册者自然叠在上。
    open
      ? h("div", { className: "p-overlay" },
          h("div", { className: "p-dialog", role: "dialog", "aria-label": "翻译助手" },
            h("div", { className: "p-dialog-head" },
              h("span", null, "翻译助手"),
              h("button", {
                className: "p-notice__dismiss",
                "aria-label": "关闭",
                onClick: () => setOpen(false),
              }, "✕")),
            h("div", { className: "p-dialog__body" },
              h("div", { className: "slot-demo-term-row" },
                h("span", null, "术语表"),
                h("span", { className: "slot-demo-term" }, "发版 → release"),
                h("span", { className: "slot-demo-term" }, "插槽 → slot")),
              h("div", { className: "slot-demo-translation" },
                "译文中…: The plugin slot boundary for the composer was agreed this week…")),
            h("div", { className: "p-dialog__foot" },
              h("button", { className: "slot-demo-btn", onClick: () => setOpen(false) }, "暂停"),
              h("button", { className: "slot-demo-btn", onClick: () => setOpen(false) }, "应用到原文"))))
      : null,
    // 角落浮层: p-overlay__corner 非阻塞, p-notice, ✕ 收起。
    notice
      ? h("div", { className: "p-overlay p-overlay__corner" },
          h("div", { className: "p-notice" },
            h("span", { className: "p-notice-icon", "aria-hidden": "true" }, "✚"),
            h("span", { className: "slot-demo-notice-body" },
              h("span", { className: "slot-demo-notice-title" }, "翻译队列"),
              h("span", { className: "slot-demo-notice-msg" }, "进行中 2 / 5 · 已交付 14")),
            h("button", {
              className: "p-notice__dismiss",
              "aria-label": "收起",
              onClick: () => setNotice(false),
            }, "✕")))
      : null);
}
