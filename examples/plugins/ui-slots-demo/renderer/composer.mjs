/**
 * Composer slot demos (docs/plugin-plan/ui/composer/demo.html): the 知识库
 * left control and the 草稿统计 right counter, the self-drawn # trigger
 * candidate list whose picks flow back through composer.acceptTriggerItem,
 * and the composerToken face (the host owns the ✕ so fold records survive).
 */
import { createElement as h } from "react";

export function ComposerControl({ position, dispatch }) {
  if (position === "left") {
    return h("button", {
      className: "slot-demo-bar-btn",
      title: "demo.ui-slots · composerControl left",
      onClick: () => dispatch("composer.insertText", "从知识库选择："),
    }, "知识库");
  }
  return h("span", {
    className: "slot-demo-bar-btn",
    title: "demo.ui-slots · composerControl right (demo counter)",
  }, "1,284");
}

export function ComposerTrigger({ query, dispatch }) {
  const items = ["alpha", "beta", "gamma"]
    .filter((name) => name.toLowerCase().startsWith(query.toLowerCase()))
    .map((name) => ({ label: name, value: { intent: "demo", name } }));
  return h("div", { className: "slot-demo-trigger" },
    h("div", { className: "slot-demo-notice-msg" }, "#" + query),
    items.length
      ? items.map((item) =>
          h("button", {
            key: item.label,
            className: "slot-demo-bar-btn",
            style: { display: "block", width: "100%", textAlign: "left" },
            onClick: () =>
              dispatch("composer.acceptTriggerItem", { label: item.label, value: item.value })
                .catch((error) =>
                  console.warn("[ui-slots-demo] accept rejected", error.code ?? error)),
          }, "#" + item.label))
      : h("div", { className: "slot-demo-notice-msg" }, "no match"));
}

export function ComposerToken({ label }) {
  return h("span", { className: "slot-demo-token" },
    h("span", { className: "tok" }, "#"),
    label);
}
