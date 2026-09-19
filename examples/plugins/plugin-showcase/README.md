# Plugin Showcase

A PI-Desktop example plugin that ships **both plugin interfaces in one
package**, so a plugin author can read one directory and see how the pieces fit
together:

- the **renderer UI slots** — React components inside the app window, registered
  through `manifest.renderer` (spec `07-plugins/16-trusted-extensions.md` §2A,
  ADR 0291, ADR 0294); and
- the **agent runtime slots** — hooks inside the agent sidecar, registered
  through `contributes.agentExtensions` (spec `07-plugins/16` §6, ADR 0295).

Neither half calls the other. They are two different plugin hosts with two
different permission tiers, and they meet in the host: the renderer draws what
the host hands it, the agent half is consulted while a turn runs.

## What this demonstrates

| What | Which permission | What it should show |
|---|---|---|
| `entryExtra` — a component under every transcript entry, reading the `entry` it was given | `renderer.extension` | a badge: `acme.plugin-showcase · entryExtra · assistant · <entry id>`, or `… · added by <plugin id>` when the host attributed the entry to a plugin |
| `codeBlock` for the fenced language `acme.plugin-showcase:kv` | `renderer.extension` | a fenced block of `key = value` lines drawn as rows instead of source text |
| `pi.functions.register` — pure, synchronous functions the host may call *while it renders* | `renderer.extension` | the badge prints `fn entry-facts() → assistant`, the block prints `fn kv-rows() → N row(s)`: both values come out of the registered functions |
| One button that dispatches `ui.toast` | `renderer.extension`, plus `rendererActions: ["ui.toast"]` | the toast names the entry, and the badge then prints `toast sent` — or the refusal code, never a silent nothing |
| An agent-side module | `agent.extension` | the module's hooks are consulted inside the agent sidecar; without the grant the manifest is refused at install |
| Tool gate: refuse a dangerous shell command with a readable reason | `runtime.tool.gate` | the `Bash` call is refused before it runs: the transcript carries the reason and the plugin also raises a warning toast |
| Turn watch: observe the running turn | `runtime.turn.watch` | a status chip at the bottom-right of the window counts what the plugin saw: `Plugin Showcase · turn 2 · 3 tool call(s) seen (1 failed)` |
| Turn facts: read the host's own numbers for the turn | `runtime.turn.facts` | one notification when the run ends: status, duration, tokens, tool calls with outcomes, files touched and plugin-tool spend — and the plugin's own count next to the host's |
| Session lifecycle notice | `runtime.session.lifecycle` | a notification when the desktop creates or deletes a session |
| Turn abort: ask the host to stop the turn | `runtime.turn.abort` | the third blocked call in one turn asks the host to stop it, and the block reason ends in `accepted` or `refused` |

`rendererData` and `rendererActions` are **declarations, not permissions** (ADR
0294 decision 3): they grant nothing and are not in the permission enum. The
declaration is what the plugin's own code and the review see. One half of it is
enforced (`dispatch` refuses an action the manifest did not declare, with
`PLUGIN_ACTION_UNDECLARED`) and the other is not (a slot's props arrive whether
or not the plugin declared them), so the honest reading is: declare what you
use, and treat the list as the thing a reviewer compares against the code.

## Files

| File | Role |
|---|---|
| `manifest.json` | Declares `main`, `renderer`, `rendererData: ["entry", "code"]`, `rendererActions: ["ui.toast"]`, `contributes.agentExtensions`, one command, and the seven permissions the three entries actually use |
| `main.js` | Plugin-process entry: registers the declared command. A manifest needs one of `main`, `renderer`, or a plugin page — `contributes.agentExtensions` alone is not an entry |
| `renderer/index.mjs` | Renderer entry: `onLoad(pi)` injects one namespaced stylesheet, registers two host-callable functions and the `entryExtra` + `codeBlock` components |
| `agent/extension.js` | Agent-side entry: the tool gate, the turn watcher, the turn-facts summary, the session lifecycle notice and the abort request |

## Install (development folder)

There is no CLI install step for a plugin folder — the app loads it:

1. Open PI-Desktop and go to the **Extensions** destination in the sidebar
   (`Plugins` in older docs and in `docs/spec/`).
2. Open the header **⋯ (More actions)** menu and choose **Load local plugin**.
   The same button is offered in the empty state. Older documentation calls this
   action "Load development plugin".
3. Select the `examples/plugins/plugin-showcase` directory.
4. Accept the permission review. All seven grants are needed for the full tour:
   `renderer.extension`, `agent.extension`, `runtime.tool.gate`,
   `runtime.turn.watch`, `runtime.turn.facts`, `runtime.session.lifecycle`,
   `runtime.turn.abort`. Without `renderer.extension` the renderer module is
   never served, without `agent.extension` the manifest is refused, and without a
   slot grant the behaviour behind that slot is skipped and reported as a
   `permission_denied` diagnostic on the plugin row.

Use **Load local plugin** for this example — **Import pi extension** is for pi CLI
extension packages and is a different flow.

## Try it

**The renderer half** needs nothing but a chat:

1. Open any session. Every transcript entry gets the badge underneath it:
   `acme.plugin-showcase · entryExtra · <role> · <entry id>`, followed by
   `fn entry-facts() → <role>`.
2. Click **Notify the host**: a toast appears with the entry's role and id, and
   the badge prints `toast sent`. If the action were not declared, the badge
   would print `PLUGIN_ACTION_UNDECLARED` instead.
3. Ask the model (or write yourself) a fenced block in the plugin's own language:

   ````
   ```acme.plugin-showcase:kv
   # a language only this plugin draws
   covered = 42
   disk! = 91% used
   ```
   ````

   It renders as rows, with the `disk` row emphasised: the language's trailing
   `!` is the plugin's own convention, showing that the component really owns the
   block.

**The agent half** needs a turn:

1. Ask: *"Run `git reset --hard HEAD~1` with Bash."* The call is refused before
   anything runs; you get a warning toast and the transcript shows
   `Plugin Showcase refused this command: a hard reset that discards uncommitted
   work. Ask the user how to proceed instead of retrying.`
2. While the turn runs, a status chip at the bottom-right of the window counts what
   the plugin saw: `Plugin Showcase · turn 1 · 1 tool call(s) seen`.
3. Let the model retry twice more. On the **third** blocked call of the same turn
   the plugin also asks the host to stop the turn, and the reason says so:
   `… and asked the host to stop the turn after 3 blocked calls in it: accepted.`
   (If the grant were missing, the same sentence would end in `refused.`.)
4. When the run ends, one notification reports the host's numbers for the turn:

   `Plugin Showcase · turn summary — completed, 12.3s, 1500 tokens, 5 tool call(s) (4 ok / 1 failed) per host vs 3 seen here, 1 file(s) touched, no plugin-tool spend.`

   The two tool-call numbers are printed side by side on purpose:
   `runtime.turn.watch` is best-effort delivery, `runtime.turn.facts` is the
   host's own table.
5. Create or delete a session in the sidebar: the plugin is told
   (`the host created session …` / `the host deleted session …`) and can veto
   nothing.
6. Run **"Plugin Showcase: What this plugin adds"** from global search
   (`Cmd/Ctrl+K` or `Cmd/Ctrl+Shift+P`) to see the plugin's own summary toast,
   printed from the plugin process rather than the agent.

The gate patterns are shallow on purpose (`git reset --hard`, `rm -rf /` or
`rm -rf ~`, `curl … | bash`). They demonstrate the slot, not a policy: a real
guard belongs in the host's approval rules.

## How the two halves talk to each other

They do not, and that is the first thing to understand about this plugin model:

```text
renderer/index.mjs        main.js                agent/extension.js
(app window)              (plugin process)       (agent sidecar)
      │                        │                        │
      └── dispatch(action) ────┴── (host relay)          │
      │                        │                        │
      └── props from the host ─┴─ host render tree      │
                               │                        │
                               └── host tables ─────────┘
```

- The renderer half is a component: the host hands it props and a `dispatch`,
  and the host calls it. It has no channel to the agent half.
- The agent half is a hook: the host calls it while a turn runs. It has no
  channel to the window either — it talks to the user through `ctx.ui`, which the
  host renders.
- The **headless half** (`main.js`) is a third process. The only way the renderer
  reaches it is the forwarded action `plugin.call` (see `examples/plugins/slots-demo`),
  which this manifest deliberately does not declare: nothing here needs the relay.

So the two halves communicate *through the host*: the renderer draws what the
host read from its own state, and the agent half changes what the host does next
(a blocked call, a stopped turn). If your plugin needs one half to affect the
other, that has to go through host state — a permission, a contribution, or a
transcript row the host owns.

## What this does not do yet

Honest gaps, all of them observed while writing this example:

- **Eight of the ten declared UI slots have no mount point.** Only `entryExtra`
  (`features/chat/transcript/MessageRow.tsx`) and `codeBlock`
  (`components/Markdown.tsx`) are mounted today. `entry`, `toolCard`,
  `composerControl`, `completionSource`, `inlineConfirm`, `modal`, `overlay` and
  `composerReference` register successfully and render nowhere — including
  `modal`, which is what `examples/plugins/slots-demo` demonstrates. This example
  therefore uses only the two mounted slots.
- **No shipped host position calls a registered function yet.** `pi.functions.register`
  is real (`apps/desktop/src/plugins/renderer-host/host-functions.ts`): the host
  validates the name, measures the call, discards an answer past 16 ms and trips a
  breaker after three failures. The positions that need a synchronous answer are
  among the unmounted slots, so the only callers today are tests. The badge and
  the block call their own registered functions to show the shape; the value the
  host would use is the same value.
- **The entry data is a shape, not the entry.** `rendererData: ["entry"]` hands
  over `{ id, role, pluginId? }` — not the entry's text, attachments or tokens.
  A component cannot read the message it is mounted under.
- **No action reaches the agent half.** The whole `rendererActions` vocabulary is
  host-performed (`ui.toast`, `composer.*`) or forwarded to the plugin's own
  entry (`plugin.call`). There is no "ask my agent extension" action, and none of
  the slot permissions can be requested from the window.
- **A plugin cannot modify a tool call's arguments.** A `tool_call` handler may
  block a call and give a reason, and that is all; argument rewriting is
  permanently excluded (ADR 0295 rule 4), so nothing should be built on it.
- **`runtime.approval.before` (slot 12) does not exist.** Neither the kernel nor
  the harness has the hook, so a before-an-approval-card slot is not built and
  nothing here asks for it.
- **Nothing from the slots this example skips.** Before Send (1), Before Request
  (6), Turn Closing (7), Turn Recap (8), Turn Continue (10) and Tool Extend (5)
  are not used here, and `examples/plugins/runtime-slots-demo` covers the gate and
  abort questions from the other direction.
- **Not a security control.** The three gate patterns are shell-text-level and
  easy to evade (quoting, variables, another language).

## How this example was checked

Run while writing it, and repeatable:

- `node packages/plugin-devkit/dist/cli.js check examples/plugins/plugin-showcase`
  — passes with one warning, the same `permission.high-risk` class the other
  examples produce: `renderer.extension, agent.extension, runtime.tool.gate,
  runtime.session.lifecycle, runtime.turn.abort` each need an explicit grant.
- The manifest through the SDK path the app uses (`validateManifest` from
  `packages/plugin-sdk/dist`): accepted, `id` matches `PLUGIN_ID_PATTERN`, the
  entry rule is satisfied, all seven permissions exist in `PLUGIN_PERMISSIONS`,
  and `main.js`, `renderer/index.mjs` and `agent/extension.js` all exist.
- The renderer module with the app's own React: `react` resolved to the app's
  copy and both registered components rendered with `react-dom/server`; the
  button's dispatch path driven with a stubbed `useState` (a resolved dispatch
  reports `toast sent`, a refused one shows its code); both registered functions
  exercised, including a 2000-row input well inside the 16 ms budget.
- The agent extension through the **sidecar's own loader** (`extensions/loader.js`
  → jiti/static plus the virtual modules) with a stubbed `pi` and `ctx`: every
  handler was driven — a benign call not blocked, a non-shell call ignored, three
  dangerous calls blocked with readable reasons, the third asking for the abort
  (and the refused grant reported in the reason instead of throwing), the turn
  watcher's counts, the facts summary (including the missing-facts answer) and
  both session lifecycle changes.
- **Not run here:** a live turn in the running desktop. The behaviour described
  under "Try it" is what this code produces against the host contracts above,
  not something observed in a real session while this example was written.

## Reference

- Spec: `docs/spec/07-plugins/16-trusted-extensions.md` §2A (renderer), §6 (agent)
- Decisions: `docs/adr/0291-trusted-renderer-execution-host.md`,
  `docs/adr/0294-renderer-plugin-interface-and-host-relay.md`,
  `docs/adr/0295-runtime-slots-and-their-permissions.md`
- Permissions: `docs/spec/07-plugins/13-plugin-permissions-matrix.md` §2
- Other examples: `examples/plugins/slots-demo` (renderer only),
  `examples/plugins/runtime-slots-demo` (agent only),
  `examples/plugins/README.md`
