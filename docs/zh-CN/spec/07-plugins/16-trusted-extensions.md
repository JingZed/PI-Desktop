# 16. 受信任扩展

> **翻译说明：** 本页是与 [英文源规格](/spec/07-plugins/16-trusted-extensions) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

> 状态：v1.1 已实现（D387 / D388、ADR 0214 / ADR 0215 / ADR 0244）；实现说明标注为“v1 说明”。§2A 记录受信任渲染器宿主（issue #528、ADR 0287）。
> 范围：v1.1 加上受信任渲染器宿主。v2 与 v3 事项列于 §12，不构成承诺。

## 1. 目的与术语

插件（[01-plugin-system.md](/zh-CN/spec/07-plugins/01-plugin-system)）是 PI-Desktop
唯一的扩展面。agent 宿主是一种插件贡献点 `contributes.agentExtensions`：在 Agent
sidecar 内运行的 TypeScript 或 JavaScript 模块，接收一个 `ExtensionAPI` 对象，直接在
agent 循环上注册工具、命令和事件处理器。`ExtensionAPI` 契约即
`@earendil-works/pi-coding-agent` 定义的契约，PI-Desktop 与 `pi-ai`、`pi-agent-core`
内核（ADR 0002）一起采纳，因此为 pi CLI 写的扩展就是插件贡献的模块。D388 把此前
独立的“受信任扩展”注册表并入了这个贡献点；下文的引擎部分不变。

本文覆盖两个受信任执行宿主：agent sidecar
（`contributes.agentExtensions`，下文 §2 至 §14）与宿主渲染器（`manifest.renderer`，
§2A）。`main`、`ui.panel`、`views` 和 `settingsDestinations` 入口仍留在各自的沙箱
宿主里，规格见 [04-plugin-security.md](/zh-CN/spec/07-plugins/04-plugin-security)。

| 术语 | 含义 |
|---|---|
| Agent 扩展 | 插件在 `contributes.agentExtensions` 中列出的一个模块，面向 `ExtensionAPI` 编写，以 Agent sidecar 的信任级别运行 |
| 插件 | 带 manifest 的 PI-Desktop 插件，在独立进程中、权限网关之下运行（ADR 0008）；是其 agent 扩展的拥有者、安装者和启用记录 |
| 适配层 | `packages/agent-runtime` 中在桌面运行时之上实现 `ExtensionAPI` 的层 |
| Runner | 绑定到一个桌面会话的一个桌面自有 `TrustedExtensionRunner` 实例（v1 说明：不复用 pi-coding-agent 的 `ExtensionRunner`，因为它绑定终端主题；其 `ExtensionAPI` 类型仅作类型依赖） |
| 渲染器扩展 | 插件在 `manifest.renderer` 中指定的一个模块，在宿主渲染器内运行并把组件注册进宿主持有的槽位（§2A） |

## 2. 受信任 agent 宿主：定位与信任模型

1. Agent 扩展随其插件一起安装、启用、限定范围、更新和移除。没有第二个列表、存储或
   设置页。
2. Agent 扩展是受信任代码。它在 Agent sidecar 内执行，而 sidecar 已持有 bash、edit
   和 write 工具，因此授予 `agent.extension` 权限授予的正是运行 agent 已经授予的东西。
   [04-plugin-security.md](/zh-CN/spec/07-plugins/04-plugin-security) 的插件沙箱不
   覆盖这些模块，这正是该权限作为独立高风险授权、而非 `agent.tool.register` 隐含
   部分的原因。
3. 没有授权就不运行。声明了 `contributes.agentExtensions` 却没有 `agent.extension` 的
   manifest 校验不通过；记录的授权中缺少该权限的插件照常加载但跳过其模块并记审计
   （`plugin.agentExtensions.skipped`）。D007 继续有效：PI-Desktop 永不自动导入 `~/.pi`。
4. 项目范围就是插件的激活范围。限定到某些项目的插件只向这些项目的会话贡献模块。v1
   说明：没有独立的项目信任状态，插件范围即信任决定，`project_trust` 不触发。
5. v1.1 不开放持有 `agent.extension` 的插件在市场分发：该权限只接受本地导入和开发
   插件。市场上架等签名机制（规格 08）到位后再定。

## 2A. 受信任渲染器宿主（issue #528）

在 agent sidecar 旁边，还有第二个受信任执行宿主：`manifest.renderer`，一个插件相对的
ES 模块，由宿主渲染器在应用自己的窗口内获取并求值，在那里把 React 组件注册进宿主
持有的槽位。决定记录在 ADR 0287；本节就是契约。

### 2A.1 信任层级与权限

| 入口 | 代码运行位置 | 权限 | 组件槽位 |
|---|---|---|---|
| `main` / `ui.panel` / `views[].entry` / `settingsDestinations[].entry` | 插件 `utilityProcess` / 插件 `webContents` | 清单自身声明的权限 | 无 |
| `renderer` | 宿主渲染器，与宿主 UI 同一 JavaScript realm | `renderer.extension`（高） | 有，按层级 |
| `contributes.agentExtensions` | agent sidecar | `agent.extension`（高） | 无 |

信任跟随入口，且各层级正交而非阶梯：声明一个层级不会在另一个层级获得任何东西，
一个插件也可以任意组合多个层级。

- `renderer.extension` 是覆盖整个层级的唯一权限。槽位绝不逐个授权（#545 D1）；
  声明是请求，安装审查是授权上限。
- 声明了 `renderer` 却没有该权限会令 manifest 校验失败
  （`manifest.renderer requires the renderer.extension permission`；host-core：
  `PLUGIN_INVALID: renderer requires the renderer.extension permission`）。
  在清单里申请了该权限、但记录的授权中没有它的插件照常加载，只是跳过该入口并记
  审计，与 `agentExtensions` 完全一致。
- 分发不做门控：带 `renderer` 入口的插件走普通的本地、开发与市场路径安装。它的
  插件行会与其他能力并列显示一个 `renderer` 能力标记。
- 没有声明 `renderer` 却试图注册槽位的插件不会被静默服务：注册被跳过并作为诊断
  上报。

### 2A.2 加载

- 入口是惰性获取与求值的：它的某个槽位第一次真正渲染时才加载。加载期间不预留、
  也不显示任何东西，因此当前界面永远不渲染其槽位的插件在启动时不产生任何成本。
- 字节经 `plugin-renderer` scheme 提供。它只为已加载**且**声明了 `renderer` 的插件
  作答，只服务插件包内的路径，且只服务 `js` / `mjs` / `css` / `json` / `map`。
  既有的 `plugin-asset` scheme 不放宽：它的 MIME 白名单刻意只有图片与字体。
- 生产渲染器是 `file://` origin，因此生产 CSP 必须为脚本与连接放行
  `plugin-renderer`，构建期的 CSP 收紧也必须在同一次改动里包含它 —— 否则该入口只在
  开发环境可用，打包后才坏。
- 模块的 `onLoad(pi)` 钩子是必需的，注册就发生在那里；`onUnload()` 可选。`pi` 对象
  只携带 `plugin.id` / `plugin.version`、`pi.slots.register` 与
  `pi.ui.injectStyle`，别无其他。
- React 是单例：宿主注入自己的 React，并把裸标识符 `react`、`react-dom`、
  `react-dom/client` 映射到它；自带 React 副本的插件在加载时被拒绝并记录诊断，
  因为两份副本会破坏 hooks 与 context。

### 2A.3 同一 realm 与样式隔离

没有 `iframe`，没有 worker，也没有第二层沙箱：模块与宿主渲染器共享全局对象、模块图
和 React 树。随之交付的两项缓解措施：

- 应用在启动时取到所需的桥之后会删除 `window.piDesktop`，之后加载的模块拿不到这个
  全局桥句柄。
- import map 只解析 §2A.2 列出的宿主模块，因此模块无法导入任意宿主模块。

样式隔离是命名空间方案，不是 Shadow DOM：

- 每个槽位都包在 `data-pi-plugin="<plugin-id>"` 容器里；
- 插件样式必须走 `pi.ui.injectStyle(css)`，宿主在卸载时移除这些样式表；
- 含顶层 `html`、`body`、`:root` 或 `*` 选择器的样式表会被整个拒绝，而不是被收窄。

选择拒绝 Shadow DOM 的原因：被 portal 的插件 UI 会逃出 shadow root
（17 个文件、39 处 `createPortal` 调用，零处 `attachShadow`）。

### 2A.4 崩溃兜底与拒绝

- 每个槽位都位于一个 React 错误边界之后：抛错的槽位塌缩为空白，邻居不受影响，
  宿主会上报这次崩溃。若宿主在该位置有自己的默认渲染，则回退到默认值。
- 渲染器宿主的崩溃半径是被接受的：无限循环、内存泄漏或全局污染不会被错误边界兜住，
  卸载也不保证回滚全局改动（ADR 0287）。
- 拒绝：自带 React 的插件在加载时被拒绝并记录诊断；声明的 `renderer` 文件缺失会报
  `PLUGIN_LOAD_FAILED: renderer entry missing`；不导出 `onLoad` 的模块报
  `PLUGIN_INVALID: renderer entry must export onLoad`；缺少权限则是 manifest 校验
  失败，或者在该权限从未被授予时跳过入口并记审计；加载时抛错的模块其槽位保持空白
  并记录诊断。

### 2A.5 组件槽位

| 槽位 | 渲染内容 |
|---|---|
| `entry` | 一条整体转录消息：消息是对象而不是段落时 |
| `toolCard` | 插件自有工具的回合 / 工具卡片主体 |
| `codeBlock` | 按语言的围栏代码块渲染器 |
| `entryExtra` | 某条转录条目下方的附加块 |
| `composerControl` | composer 左右位置的控制项 |
| `completionSource` | composer 补全弹层的候选项来源 |
| `inlineConfirm` | 内联确认卡 |
| `modal` | 阻塞式、应用级对话框 |
| `overlay` | 窗口内浮层 |
| `composerReference` | composer 引用芯片 |

同一 issue 中的非组件能力 —— Markdown 转换器、附件来源、草稿改写和插件文案本地化
—— 是独立的 API，不是槽位。

### 2A.6 明确不构建

本轮刻意不构建的 issue #545 §5 事项：侧边栏入口、整页工作区路由、声明式槽位形状、
以沙箱页面作为槽位实现、Shadow DOM、任何宿主提供的草稿改写 UI，以及任何对插件危险
操作文案的宿主侧校验。

## 3. 贡献与导入

### 3.1 Manifest

```json
{
  "id": "acme.git-helper",
  "name": "Git helper",
  "version": "1.0.0",
  "main": "main.js",
  "permissions": ["agent.extension"],
  "contributes": { "agentExtensions": ["src/index.ts"] }
}
```

规则：最多八个条目；每个条目是插件目录内的相对 `.ts`、`.mts`、`.js` 或 `.mjs` 路径；
加载时文件必须存在；列出条目却没有权限的 manifest 无效
（[02-plugin-manifest-schema.md](/zh-CN/spec/07-plugins/02-plugin-manifest-schema) §4 与 §7）。
当插件不贡献其他内容时，`main` 可以是空操作模块。

### 3.2 导入 pi CLI 扩展或技能包

插件页 →“导入 pi 扩展”打开原生选择器（main 拥有路径，D344），由用户明确选择本地
文件或目录。main 把所选源码复制到 `<dataDir>/plugins/imported/<slug>/src/`，生成空操作
`main.js` 和 id 为 `imported.<slug>` 的 manifest（重复导入时追加唯一后缀），再通过
既有本地插件流程注册。选择器之前的确认仍是信任决定；生成的 manifest 只声明实际贡献
所需的权限。

扩展文件及未声明 `pi.skills` 的包保持既有 `pi-coding-agent` 入口发现规则：先取
`package.json` 的 `pi.extensions`，否则取 `index.ts` / `index.js`，再否则取一层深度内
的松散 `*.ts` / `*.js` 文件。明确声明 `pi.skills` 且没有 `pi.extensions`（或该数组为空）
的包视为仅技能包：包括 `index.js` 在内的附带脚本作为资源复制，不会被提升为可执行的
Agent 扩展。

目录若自带 `package.json`，会（连同其 npm lockfile）一并复制到插件根并剥离 `workspaces` 字段。
若声明了生产或可选依赖，main 会在首次加载前执行有界的两阶段安装：先运行
`npm install --package-lock-only --omit=dev --legacy-peer-deps --no-audit --no-fund
--ignore-scripts` 并校验完整生成的 lockfile，再使用相同安全参数运行 `npm ci`。
`dependencies`、`optionalDependencies`、`devDependencies` 和 `peerDependencies` 中的
直接 spec 都必须来自 registry，因为 npm 可能检查全部四者；git resolver 会被禁用。
不会运行生命周期脚本。安装失败会清理部分依赖/cache、上报渲染层且不阻塞导入。确认对话框
会与技能披露一并说明 npm 安装步骤。

| 来源 | 结果 |
|---|---|
| 一个 pi 扩展目录或文件 | `plugins/imported` 下的本地插件，id 为 `imported.<slug>` |
| 声明了 `contributes.agentExtensions` 的插件包 | 像其他插件一样安装；安装时询问该授权 |
| 带 `pi.extensions` 的 `package.json` | `src/` 下的入口，通过 `contributes.agentExtensions` 贡献，需 `agent.extension` |
| 带 `pi.skills` 的 `package.json` | `src/` 下的 Markdown 文档，通过 `contributes.skills` 贡献，需 `agent.prompt.inject` |
| 仅技能包 | 持有 `agent.prompt.inject` 的空操作插件，不授予 `agent.extension` |

`pi.skills` 是最多含 32 条非空路径的数组，每条路径相对于包目录，指向 Markdown 文件
或目录。明确指定的 `.md` 文件直接作为技能。对于目录，优先使用其自身的 `SKILL.md`；
若不存在，则纳入该目录直接包含的 `.md` 文件，并在子目录中查找 `SKILL.md`。
嵌套技能目录找到自身的 `SKILL.md` 后停止向下扫描，避免把支持文档变成额外技能。
扫描跳过点号开头的条目和 `node_modules`，对文档去重，目录扫描预算为 256。
发现超过 32 个技能、声明的路径不存在或路径类型不受支持时，导入失败，不会静默生成
不完整目录。每项贡献都按包内相对路径生成明确、稳定的插件内 ID，不同目录下同名的
`SKILL.md` 保持独立。既有插件技能正文解析、大小限制、权限与卸载行为保持不变。

复制时按所选包的相对路径判断排除项。包的祖先路径含 `node_modules` 不影响复制，
只排除包自身依赖目录中的 `node_modules` 路径段。引用文档、素材、辅助脚本及其他
普通源码文件保留在 `src/` 下，使技能的相对资源引用仍然成立。凭据文件（`.env*`、
`.npmrc`、`.netrc`、`.pypirc`、私钥和证书文件）及仓库元数据目录不会被复制。所选
根目录先解析为真实路径；贡献路径必须位于根目录内，不能包含 `..` 穿越，也不能指向
包内依赖目录。绝对 `pi.skills` 路径与后代符号链接会被拒绝；复制保留资源时也拒绝
符号链接，复制失败会清理部分生成的目录。生成目标以原子方式创建，不能位于所选源目录内。

这是显式本地导入，不是 pi CLI 包管理器：不会自动扫描或导入 `~/.pi`，不会读取 CLI
已安装包注册表，也不会执行 npm 生命周期脚本。声明依赖时，有界安装器只接受 registry
版本说明和 registry 来源的 npm lockfile，拒绝不安全的包路径和嵌套依赖 spec，禁用 git
解析，并隔离 npm 的配置/cache 与用户凭据和代理设置。导入包不代表其所有第三方扩展依赖都能执行。

## 4. 加载与运行时

### 4.1 扩展在哪里运行

扩展在 Agent sidecar 进程（`packages/agent-runtime`）内加载，永远不在 Electron
main、渲染层或插件宿主进程中。

### 4.2 Loader

- sidecar 以与 `pi-ai`、`pi-agent-core` 完全相同的锁定版本依赖
  `@earendil-works/pi-coding-agent`，仅作类型依赖。三者版本必须一致；漂移时 CI 失败。
- loader 镜像 `pi-coding-agent` 的发现规则，使用带 `virtualModules` 的
  `jiti/static`，babel 转换被打进包内，运行时不做路径解析。打包步骤由一个在仓库
  之外运行打包产物的契约测试验证（E2E-245）。
- 导入别名：`pi-ai`、`pi-agent-core` 和 `typebox` 解析到 sidecar 自带的副本；
  `@earendil-works/pi-coding-agent` 解析到一个运行时 shim，导出 `defineTool` 和
  工具结果类型守卫。`@earendil-works/pi-tui` 解析到一个桩
  模块，它把每个符号导出为惰性值，使顶层 import 永不失败。调用被桩替代的
  符号时在调用点产生一条诊断。

### 4.3 每会话一个 Runner

- 每个桌面会话拥有自己的 Runner。Runner 随会话运行时创建，随其丢弃而销毁。
- 由于 jiti 缓存模块，模块实例在 Runner 之间共享。因此模块级状态在会话之间
  共享，这与扩展作者在 pi 单进程运行多会话时看到的一致。v1 记录这一点而不
  绕开它。
- 启用、禁用或重新扫描会使所有 Runner 失效；受影响的会话在下一个回合边界重新
  加载扩展。进行中的回合永不被重新加载打断。

### 4.4 加载失败

加载错误永不导致会话失败。该扩展在诊断中标记为 `error` 并附消息和堆栈，其余
扩展继续加载，回合照常进行。当某个已启用扩展在当前会话加载失败时，composer
显示一行提示。

## 5. API 支持矩阵（v1）

每个 `ExtensionAPI` 成员恰好落入一个类别。不支持的成员仍存在于对象上，不做
任何事，返回文档规定的中性值，并按扩展、按成员各产生一条诊断。它们永不抛出，
因此只使用受��持成员的扩展即使同时触碰了不支持的成员也能工作。

| 类别 | 成员 |
|---|---|
| 支持 | `registerTool`、`registerCommand`、§6 中每个事件的 `on(...)`、`exec`、`getActiveTools`、`getAllTools`、`setActiveTools`、`getCommands`、`setModel`（v1 说明：返回 `false`，桌面拥有会话的 provider 绑定）、`getThinkingLevel`、`setThinkingLevel`、`setSessionName`、`getSessionName`、`sendUserMessage`（Host 队列，D386）、`getFlag` |
| 上下文上支持 | `ui.notify`、`ui.confirm`、`ui.select`、`ui.input`、`ui.setStatus`、`ui.setWorkingMessage`、`cwd`、`modelRegistry`、`isIdle`、`abort`、`hasPendingMessages`、`getContextUsage`、`compact`、`getSystemPrompt`、`waitForIdle`、`newSession`、`fork` |
| 推迟到 v2 | `sendMessage`、`appendEntry`、`setLabel`、`sessionManager` 只读 API、`switchSession`、`registerShortcut`、`registerMarkdownTransformer`、`ui.setEditorText`、`ui.getEditorText`、`ui.addAutocompleteProvider`、`registerFlag` 值编辑 |
| 不支持 | `ui.setWidget`、`ui.setFooter`、`ui.setHeader`、`ui.setTitle`、`ui.custom`、`ui.overlay`、`ui.onTerminalInput`、`ui.setWorkingVisible`、`ui.setWorkingIndicator`、`ui.setHiddenThinkingLabel`、`ui.pasteToEditor`、`ui.editor`、`registerMessageRenderer`、`registerEntryRenderer`、`navigateTree`、`shutdown` |

中性值：`getFlag` 返回声明的默认值；`registerFlag` 记录声明使 `getFlag` 可用，
但 v1 不暴露 CLI 或 UI；`sessionManager` 访问器返回空结果；UI setter 返回空操作
的 `dispose`。

## 6. 事件映射

事件从桌面运行时现有的 hook 点触发。凡事件类型定义了返回结果的，处理器结果
均被采纳。

| 事件 | 桌面 hook 点 | 是否采纳结果 |
|---|---|---|
| `session_start`、`session_shutdown` | Runner 创建与销毁 | 否 |
| `session_info_changed` | 经 `setSessionName` 的会话改名 | 否 |
| `project_trust` | v1 说明：不触发；按项目启用即信任决定 | 否 |
| `resources_discover` | v1 说明：不触发；skills 与提示发现留在 Electron main | 不适用 |
| `before_agent_start` | 回合内首个 provider 请求之前 | 是，系统提示与消息编辑 |
| `context` | `prepareNextTurn` | 是，替换消息列表 |
| `before_provider_request`、`before_provider_headers`、`after_provider_response` | provider 调用包装 | 请求与头部为是 |
| `agent_start`、`agent_end`、`agent_settled` | Agent 循环边界 | 否 |
| `turn_start`、`turn_end` | 回合边界 | 否 |
| `message_start`、`message_update`、`message_end` | Agent 消息事件 | v1 说明：否，pi-agent-core 不提供事后替换 |
| `tool_call` | `beforeToolCall` | 是，可带理由阻止 |
| `tool_execution_start`、`tool_execution_update`、`tool_execution_end` | 工具执行流 | 否 |
| `tool_result` | `afterToolCall` | 是，替换结果 |
| `model_select`、`thinking_level_select` | v1 说明：不触发；绑定变更会重建运行时 | 否 |
| `session_before_compact`、`session_compact`、`session_compact_failed` | 压缩流水线 | `session_before_compact` 为是 |
| `session_before_fork` | v1 说明：不触发；fork 在 Electron main 执行 | 不适用 |
| `input` | v1 说明：不触发；Host 队列准入尚未接入 | 不适用 |
| `user_bash`、`session_before_switch`、`session_before_tree`、`session_tree`、`ui_prompt_start`、`ui_prompt_end` | v1 不触发 | 不适用 |

抛出异常的处理器记为诊断并视为返回 `undefined`。带返回结果的事件若处理器超过
30 秒，则放弃并记诊断，回合以未修改的值继续。

## 7. 工具

1. 注册的工具以其声明名称加入会话工具目录。与核心工具、插件工具或用户 MCP
   工具同名的注册被拒绝并记诊断；先注册者胜出。
2. 扩展工具是非核心工具：与插件工具遵循相同的模式门控和 ToolSearch 延迟。它们
   在 Agent 模式可用，其他模式遵循现有的按模式白名单。
3. 执行在 sidecar 内按 `ExtensionAPI` 的 `execute` 签名进行。不弹出宿主权限提示；信任决定已
   在启用时做出。`onUpdate` 流映射到工具执行更新事件。
4. 每次执行写一条审计记录，含扩展 id、工具名和耗时。不记录参数。
5. `exec` 在 sidecar 内以会话工作目录、会话代理和环境设置运行。

## 8. 命令

1. `registerCommand` 条目出现在全局搜索的 Commands 区（见
   [09-plugin-command-palette.md](/zh-CN/spec/07-plugins/09-plugin-command-palette)），
   形式为 `/<name>`，来源显示扩展标签，排在内置和插件命令之后。
2. 命令在 sidecar 内运行，扩展命令上下文绑定到当前会话。它需要一个在本次应用
   运行中已加载扩展的活动会话；否则 composer 提示需先开始对话。
3. composer 中输入的 `/<name>` 按此顺序解析：内置、提示模板、插件、扩展。冲突
   记为诊断。
4. 运行中的命令与插件命令一样阻止 composer 提交，可从状态栏取消。

## 9. UI 桥接

交互式上下文调用经 sidecar → Electron main → 渲染层往返。

| 调用 | 渲染层界面 | 超时 | 中止时 |
|---|---|---|---|
| `ui.notify` | Toast | 无 | 丢弃 |
| `ui.confirm` | 双动作模态框 | 5 分钟 | 解析为 `false` |
| `ui.select` | 模态列表 | 5 分钟 | 解析为 `undefined` |
| `ui.input` | 模态文本框 | 5 分钟 | 解析为 `undefined` |
| `ui.setStatus`、`ui.setWorkingMessage` | 当前会话的浮动状态行（v1 说明：不在 composer 内） | 无 | 清空 |

规则：

- 每会话同一时刻只有一个待处理交互提示。第二个调用排在第一个之后。
- 中止回合时以上述中止值取消待处理提示。
- 远程控制（MVP 后）下提示立即以 `UNSUPPORTED` 失败，直到远程协议路由它；该
  路由属于 v3。
- 提示显示扩展标签和来源路径，让用户知道是谁在询问。

## 10. 协议与 IPC 新增

v1 不改任何 host-core RPC 方法、协议版本或 SQLite schema。

### 10.1 sidecar → main（host.proxy 白名单）

| 方法 | 用途 |
|---|---|
| `extensions.commands.publish` | 替换会话已注册的命令列表 |
| `extensions.ui.request` | §9 中的一次交互或状态调用 |
| `extensions.diagnostics.publish` | 替换会话的诊断列表 |
| `extensions.model.configure` | 校验插件自有的 provider/模型绑定，经 `session.configure` 持久化，然后广播 `session:modelChanged` |
| `session.rename`、`session.create`、`session.fork`、`session.queuePush`、`session.queuePrioritize` | 已有方法，现可从适配层到达 |

### 10.2 main ↔ 渲染层（Electron IPC）

| 通道 | 方向 | 用途 |
|---|---|---|
| `plugin/importExtension` | 请求 | 原生选择器、生成插件、注册为开发插件 |
| `extensions/commands/run` | 请求 | 在当前会话运行已注册命令 |
| `extensions/ui/respond` | 请求 | 回答一个待处理提示 |
| `extensions/ui/prompt` | 事件 | 有提示待处理 |
| `extensions/event/status` | 事件 | `ui.setStatus` / `ui.setWorkingMessage` 文本变化 |
| `plugin/list` | 请求 | 插件行携带 `agentExtension` 状态、工具与命令名和诊断 |
| `event/pluginChanged` | 事件 | 会话发布命令或诊断时同样触发 |

所有通道像其他插件通道一样做 sender 校验。MCP 控制面暴露 `extensions/commands/run`
（写）和 `extensions/ui/respond`（危险，需 confirm）；导入是原生选择器，保持本地。
main 在 `logs/app/plugin.log` 审计每个提示 id。

## 11. 插件行界面

插件页在所属插件的行上展示 agent 扩展：

- `agentExtension` 能力标记和 `agent.extension` 权限标记（高风险），与其他能力和权限
  并列。
- 详情区含状态标记（`enabled` 直到本次应用运行中有会话加载模块、`loaded`、`error`）、
  已注册的工具与斜杠命令名，以及诊断：加载错误、带计数的不支持 API 调用、被拒绝的
  注册、处理器超时。
- 页面溢出菜单中的“导入 pi 扩展”，前置一个说明授权含义的确认。

## 12. 分阶段

| 阶段 | 内容 | 承诺 |
|---|---|---|
| v1 | loader、每会话 Runner、支持矩阵、事件、工具、命令、UI 桥接 | 已交付（D387） |
| v1.1 | 模块成为带 `agent.extension` 授权的 `contributes.agentExtensions`；把 pi CLI 扩展导入为开发插件；独立注册表和设置标签移除 | 已交付（D388） |
| v2 | 自定义会话条目（`sendMessage`、`appendEntry`）含 schema 升版和通用渲染、`sessionManager` 只读 shim、`switchSession`、编辑器读写、补全 provider、`registerShortcut`、markdown 转换器 | 已规划，需先决定条目持久化与压缩 |
| v2 | 自定义会话条目（`sendMessage`、`appendEntry`）与一次 schema 升级及通用渲染层、`sessionManager` 只读 shim、`switchSession`、编辑器读写、自动补全 provider、`registerShortcut`、markdown 转换器 | 计划中，需要就条目持久化与压缩作出决定 |
| v3 | `pi` 包 manifest 与安装、pi CLI `settings.json` 的只读提示、统一 skill 与提示发现、提示的远程控制路由、市场列出 | 未排期 |

v1 交付顺序：打包 spike（E2E-245）、shared 协议类型，然后运行时、main、渲染层
三条线并行。

## 13. 版本策略

- 升级任一 pi 包即同时升级三个包。
- 一组覆盖每个受支持成员的样例扩展在每次升级时作为契约测试运行。
- 新增的 `ExtensionAPI` 成员先落入“不支持”类别并产生诊断，直到后续决策
  移动它们。
- 对外文档只承诺 §5 中“支持”和“上下文上支持”两个类别。

## 14. 待决事项

| 问题 | 决定前的默认 |
|---|---|
| v2 自定义条目是否持久化到 host-core 并参与压缩？ | 持久化；不进入压缩摘要 |
| v3 是否把 pi CLI `settings.json` 的启用路径作为发现提示读取？ | 只读提示，永不写入 |
| 扩展工具是否像插件工具一样按项目可选？ | §3.2 的范围是唯一门控 |
