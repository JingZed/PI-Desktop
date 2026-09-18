# Slots Demo

A PI-Desktop example plugin for the trusted renderer host: it registers React
components into host-owned slots and injects one namespaced stylesheet. It is the
copy-me shape for `manifest.renderer` (spec `07-plugins/16-trusted-extensions.md`
§2A, ADR 0287).

## What it demonstrates

- **Two entries, one plugin.** `main.js` is the headless half (the plugin's own
  process, the host-injected `pi` global). `renderer/index.mjs` is the trusted
  renderer half, which runs **inside the app window**. The tiers are orthogonal:
  declaring one grants nothing in the other.
- **`renderer.extension`.** `manifest.renderer` plus that grant is what lets the
  host serve and evaluate the module. Declaring `renderer` without the permission
  fails manifest validation; a manifest that asks for it but was never granted it
  loads with the entry skipped and audited.
- **Component slots.** `entryExtra` (a component-only slot, one extra block below
  a transcript entry) and `modal` (a blocking, app-level dialog).
- **The host's React, not the plugin's.** `react` is imported as a bare
  specifier; the host maps it to its own instance through an import map. The
  modal's counter uses `useState` from that shared instance — a plugin that
  shipped its own React copy would be refused at load.
- **Lazy loading.** Nothing is fetched until one of the plugin's slots actually
  renders, and an unrendered slot costs nothing at startup.
- **Injected, namespaced styles.** `pi.ui.injectStyle(css)` is the only way to
  style plugin UI. Every selector here is `.acme-slots-demo__*`; a sheet whose
  top-level selector is `html`, `body`, `:root`, or `*` is refused whole instead
  of being silently narrowed. The host removes the sheet on unload, so the module
  exports no `onUnload`.

## Files

| File | Role |
|---|---|
| `manifest.json` | Declares `main`, `renderer`, the `renderer.extension` permission, and one command |
| `main.js` | Headless entry: registers the declared command in the plugin process |
| `renderer/index.mjs` | Renderer entry: `onLoad(pi)` injects the stylesheet and registers two slots |

## Install (development folder)

There is no CLI install step for a plugin folder — the app loads it:

1. Open PI-Desktop and go to the **Extensions** destination in the sidebar
   (`Plugins` in older docs and in `docs/spec/`).
2. Open the header **⋯ (More actions)** menu and choose **Load local plugin**.
   The same button is offered in the empty state. Older documentation calls this
   action "Load development plugin".
3. Select the `examples/plugins/slots-demo` directory.
4. Accept the permission review. It must include `renderer.extension`; without
   that grant the manifest is refused, or the entry is skipped and audited.

Use **Load local plugin** for this example — **Import pi extension** is for pi CLI
extension packages and is a different flow.

## What you should see

The plugin row shows a `renderer` capability chip once the entry is served. The
slots draw wherever the host's current surfaces mount them: the badge below a
transcript entry, the dialog as an app-level modal. A slot no visible surface
renders simply leaves the module unloaded — that is the design, not a failure. If
a component throws, only its own slot collapses to the host's default rendering
and the crash is reported as a diagnostic.

## Reference

- Spec: `docs/spec/07-plugins/16-trusted-extensions.md` §2A
- Decision: `docs/adr/0287-trusted-renderer-execution-host.md`
- Other examples: `examples/plugins/README.md`
