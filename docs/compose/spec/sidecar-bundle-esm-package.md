---
feature: sidecar-bundle-esm-package
status: in-progress
updated: 2026-09-17
branch: fix/sidecar-bundle-esm-package
commits: <base-sha>..<head-sha>
---

# Sidecar Bundle ESM package.json

## Report

## [S1] Problem

Issue #507 (v0.14.8 Windows packaged install) shows the agent sidecar dying at startup:

```text
SyntaxError: Cannot use import statement outside a module
  at .../resources/agent-runtime/sidecar.js:1
```

`resources/agent-runtime/sidecar.js` is the esbuild ESM bundle copied from
`packages/agent-runtime/dist-bundle` via electron-builder `extraResources`.
`dist-bundle` contains only `sidecar.js`. Node's nearest-`package.json` lookup
finds no `"type": "module"`, so the `.js` entry is loaded as CommonJS and the
ESM `import` banner fails. Development is unaffected because the repo package
itself declares `"type": "module"`.

This is independent of VPN and of the separate `model list request failed (401)`
auth error in the same report.

## [S2] Design

1. The `bundle` script in `packages/agent-runtime/package.json` must, after
   esbuild, write `dist-bundle/package.json` containing at least
   `{"type":"module"}` so electron-builder ships it beside `sidecar.js`.
2. No change to `apps/desktop` `extraResources` mapping: the whole
   `dist-bundle` directory is already copied to `agent-runtime`.
3. No change to `agent-sidecar.ts` spawn path or entry filename.
4. Regression coverage must assert the packaging contract:
   - after a successful bundle, `dist-bundle/package.json` exists and sets
     `"type": "module"`;
   - desktop `extraResources` still sources `agent-runtime` from
     `../../packages/agent-runtime/dist-bundle` (so the new file is shipped).

## [S3] Out of Scope

- HTTP 401 / API-key UX for model discovery (user config; not this bug).
- Issue #506 plugin ESM/CJS main generation.
- Renaming the entry to `sidecar.mjs` or switching the bundle to CJS.
- Proxy/VPN transport behavior.

## Tasks

- [ ] T1: Emit `dist-bundle/package.json` with `"type":"module"` from the agent-runtime bundle script — acceptance: `pnpm -C packages/agent-runtime bundle` produces `dist-bundle/sidecar.js` and `dist-bundle/package.json` with `"type":"module"` (covers: S2)
- [ ] T2: Add packaging regression tests for the ESM package.json contract — acceptance: tests fail without T1 and pass with it; they cover both the bundle output and the desktop extraResources source path (covers: S2; depends: T1)
