/**
 * Action-gutter demos (docs/plugin-plan/ui/user-action, /assistant-action,
 * demo.html scenario 2): the user card gets 标星 / 转工单, the assistant card
 * gets 一键复现 / 存为知识库. Both draw around the host keys; neither can
 * move, hide, or restyle them.
 */
import { createElement as h, useState } from "react";

export function UserActionButton({ position, dispatch }) {
  const [starred, setStarred] = useState(false);
  if (position === "left") {
    return h("button", {
      className: "slot-demo-plugin-btn",
      title: "demo.ui-slots · userAction left",
      onClick: () => setStarred((value) => !value),
    }, starred ? "★ 已标星" : "★ 标星");
  }
  return h("button", {
    className: "slot-demo-plugin-btn",
    title: "demo.ui-slots · userAction right",
    onClick: () => dispatch("composer.insertText", "请把这个对话整理成工单："),
  }, "转工单");
}

export function AssistantActionButton({ position, dispatch }) {
  const [saved, setSaved] = useState(false);
  if (position === "left") {
    return h("button", {
      className: "slot-demo-plugin-btn",
      title: "demo.ui-slots · assistantAction left",
      onClick: () => dispatch("composer.insertText", "一键复现："),
    }, "一键复现");
  }
  return h("button", {
    className: "slot-demo-plugin-btn",
    title: "demo.ui-slots · assistantAction right",
    onClick: () => {
      setSaved(true);
      dispatch("composer.insertText", "已存为知识库条目：");
    },
  }, saved ? "✓ 已存知识库" : "存为知识库");
}
