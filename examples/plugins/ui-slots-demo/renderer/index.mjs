/**
 * UI Slots Demo — renderer entry ("demo.ui-slots").
 *
 * Reproduces every finalized demo in docs/plugin-plan/ui/ as a real running
 * plugin. Plain ES module, no build step: the "react" specifier resolves to
 * the host's single React through the document import map.
 */
import { applyDemoStyles } from "./styles.mjs";
import { UserActionButton, AssistantActionButton } from "./actions.mjs";
import { RunnerPanel, SparkPanel, SelfDialogLauncher } from "./extras.mjs";
import { StatsCard, ChartBlock } from "./cards.mjs";
import { ComposerControl, ComposerTrigger, ComposerToken } from "./composer.mjs";

const TOOL_NAME = "slot_demo_stats";
const CHART_LANGUAGE = "demo.ui-slots:chart";

export function onLoad(pi) {
  applyDemoStyles(pi);

  // entryExtra 的三块叠加演示 additive（按注册顺序堆放）。
  pi.slots.register("entryExtra", RunnerPanel);
  pi.slots.register("userAction", UserActionButton);
  pi.slots.register("assistantAction", AssistantActionButton);
  // toolCard no-claim: 只画 manifest 里自己声明的工具。
  pi.slots.register("toolCard", StatsCard, { toolName: TOOL_NAME });
  pi.slots.register("blockRenderer", ChartBlock, { language: CHART_LANGUAGE });
  // composerControl 双侧一个组件，按 position 分形态。
  pi.slots.register("composerControl", ComposerControl);
  pi.slots.register("composerTrigger", ComposerTrigger, { trigger: "#" });
  pi.slots.register("composerToken", ComposerToken);
  pi.slots.register("entryExtra", SparkPanel);
  // self-dialog 无槽无注册：弹层画在组件自己的树里（卸载即消失）。
  pi.slots.register("entryExtra", SelfDialogLauncher);
}

export function onUnload() {
  // Registrations and injected styles are torn down by the host (卸载摘注册);
  // the self-dialog layers disappear with this module's components.
}
