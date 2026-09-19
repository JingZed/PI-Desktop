# 16. Trusted Extensions

> Status: Implemented v1.1 (D387 / D388, ADR 0214 / ADR 0215 / ADR 0244); implementation notes are marked "v1 note". §2A documents the trusted renderer host (issue #528, ADR 0287).
> Scope: v1.1 plus the trusted renderer host. v2 and v3 items are listed in §12 and are not committed.

## 1. Purpose and terminology

Plugins ([01-plugin-system.md](01-plugin-system.md)) are the one extension
surface of PI-Desktop. The agent host is a plugin contribution,
`contributes.agentExtensions`: TypeScript or JavaScript modules that run
inside the Agent sidecar, receive an `ExtensionAPI` object, and register
tools, commands, and event handlers directly on the agent loop. The
`ExtensionAPI` contract is the one defined by `@earendil-works/pi-coding-agent`,
which PI-Desktop adopts alongside the `pi-ai` and `pi-agent-core` kernel
(ADR 0002), so an extension written for the pi CLI is the module a plugin
contributes. D388 folded the earlier standalone "trusted extensions"
registry into this contribution; the engine below is unchanged.

The document covers both trusted execution hosts: the agent sidecar
agent sidecar (`contributes.agentExtensions`, §2 to §14 below) and the host
renderer (`manifest.renderer`, §2A). The `main`, `ui.panel`, `views`, and
`settingsDestinations` entries stay in their sandboxed hosts and are specified in
[04-plugin-security.md](04-plugin-security.md).

Provider declarations are a separate manifest surface rather than part of this
contract: `contributes.providers` materializes Host-owned provider rows
([02-plugin-manifest-schema.md](02-plugin-manifest-schema.md) §5.4, ADR 0259),
so it is neither an `ExtensionAPI` member nor a row in the §5 support matrix.
`registerProvider` (§5) remains the session-scoped extension counterpart.

| Term | Meaning |
|---|---|
| Agent extension | One module a plugin lists in `contributes.agentExtensions`, written against `ExtensionAPI`, running with the trust level of the Agent sidecar |
| Plugin | A PI-Desktop plugin with a manifest, running in its own process under the permission gateway (ADR 0008); the owner, installer, and enablement record of its agent extensions |
| Adapter | The layer in `packages/agent-runtime` that implements `ExtensionAPI` on top of the desktop runtime |
| Runner | One desktop-owned `TrustedExtensionRunner` instance bound to one desktop session (v1 note: the pi-coding-agent `ExtensionRunner` is not reused because it binds the terminal theme; its `ExtensionAPI` types are a types-only dependency) |
| Renderer extension | One module a plugin names in `manifest.renderer`, running in the host renderer and registering components into host-owned slots (§2A) |

## 2. Trusted agent host: positioning and trust model

1. Agent extensions are installed, enabled, scoped, updated, and removed as
   part of their plugin. There is no second list, store, or settings page.
2. An agent extension is trusted code. It executes inside the Agent sidecar,
   which already holds the bash, edit, and write tools, so granting the
   `agent.extension` permission grants exactly what running the agent already
   grants. The plugin sandbox in [04-plugin-security.md](04-plugin-security.md)
   does not cover these modules, which is why the permission is a separate,
   high-risk grant rather than an implicit part of `agent.tool.register`.
3. Nothing runs without the grant. A plugin that declares
   `contributes.agentExtensions` without `agent.extension` fails manifest
   validation; a plugin whose recorded grants omit the permission loads with
   its modules skipped and audited (`plugin.agentExtensions.skipped`). D007
   stays in force: PI-Desktop never auto-imports `~/.pi`.
4. Project scope is the plugin's activation scope. A plugin limited to some
   projects contributes its modules only to sessions in those projects. v1
   note: there is no separate project trust state, so the plugin scope is the
   trust decision and `project_trust` is not emitted.
5. Marketplace distribution of plugins holding `agent.extension` is not
   enabled in v1.1: the permission is accepted from local imports and
   development plugins. Marketplace listing waits for signing (spec 08).

## 2A. Trusted renderer host (issue #528)

A second trusted execution host sits beside the agent sidecar:
`manifest.renderer`, a plugin-relative ES module the host renderer fetches and
evaluates inside the app's own window, where it registers React components into
host-owned slots. ADR 0287 records the decision; this section is the contract.

### 2A.1 Trust tier and permission

| Entry | Where the code runs | Permission | Component slots |
|---|---|---|---|
| `main` / `ui.panel` / `views[].entry` / `settingsDestinations[].entry` | plugin `utilityProcess` / plugin `webContents` | the manifest's own permissions | none |
| `renderer` | the host renderer, same JavaScript realm as the host UI | `renderer.extension` (high) | yes, by tier |
| `contributes.agentExtensions` | the agent sidecar | `agent.extension` (high) | none |

Trust is per entry and the tiers are orthogonal, not a ladder: declaring one
grants nothing in another, and a plugin may declare any combination.

- `renderer.extension` is one permission for the whole tier. Slots are never
  authorized one by one (#545 D1); the declaration is the request and the
  install review is the authorization ceiling.
- Declaring `renderer` without the permission fails manifest validation
  (`manifest.renderer requires the renderer.extension permission`; host-core:
  `PLUGIN_INVALID: renderer requires the renderer.extension permission`). A
  manifest that asks for the permission but whose recorded grants omit it loads
  with the entry skipped and audited, exactly like `agentExtensions`.
- Distribution is not gated: a plugin with a `renderer` entry installs through
  the ordinary local, development, and marketplace paths. Its plugin row shows a
  `renderer` capability chip beside the other capabilities.
- A plugin that registers a slot without declaring `renderer` is not served
  silently: the registration is skipped and reported as a diagnostic.

### 2A.2 Loading

- The entry is fetched and evaluated lazily, the first time one of its slots is
  really rendered. Nothing is reserved or shown while it loads, so a plugin
  whose slots the current surface never renders costs nothing at startup.
- Bytes come over the `plugin-renderer` scheme. It answers only for plugins that
  are loaded **and** declare `renderer`, only for paths inside the plugin
  package, and only for `js` / `mjs` / `css` / `json` / `map`. The existing
  `plugin-asset` scheme is not widened: its MIME allowlist is images and fonts
  on purpose.
- The production renderer is a `file://` origin, so the production CSP must
  allow `plugin-renderer` for scripts and connections, and the build-time CSP
  tightening must include it in the same change — otherwise the entry works in
  development and breaks only in a packaged build.
- The module's `onLoad(pi)` hook is required and is where registration happens;
  `onUnload()` is optional. The `pi` object carries `plugin.id` /
  `plugin.version`, `pi.slots.register`, `pi.functions.register`, and
  `pi.ui.injectStyle`, and nothing else — a slot component's host data and its
  `dispatch` method arrive as props on the component, not through that object
  (§2A.7).
- React is a singleton: the host injects its own React and maps the bare
  specifiers `react`, `react-dom`, and `react-dom/client` onto it, and a plugin
  that ships its own React copy is refused at load with a diagnostic, because
  two copies break hooks and context.

### 2A.3 Same realm and style isolation

No `iframe`, no worker, no second sandbox: the module shares the host renderer's
global object, module graph, and React tree. The mitigation that ships:

- The import map resolves only the host modules named in §2A.2, so the module
  cannot import arbitrary host modules.

The realm is not a boundary and the global bridge handle stays reachable:
`contextBridge` defines `window.piDesktop` as a non-configurable own property, so
the app cannot delete it, and the module reaches the host's whole preload surface
— 243 whitelisted channels (220 invoke + 23 event) — with no per-caller check.
Plugins are trusted and broadly permissioned on purpose: the boundary is
marketplace review plus install-time consent, not isolation.

Style isolation is a namespace scheme, not Shadow DOM:

- every slot is wrapped in a `data-pi-plugin="<plugin-id>"` container;
- plugin styles must go through `pi.ui.injectStyle(css)`, and the host removes
  the sheets on unload;
- a stylesheet containing a top-level `html`, `body`, `:root`, or `*` selector
  is refused rather than narrowed.

Shadow DOM was rejected because portaled plugin UI would escape a shadow root
(41 `createPortal` call sites across 18 renderer files).

### 2A.4 Crash containment and refusals

- Each slot sits behind a React error boundary: a slot that throws collapses to
  nothing, its neighbours are unaffected, and the host reports the crash. Where
  the host has its own default rendering for that position, it falls back to it.
- The crash radius of the renderer host is accepted: an infinite loop, a memory
  leak, or global pollution is not contained by the boundary, and unloading is
  not guaranteed to roll back global mutations (ADR 0287).
- Refusals: a plugin that ships its own React is refused at load with a
  diagnostic; a declared `renderer` file that is missing reports
  `PLUGIN_LOAD_FAILED: renderer entry missing`; a module that does not export
  `onLoad` reports `PLUGIN_INVALID: renderer entry must export onLoad`; a missing
  permission is a manifest validation failure, or a skipped and audited entry
  when the permission was never granted; and a module that throws while loading
  leaves its slots empty with a diagnostic.

### 2A.5 Component slots

| Slot | Renders |
|---|---|
| `entry` | A whole transcript message that is an object rather than a paragraph |
| `toolCard` | The turn / tool card body for the plugin's own tools |
| `codeBlock` | A fenced code block, per language |
| `entryExtra` | An extra block below one transcript entry |
| `composerControl` | Controls in the composer's left and right positions |
| `completionSource` | Candidates for the composer's completion popover |
| `inlineConfirm` | An inline confirmation card |
| `modal` | A blocking, app-level dialog |
| `overlay` | An in-window overlay layer |
| `composerReference` | Composer reference chips |

The non-component capabilities from the same issue — a Markdown transformer,
attachment sources, draft rewriting, and plugin copy localization — are separate
APIs, not slots.

### 2A.6 Deliberately not built

The issue #545 §5 items that this cycle deliberately does not build: sidebar
entries, a full-page workspace route, declarative slot shapes, sandboxed pages
as a slot implementation, Shadow DOM, any host-provided UI for draft rewriting,
and any host-side validation of a plugin's dangerous-action copy.

### 2A.7 Declared data and actions

A renderer module asks for nothing at runtime that its manifest does not
declare. Two optional root lists, `rendererData` and `rendererActions`, name the
host data the module reads and the host actions it dispatches, each drawn from a
host-owned vocabulary
([02-plugin-manifest-schema.md](02-plugin-manifest-schema.md) §2 and §7 rule 21).
Where a review already holds the manifest it is asking about — today the
developer-folder load and reload review — both lists are shown. A surface that
would have to show a version whose manifest it has not read yet shows nothing
instead: a locally imported package has no pre-install review at all, and the
marketplace catalog does not carry these lists. The lists are declarations and
grant nothing: they are not permissions, they do not appear in the permission
list, they do not change grants, and a manifest that declares them without
`renderer` still validates.

The relay that consumes these names at dispatch time ships with the trusted
renderer host (ADR 0290). A mounted slot component is handed its host data and
one method, `dispatch(action, payload)`, as props; nothing is ambient. The host
refuses an action the plugin did not declare, and a declared action it has no
handler for is refused as a coded error rather than resolving `undefined` — and
every refusal is also recorded as a diagnostic on the plugin's row. Three of the
nine names are implemented; a call to one of the other six rejects with a coded
`PLUGIN_ACTION_UNROUTED` refusal.

- `plugin.call { method: string, args?: unknown }` is forwarded to the calling
  plugin's own headless entry, which answers through the SDK hook
  `onRendererCall(method, args)`, and that answer is returned to the caller:
  JSON-serializable values only, and an absent answer arrives as `null`. Electron
  main re-checks the call against the manifest it loaded, and the renderer
  supplies only ids and args. That is a correctness measure for the normal case,
  not a security boundary (ADR 0287).
- `ui.toast { message: string, variant?: "info" | "success" | "error" }` raises
  the shell's existing toast.
- `composer.replaceDraft { text: string }` writes the whole draft of the active
  session and resolves only once a mounted composer consumed the write; if
  nothing consumes it within 500 ms the write is cleared and the call refuses
  with `PLUGIN_ACTION_DRAFT_UNCONSUMED`.

`rendererData` — host data the module declares it reads:

- `entry`
- `session`
- `code`
- `theme`
- `selection`
- `draft`
- `attachments`
- `locale`

`rendererActions` — host actions the module declares it dispatches:

- `plugin.call`
- `composer.replaceDraft`
- `composer.insertText`
- `composer.attachPath`
- `ui.openOverlay`
- `ui.closeOverlay`
- `ui.openModal`
- `ui.closeModal`
- `ui.toast`

### 2A.8 Host-callable plugin functions

Some positions need an answer from the plugin while the host is rendering — a
per-message block whose height the transcript must know before it lays out, a
code-block decoration, a value read while a composer control is computed. An
async round trip cannot serve them without the UI flickering or reflowing
afterwards, so the module also registers pure, synchronous functions for the
host to call in the renderer (ADR 0290 decision 6).

- `pi.functions.register(name, fn)` returns `{ name, remove() }`. Names are per
  plugin, not global, and must match `^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$` and
  stay at most 64 characters long. A name outside that grammar is refused with
  a coded error and a diagnostic (`PLUGIN_FUNCTION_INVALID_NAME`), and so is a
  name the same plugin already registered (`PLUGIN_FUNCTION_DUPLICATE_NAME`);
  nothing is registered in either case.
- `fn` is called by the host while rendering, on any render — not once per
  plugin load and not on a schedule. It must be pure and synchronous: no I/O,
  no network, no DOM mutation, no long work.
- The host calls it as `callRendererFunction(pluginId, name, input)` and gets a
  discriminated result rather than an exception:
  - `{ ok: true, value }` — the function returned within one frame.
  - `{ ok: false, code: "PLUGIN_FUNCTION_MISSING" }` — no such function exists,
    including after the plugin was unloaded.
  - `{ ok: false, code: "PLUGIN_FUNCTION_THREW" }` — the function threw.
  - `{ ok: false, code: "PLUGIN_FUNCTION_OVER_BUDGET" }` — the function
    returned, but took longer than the budget of one frame (16 ms); **the value
    is discarded** and the host renders without it.
  - `{ ok: false, code: "PLUGIN_FUNCTION_DISABLED" }` — three consecutive
    over-budget or throwing calls (a success resets the count) tripped the
    per-function circuit breaker; the host stops calling that function for the
    rest of the plugin's loaded lifetime.
- A synchronous call cannot be preempted. The budget is enforced by discarding
  the answer and by the breaker, never by cancelling the call: the host waits
  for the call to return, then discards an answer that arrived too late. It
  does not "proceed as if the plugin had no opinion" before that return.
- Every failure above is recorded as a diagnostic on the plugin's row (§2A.7).
- This is a renderer-local path and is not an IPC channel: no host-core or
  Electron main message carries a function call, and a function must not make
  one because it must not perform I/O.
- No host position calls a registered function yet. The positions that need a
  synchronous plugin answer are among the eight component slots that are still
  not mounted (two of the ten in §2A.5 render today).

## 3. Contribution and import

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

Rules: at most eight entries; each is a relative `.ts`, `.mts`, `.js`, or
`.mjs` path inside the plugin directory; the file must exist at load; a
manifest that lists entries without the permission is invalid
([02-plugin-manifest-schema.md](02-plugin-manifest-schema.md) §4 and §7).
`main` may be a no-op module when the plugin contributes nothing else.

### 3.2 Importing a pi CLI extension or skill package

Plugins → "Import pi extension" opens a native picker (main owns the path,
D344) for an explicit local file or directory. Main copies the selected
source under `<dataDir>/plugins/imported/<slug>/src/`, writes a generated
no-op `main.js` and a manifest with id `imported.<slug>` (a unique suffix is
added for repeated imports), and registers the directory through the existing
local-plugin flow. The confirmation before the picker remains the trust
decision; the generated manifest declares the permissions needed by its actual
contributions.

For extension files and packages without `pi.skills`, entry discovery keeps
the existing `pi-coding-agent` rules: `package.json` `pi.extensions`, otherwise
`index.ts` / `index.js`, otherwise loose `*.ts` / `*.js` files one level deep.
A package that explicitly declares `pi.skills` and has no `pi.extensions` (or
an empty array) is skill-only: incidental scripts, including `index.js`, are
copied as resources but never promoted to executable agent extensions.

A directory that ships a `package.json` also has it (plus its npm lockfile)
copied to the plugin root with any `workspaces` field stripped. When it declares
production or optional dependencies, main performs a bounded two-step install:
it first resolves `npm install --package-lock-only --omit=dev --legacy-peer-deps
--no-audit --no-fund --ignore-scripts`, validates the complete generated lockfile,
then runs `npm ci` with the same safety flags. Direct specs in `dependencies`,
`optionalDependencies`, `devDependencies`, and `peerDependencies` must be
registry-only because npm may inspect all four; the git resolver is disabled.
No lifecycle script runs. Failed installs remove partial dependencies/cache and
are reported to the renderer without blocking the import. The confirm discloses
the npm step alongside the skills disclosure.

| Source | Becomes |
|---|---|
| A pi extension directory or file | A local plugin under `plugins/imported`, id `imported.<slug>` |
| A plugin package declaring `contributes.agentExtensions` | Installed like any plugin; the grant is asked for at install |
| A `package.json` with `pi.extensions` | Entries under `src/`, exposed through `contributes.agentExtensions` with `agent.extension` |
| A `package.json` with `pi.skills` | Markdown documents under `src/`, exposed through `contributes.skills` with `agent.prompt.inject` |
| A skill-only package | A no-op plugin holding `agent.prompt.inject`, without `agent.extension` |

`pi.skills` is an array of at most 32 nonempty relative Markdown-file or
directory paths. An explicit `.md` file contributes that document. For a
directory, its own `SKILL.md` takes precedence; otherwise directly contained
`.md` files are included and subdirectories are searched for `SKILL.md`.
Nested skill directories stop at their own `SKILL.md`, so support documents
are not turned into extra skills. Scanning skips dot-prefixed entries and
`node_modules`, deduplicates documents, and has a budget of 256 directories.
More than 32 discovered skills, a missing declaration, or an unsupported
path fails the import rather than silently yielding an incomplete catalog.
Each contribution has an explicit, stable plugin-local ID derived from its
package-relative path; different directories named `SKILL.md` remain
independent skills. Normal plugin skill parsing, size limits, grants, and
unload behavior remain in force.

Copying uses paths relative to the selected package. A package installed
under an ancestor `node_modules` directory is copied normally; only its own
`node_modules` directory segments are excluded. References, assets, helper
scripts, and other ordinary source files remain under `src/`, preserving
skill-relative resource paths. Credential files (`.env*`, `.npmrc`, `.netrc`,
`.pypirc`, private-key and certificate files) and repository metadata directories
are not copied. The selected root is resolved to its real path. Contribution
paths must stay inside that root, cannot traverse `..`, and cannot point into
its dependency directories. Absolute `pi.skills` paths and descendant symbolic
links are rejected. Copying also rejects symbolic links among retained resources
and removes a partial copy on failure. The generated destination is created
atomically and must not be inside the selected source.

This is an explicit local import, not a pi CLI package manager. It never
automatically scans or imports `~/.pi`, does not read the CLI's installed
package registry, and does not run npm lifecycle scripts. When dependencies
are declared, the bounded installer accepts only registry version specs and
registry-resolved npm lockfiles, rejects unsafe package locations and nested
dependency specs, disables git resolution, and isolates npm's config/cache from
the user's credentials and proxy settings. Importing a package does not promise
that every third-party extension dependency can execute.

## 4. Loading and runtime

## 4. Loading and runtime

### 4.1 Where extensions run

Extensions load inside the Agent sidecar process (`packages/agent-runtime`),
never in Electron main, the renderer, or a plugin host process.

### 4.2 Loader

- The sidecar pins `@earendil-works/pi-coding-agent` at exactly the version
  pinned for `pi-ai` and `pi-agent-core`, as a types-only dependency. The
  three versions must match; CI fails when they drift.
- The loader mirrors the `pi-coding-agent` discovery rules and uses
  `jiti/static` with `virtualModules`, so the babel transform is bundled
  and no path resolution happens at runtime. The bundling step is verified
  by a contract test that runs the bundle outside the repository (E2E-245).
- Import aliases: `pi-ai`, `pi-agent-core`, and `typebox` resolve to the
  sidecar's copies; `@earendil-works/pi-coding-agent` resolves to a runtime
  shim that exports `defineTool` and the tool-result type guards. `@earendil-works/pi-tui`
  resolves to a stub module that exports every symbol as an inert
  value so a top-level import never fails. Using a stubbed symbol raises a
  diagnostic at call time.

### 4.3 Runner per session

- Each desktop session gets its own Runner. The Runner is created with the
  session's runtime and disposed when the session's runtime is discarded.
- Module instances are shared across Runners because jiti caches modules.
  Module-level state is therefore shared between sessions, matching what an
  extension author sees when pi runs several sessions in one process. This
  is documented, not worked around, in v1.
- Enabling, disabling, or rescanning invalidates every Runner; affected
  sessions reload extensions at the next turn boundary. A running turn is
  never interrupted by a reload.

### 4.4 Load failures

A load error never fails the session. The extension is marked `error` with
the message and stack in diagnostics, the remaining extensions load, and the
turn proceeds. The composer shows a one-line notice when an enabled
extension failed to load for the active session.

## 5. API support matrix (v1)

Every `ExtensionAPI` member falls into exactly one class. Unsupported members
exist on the object, do nothing, return the documented neutral value, and
emit one diagnostic per extension per member. They never throw, so an
extension that only uses supported members works even if it also touches
unsupported ones.

| Class | Members |
|---|---|
| Supported | `registerTool`, `registerCommand`, `registerAgent`, `registerProvider` (plugin-owned compatibility alias; same shape as `registerAgent`), `unregisterAgent`, `unregisterProvider`, `on(...)` for every event in §6, `exec`, `getActiveTools`, `getAllTools`, `setActiveTools`, `getCommands`, `setModel` (configured models and plugin agents; idle-only; persists the current session binding), `getThinkingLevel`, `setThinkingLevel`, `setSessionName`, `getSessionName`, `sendUserMessage` (Host-owned queue, D386), `getFlag`, `requestTurnAbort` (slot 3; requires `runtime.turn.abort`) |
| Supported on context | `ui.notify`, `ui.confirm`, `ui.select`, `ui.input`, `ui.setStatus`, `ui.setWorkingMessage`, `cwd`, `modelRegistry`, `isIdle`, `signal`, `abort`, `hasPendingMessages`, `getContextUsage`, `compact`, `getSystemPrompt`, `waitForIdle`, `newSession`, `fork` |
| Deferred to v2 | `sendMessage`, `appendEntry`, `setLabel`, `sessionManager` read API, `switchSession`, `registerShortcut`, `registerMarkdownTransformer`, `ui.setEditorText`, `ui.getEditorText`, `ui.addAutocompleteProvider`, `registerFlag` value editing |
| Unsupported | `ui.setWidget`, `ui.setFooter`, `ui.setHeader`, `ui.setTitle`, `ui.custom`, `ui.overlay`, `ui.onTerminalInput`, `ui.setWorkingVisible`, `ui.setWorkingIndicator`, `ui.setHiddenThinkingLabel`, `ui.pasteToEditor`, `ui.editor`, `registerMessageRenderer`, `registerEntryRenderer`, `navigateTree`, `shutdown` |

`registerAgent({ id, name?, models, stream? | complete? })` registers a
session-scoped plugin-owned LLM integration. Each model declares bounded public
metadata (`id`, display name, API label, modalities, reasoning and limits). The
plugin callback receives the pi-ai model/context/options and owns endpoint,
authentication, request serialization, and response conversion. It must honor
`options.signal` for cancellation. `complete` is adapted to a one-result stream.

The host assigns `extension-agent:<encoded-agent-key>` as the provider id. A
successful idle `setModel` persists that provider/model pair through
`session.configure`; the next turn reloads the trusted extension and restores the
agent implementation. `modelRegistry` exposes only models and auth availability;
it never exposes Host API keys, secret refs, OAuth tokens, arbitrary Host headers,
or Host provider internals. `registerProvider` and its unregister counterpart
accept the same plugin-owned shape as a compatibility alias — a `stream` or
`complete` implementation, in the upstream `(id, config)` form and in the object
form; provider credentials in the upstream config are ignored by Host and are
not persisted.

Neutral values: `getFlag` returns the declared default; `registerFlag` records
the declaration so `getFlag` works but exposes no CLI or UI in v1;
`sessionManager` accessors return empty results; UI setters return a no-op
`dispose`.

## 6. Event mapping

Events fire from the desktop runtime's existing hook points. Handler results
are honored where the event type defines a result.

| Event | Desktop hook point | Result honored |
|---|---|---|
| `session_start`, `session_shutdown` | Runner creation and disposal | No |
| `session_info_changed` | Session rename through `setSessionName` | No |
| `project_trust` | v1 note: not emitted; enablement per project is the trust decision | No |
| `resources_discover` | v1 note: not emitted; skills and prompt discovery stay in Electron main | n/a |
| `before_agent_start` | Before the first provider request of a turn | Yes, `systemPrompt` only: the code reads `result.systemPrompt` and discards returned messages. Message rewriting belongs to the `context` point below |
| `context` | `prepareNextTurn` | Yes, replacement message list |
| `before_provider_request`, `before_provider_headers`, `after_provider_response` | Provider call wrapper | Yes for request and headers |
| `agent_start`, `agent_end`, `agent_settled` | Agent loop boundaries | No |
| `turn_start`, `turn_end` | Turn boundaries | No |
| `turn_closing` | `shouldStopAfterTurn` (runtime slot 7, issue #561; gated by `runtime.turn.closing` — spec 13 §2C) | Yes: `{ continue: true, message? }` keeps the run going, bounded per run |
| `message_start`, `message_update`, `message_end` | Agent message events | v1 note: no, pi-agent-core offers no post-hoc replacement |
| `tool_call` | `beforeToolCall` | Yes, block with reason. Modifying the call's arguments is not available and is permanently excluded (ADR 0291 rule 4) |
| `tool_execution_start`, `tool_execution_update`, `tool_execution_end` | Tool execution stream | No |
| `tool_result` | `afterToolCall` | Yes, replacement result |
| `model_select`, `thinking_level_select` | v1 note: not emitted; a binding change retires the runtime | No |
| `session_before_compact`, `session_compact`, `session_compact_failed` | Compaction pipeline | Yes for `session_before_compact` |
| `session_before_fork` | v1 note: not emitted; fork runs in Electron main | n/a |
| `input` | v1 note: not emitted; Host queue admission is not wired yet | n/a |
| `user_bash`, `session_before_switch`, `session_before_tree`, `session_tree`, `ui_prompt_start`, `ui_prompt_end` | Not emitted in v1 | n/a |

A handler runs only when the extension's plugin holds the slot permission behind
its event (ADR 0291 rule 2): `turn_closing` needs `runtime.turn.closing`, and an
event whose slot is not implemented yet keeps today's behavior until that name is
registered with its slot. The runner is handed the plugin's granted permissions —
an extension with no recorded grants holds none — and skips a handler it may not
run, reporting the skip as an extension diagnostic of kind `permission_denied`
that names the permission, on the plugin row. A skipped handler never blocks the
turn: like a throwing handler, it counts as having no opinion.

Two calls an extension makes for itself are not events, so the same contract
names the call instead of an event name (`TRUSTED_EXTENSION_API_PERMISSIONS` in
`@pi-desktop/shared`): `requestTurnAbort` needs `runtime.turn.abort`, and the
tool-result capability behind §7.6 needs `runtime.tool.extend`. Both are gated
and reported exactly like an event, in both directions: the call returns a
refusal value (`false` for `requestTurnAbort`) and the plugin row gets a
`permission_denied` diagnostic that names the permission and the call — never a
silent no-op and never a throw.

### 6.1 Aborting the turn and the cancellation signal (slot 3)

`requestTurnAbort()` asks the host to stop the current turn. The plugin's own
long-running work learns that the run was cancelled through the same slot,
because an abort without a signal would leave that work running after the turn
is gone:

- the extension context carries `signal`, the running turn's `AbortSignal`
  (`undefined` while no turn runs);
- a plugin tool's execution context carries `signal` too (see §7.7), which
  aborts when the user stops the turn, when a plugin asks for the abort, or when
  the host abandons it;
- the user's Stop and `requestTurnAbort` take the same path for plugin work:
  Electron main cancels that session's plugin invocations, which the sidecar
  cannot reach on its own, and the runtime emits the ordinary `TURN_ABORTED`
  terminal event, so the turn is recorded as aborted.

The kernel exposes two more context hooks — `pi-agent-core`'s `transformContext`
and `prepareNextTurn` — that no plugin can reach yet: the desktop sets only
`prepareNextTurnWithContext`, and the `context` event above rides that path. A
plugin-facing entry point is the before-request slot, phasing step 3 in
[ADR 0291](../../adr/0291-runtime-slots-and-their-permissions.md), which rule 3
there opens to ordinary plugins rather than the high-trust tier alone.

A handler that throws is logged as a diagnostic and treated as returning
`undefined`. A handler that exceeds 30 s for a result-bearing event is
abandoned with a diagnostic and the turn proceeds with the unmodified value.

## 7. Tools

1. A registered tool joins the session's tool catalog under its declared
   name. A name that collides with a core tool, a plugin tool, or a user MCP
   tool is rejected with a diagnostic; the earlier registration wins.
2. Extension tools are non-core: they follow the same mode gating and
   ToolSearch deferral as plugin tools. They are available in Agent mode and
   follow the existing per-mode allowlist elsewhere.
3. Execution happens in the sidecar with the `ExtensionAPI` `execute` signature.
   No host permission prompt is raised; the trust decision was made at
   enablement. `onUpdate` streams map to tool execution update events.
4. Every execution writes an audit line with extension id, tool name, and
   duration. Parameters are not logged.
5. `exec` runs in the sidecar with the session's working directory and the
   session's proxy and environment settings.
6. **Slot 5 — what a tool result may do beyond its content.** An extension
   tool's `AgentToolResult` may carry `addedToolNames`, `usage`, and
   `terminate`, and a plugin tool registered through `pi.agent.registerTool`
   may return the same three fields in its `PluginToolResult`. All three need
   `runtime.tool.extend`; a plugin without the grant is refused rather than
   silently trusted, and the refusal is reported as a `permission_denied`
   diagnostic (extension tools, on the plugin row) or an audit record
   (`agent.toolResult.extend`, plugin tools, in Electron main):
   - `addedToolNames` introduces tools. Each name must already be in the
     session's catalogue — an on-demand tool the model has not activated yet,
     including another plugin's tool — and becomes available from the next
     provider request onward. A name outside the catalogue is ignored, and a
     host tool's result can never introduce one: `addedToolNames` is a slot-5
     capability and only a plugin holds the slot. An introduced tool is marked
     where the catalogue is presented: the on-demand list in the model's system
     prompt, the ToolSearch answer for the turn that activated it, and
     `getAllTools()` (row field `introducedBy: "plugin"`). The mark follows the
     tool for as long as the transcript point that introduced it is in context.
   - `usage` is the call's own spend. It is recorded as its own component of
     the completed turn (`turn_end.pluginToolUsage` → the turn's recorded usage
     in host-core), never summed into the model's `inputTokens` /
     `outputTokens`, so the cost surface can show it as its own line.
   - `terminate` asks the agent to stop after the current batch. The kernel's
     rule applies unchanged: it stops only when **every** finalized result in
     the batch asks for it, so one tool's request never cuts a batch short. A
     refused plugin's hint is cleared explicitly, because the kernel reads an
     absent field as "keep the original".
   A plugin tool's result also opts into the kernel shape by carrying one of
   these fields: `content` then reaches the model as content instead of a JSON
   blob. A result without them keeps the previous rendering. All three fields
   disappear with the plugin: the tools it introduced live in the session's
   catalogue, which `rebuildToolCatalog` rebuilds from the loaded plugins.
7. A plugin tool executes in the plugin's own process (spec 04). Its execution
   context (`PluginToolExecContext`) carries `sessionId`, `turnId`, `mode`,
   `modelKey`, `thinkingLevel`, `log`, and `signal` — the turn's cancellation
   token (§6.1). `signal` aborts when the user stops the turn, when a plugin
   asks for the abort, or when the host abandons the turn; long-running work
   should pass it to `fetch` or watch it and stop. Every plugin invocation the
   host still holds is cancelled on plugin unload, on session turn replacement,
   and on shutdown.

## 8. Commands

1. `registerCommand` entries appear in the Commands section of global search
   (see [09-plugin-command-palette.md](09-plugin-command-palette.md)) as
   `/<name>` with the extension's label as the source, after built-in and
   plugin commands.
2. A command runs in the sidecar with the extension command context bound to
   the active session. It requires an active session whose runtime has
   loaded extensions in this app run; otherwise the composer reports that a
   chat must be started first.
3. Commands typed in the composer as `/<name>` resolve in this order:
   built-in, prompt template, plugin, extension. Collisions are diagnostics.
4. A running command blocks composer submission the same way a plugin command
   does and can be cancelled from the status line.

## 9. UI bridge

Interactive context calls travel sidecar → Electron main → renderer and back.

| Call | Renderer surface | Timeout | On abort |
|---|---|---|---|
| `ui.notify` | Toast | none | dropped |
| `ui.confirm` | Modal with two actions | 5 min | resolves `false` |
| `ui.select` | Modal list | 5 min | resolves `undefined` |
| `ui.input` | Modal text field | 5 min | resolves `undefined` |
| `ui.setStatus`, `ui.setWorkingMessage` | Floating status line for the active session (v1 note: not inside the composer) | none | cleared |

Rules:

- One pending interactive prompt per session. A second call queues behind
  the first.
- Aborting the turn cancels pending prompts with the abort values above.
- Under remote control (Post-MVP) the prompt fails immediately with
  `UNSUPPORTED` until the remote protocol routes it; that routing is v3.
- Prompts show the extension label and source path so the user knows who is
  asking.

## 10. Protocol and IPC additions

No host-core RPC method, protocol version, or SQLite schema changes in v1.

### 10.1 Sidecar → main (host.proxy allowlist)

| Method | Purpose |
|---|---|
| `extensions.commands.publish` | Replace the session's registered command list |
| `extensions.ui.request` | One interactive or status call from §9 |
| `extensions.diagnostics.publish` | Replace the session's diagnostics list |
| `extensions.model.configure` | Validate and persist a plugin-owned provider/model binding through `session.configure`, then broadcast `session:modelChanged` |
| `session.rename`, `session.create`, `session.fork`, `session.queuePush`, `session.queuePrioritize` | Existing methods, now reachable from the adapter |

### 10.2 Main ↔ renderer (Electron IPC)

| Channel | Direction | Purpose |
|---|---|---|
| `plugin/importExtension` | request | Native picker, generate the plugin, register it as a development plugin |
| `extensions/commands/run` | request | Run a registered command in the active session |
| `extensions/ui/respond` | request | Answer a pending prompt |
| `extensions/ui/prompt` | event | A prompt is pending |
| `extensions/event/status` | event | `ui.setStatus` / `ui.setWorkingMessage` text changed |
| `plugin/list` | request | Plugin rows carry `agentExtension` state, tool, command, custom-agent names, and diagnostics |
| `event/pluginChanged` | event | Also fires when a session publishes commands, diagnostics, or model binding changes |
| `plugin/renderer/call` | request | One forwarded renderer action (`plugin.call`): payload `{ pluginId, method, args }`; result is the calling plugin's own entry's answer |

All channels are sender-validated like other plugin channels. The MCP
control plane exposes `extensions/commands/run` (write) and
`extensions/ui/respond` (dangerous, confirm required); the import is a native
picker and stays local. Main audits each prompt id in `logs/app/plugin.log`.

## 11. Plugin row surface

The Plugins page shows agent extensions on the owning plugin's row:

- The `agentExtension` capability chip and the `agent.extension` permission
  chip (high risk) beside the other capabilities and permissions.
- A details section with a state chip (`enabled` until a session loads the
  modules in this app run, `loaded`, `error`), the registered tool, slash
  command and custom-agent names, and the diagnostics: load errors, unsupported
  API calls with counts, rejected registrations, handler timeouts.
- "Import pi extension" in the page's overflow actions, guarded by a confirm
  that states what the grant means.

## 12. Phasing

| Phase | Content | Commitment |
|---|---|---|
| v1 | Loader, Runner per session, support matrix, events, tools, commands, UI bridge | Shipped (D387) |
| v1.1 | Modules become `contributes.agentExtensions` with the `agent.extension` grant; import of pi CLI extensions as development plugins; the standalone registry and settings tab are removed | Shipped (D388) |
| v1.1 amendment | Plugin-owned custom agents via `registerAgent`, provider compatibility alias, redacted model registry, idle-only session binding and restore through `extension-agent:` ids | Implemented (D426 / ADR 0258) |
| v2 | Custom session entries (`sendMessage`, `appendEntry`) with a schema bump and a generic renderer, `sessionManager` read shim, `switchSession`, editor read and write, autocomplete providers, `registerShortcut`, markdown transformers | Planned, needs a decision on entry persistence and compaction |
| v3 | `pi` package manifests and installation, read-only hints from the pi CLI's `settings.json`, unified skill and prompt discovery, remote-control routing for prompts, marketplace listing | Not scheduled |

v1 delivery order: bundling spike (E2E-245), shared protocol types, then the
runtime, main, and renderer tracks in parallel.

## 13. Versioning policy

- Upgrading any pi package upgrades all three together.
- A fixture set of sample extensions covering each supported member runs as a
  contract test on every upgrade.
- New `ExtensionAPI` members land in the Unsupported class with a
  diagnostic until a later decision moves them.
- Public documentation promises only the Supported and Supported-on-context
  classes in §5.

## 14. Open decisions

| Question | Default until decided |
|---|---|
| Should v2 custom entries persist to host-core and take part in compaction? | Persist; excluded from compaction summaries |
| Should v3 read the pi CLI's `settings.json` enabled paths as discovery hints? | Read-only hints, never written |
| Should extension tools be selectable per project like plugin tools? | Scope from §3.2 is the only gate |
