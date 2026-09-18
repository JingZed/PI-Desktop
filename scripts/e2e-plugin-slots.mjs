#!/usr/bin/env node
/**
 * Trusted renderer host build-contract E2E (headless).
 *
 * E2E-PLUGIN-renderer-slots-survive-a-packaged-build
 *   The renderer host's contract only breaks where it cannot be debugged: a
 *   packaged renderer loads `plugin-renderer:` module source from a `file://`
 *   origin, and a CSP that does not name the scheme, a scheme registered
 *   without the privileges a module fetch needs, a MIME allowlist that grew an
 *   `html` entry, a revoked permission that still serves a path, or a channel
 *   the preload refuses, all pass in dev and fail only after packaging. The
 *   assertions below run the real modules — the real Vite plugin, the real
 *   protocol handler with a stubbed Electron, the real IPC whitelist — instead
 *   of comparing copies of them.
 *
 * Nothing here boots Electron, installs a plugin into a profile, or touches the
 * network. The main process modules are bundled with esbuild and a stubbed
 * `electron` so their real code runs in Node; the renderer-side modules are
 * covered by `apps/desktop/test/plugin-renderer-slots.test.mjs`.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "packages/agent-runtime/package.json"));

const INDEX_HTML = join(root, "apps/desktop/index.html");
const VITE_CONFIG = join(root, "apps/desktop/electron.vite.config.ts");
const PROTOCOL_MODULE = join(root, "apps/desktop/electron/main/plugin-renderer-protocol.ts");
const STARTUP = join(root, "apps/desktop/electron/main/bootstrap/startup.ts");
const PLUGIN_RUNTIME = join(root, "apps/desktop/electron/main/plugin-runtime.ts");
const SHARED_PROTOCOL = join(root, "packages/shared/src/protocol.ts");
const PRELOAD = join(root, "apps/desktop/electron/preload/index.ts");
const EXAMPLE_PLUGIN = join(root, "examples/plugins/slots-demo");
const SDK_RENDERER = join(root, "packages/plugin-sdk/dist/renderer.js");
const SDK_INDEX = join(root, "packages/plugin-sdk/dist/index.js");

const results = [];
function record(id, ok, detail = "") {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}${detail ? ` — ${detail}` : ""}`);
}

/** Module sources substituted for real ones, so the real code can run in Node. */
function stubModules(contents) {
  const specifiers = new Set(Object.keys(contents));
  return {
    name: "pi-e2e-stubs",
    setup(api) {
      api.onResolve({ filter: /.*/ }, (args) =>
        specifiers.has(args.path) ? { path: args.path, namespace: "pi-stub" } : undefined,
      );
      api.onLoad({ filter: /.*/, namespace: "pi-stub" }, (args) => ({
        contents: contents[args.path],
        loader: "js",
      }));
    },
  };
}

/**
 * Bundle one real TypeScript module to CommonJS and require it. Bundling is how
 * this suite runs the real implementation: `electron` and the Vite plugins are
 * replaced, everything else — including `@pi-desktop/plugin-sdk` — stays real.
 */
async function bundleToCjs(entry, stubs, name) {
  const { build } = require("esbuild");
  const output = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: stubs ? [stubModules(stubs)] : [],
  });
  const file = join(temp, `${name}.cjs`);
  writeFileSync(file, output.outputFiles[0].text);
  return require(file);
}

/** The CSP a document declares, or null when it carries none. */
function cspOf(html) {
  return (
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? null
  );
}

/** Sources a directive lists, or null when the policy does not declare it. */
function directiveSources(csp, directive) {
  const part = csp
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.toLowerCase().startsWith(directive));
  return part ? part.split(/\s+/).slice(1) : null;
}

/**
 * The source text of one method: from its signature to the brace that closes the
 * body. Used for the two files that cannot be imported without booting the app
 * composition root (`startup.ts`, `plugin-runtime.ts`).
 */
function methodSource(source, signature) {
  const at = source.indexOf(signature);
  if (at < 0) return null;
  const open = source.indexOf("{", at);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

/** Source text of a call, from its first `(` to the matching `)`. */
function callSource(source, name) {
  const at = source.indexOf(name);
  if (at < 0) return null;
  const open = source.indexOf("(", at);
  if (open < 0) return null;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

const temp = mkdtempSync(join(tmpdir(), "pi-plugin-slots-e2e-"));

try {
  if (!existsSync(SDK_RENDERER)) {
    throw new Error("packages/plugin-sdk/dist is missing; run pnpm build:js first");
  }
  // The scheme name is read from the built SDK, not repeated here, so renaming
  // it can never leave the assertions passing against a stale literal.
  const { PLUGIN_RENDERER_SCHEME } = await import(pathToFileURL(SDK_RENDERER).href);
  const scheme = `${PLUGIN_RENDERER_SCHEME}:`;
  const html = readFileSync(INDEX_HTML, "utf8");

  // ── E2E-PLUGIN-renderer-csp-allows-plugin-modules ───────────────────────
  // Protects: a packaged renderer is a `file://` origin, so without the scheme
  // in `script-src` the plugin module never evaluates, and without it in
  // `connect-src` the fetch that loads it is blocked. Both hold in dev either
  // way, which is why only a build-contract check catches the regression.
  try {
    const csp = cspOf(html);
    assert(csp, "apps/desktop/index.html declares no Content-Security-Policy meta tag");
    const script = directiveSources(csp, "script-src");
    const connect = directiveSources(csp, "connect-src");
    assert(script, "the CSP declares no script-src");
    assert(connect, "the CSP declares no connect-src");
    assert(script.includes(scheme), `script-src does not allow ${scheme}`);
    assert(connect.includes(scheme), `connect-src does not allow ${scheme}`);
    record("E2E-PLUGIN-renderer-csp-allows-plugin-modules", true, `${scheme} in script-src and connect-src`);
  } catch (error) {
    record("E2E-PLUGIN-renderer-csp-allows-plugin-modules", false, error.message);
  }

  // ── E2E-PLUGIN-renderer-csp-rewrite-keeps-the-scheme ────────────────────
  // Protects: the build-time `tightenCsp()` rewrite replaces the whole
  // `connect-src` directive, so the scheme has to be listed in the replacement
  // itself. Running the real plugin over the real index.html is what proves it.
  try {
    const config = await bundleToCjs(VITE_CONFIG, {
      "electron-vite": "export const defineConfig = (config) => config;\nexport default defineConfig;",
      "@vitejs/plugin-react": "export default function react() { return { name: \"react-stub\" }; }",
      "@tailwindcss/vite": "export default function tailwindcss() { return { name: \"tailwind-stub\" }; }",
    }, "vite-config");
    const plugins = config.default.renderer.plugins;
    const plugin = plugins.find((entry) => entry.name === "pi-tighten-csp");
    assert(plugin?.transformIndexHtml, "the renderer config no longer registers pi-tighten-csp");
    const tightened = plugin.transformIndexHtml(html);
    assert(tightened !== html, "tightenCsp() no longer rewrites index.html");
    assert(!tightened.includes("'unsafe-eval'"), "the tightened CSP still ships 'unsafe-eval'");
    const csp = cspOf(tightened);
    assert(csp, "the tightened document declares no CSP");
    for (const directive of ["script-src", "connect-src"]) {
      const sources = directiveSources(csp, directive);
      assert(sources, `the tightened CSP declares no ${directive}`);
      assert(sources.includes(scheme), `${directive} lost ${scheme} in the build rewrite`);
    }
    const connect = directiveSources(csp, "connect-src");
    for (const devHost of ["ws://localhost:*", "http://localhost:*"]) {
      assert(!connect.includes(devHost), `connect-src kept the development host ${devHost}`);
    }
    record("E2E-PLUGIN-renderer-csp-rewrite-keeps-the-scheme", true, "script-src and connect-src survive the packaged rewrite");
  } catch (error) {
    record("E2E-PLUGIN-renderer-csp-rewrite-keeps-the-scheme", false, error.message);
  }

  // ── E2E-PLUGIN-renderer-scheme-privileges-and-mime-allowlist ────────────
  // Protects: the privileges Electron is told about before the app is ready
  // (a module fetch from a `file://` origin needs a standard, secure, fetchable,
  // CORS-enabled scheme), GET-only handling, and the MIME allowlist — `html`
  // staying out of it is what keeps the scheme from serving a navigable page.
  try {
    const files = join(temp, "plugin-files");
    mkdirSync(join(files, "renderer"), { recursive: true });
    writeFileSync(join(files, "renderer", "index.mjs"), "export function onLoad() {}\n");
    writeFileSync(join(files, "renderer", "index.js"), "export const js = true;\n");
    writeFileSync(join(files, "renderer", "panel.css"), ".acme-slots-demo__badge { opacity: 1; }\n");
    writeFileSync(join(files, "renderer", "data.json"), '{ "ok": true }\n');
    writeFileSync(join(files, "renderer", "index.mjs.map"), '{ "version": 3 }\n');
    writeFileSync(join(files, "renderer", "with space.mjs"), "export const spaced = true;\n");
    writeFileSync(join(files, "renderer", "view.html"), "<!doctype html>\n");

    const electron = await bundleToCjs(PROTOCOL_MODULE, {
      electron: `
export const protocol = {
  registerSchemesAsPrivileged(schemes) {
    globalThis.__PI_PROTOCOL_SCHEMES__ = schemes;
  },
  handle(name, handler) {
    globalThis.__PI_PROTOCOL_HANDLERS__ = { ...(globalThis.__PI_PROTOCOL_HANDLERS__ ?? {}), [name]: handler };
  },
};
`,
    }, "plugin-renderer-protocol");

    electron.registerPluginRendererScheme();
    const schemes = globalThis.__PI_PROTOCOL_SCHEMES__;
    assert.equal(schemes?.length, 1, "the scheme is not registered exactly once");
    assert.equal(schemes[0].scheme, PLUGIN_RENDERER_SCHEME, "a different scheme is registered");
    assert.deepEqual(
      schemes[0].privileges,
      { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
      `the privileges a fetched module needs changed: ${JSON.stringify(schemes[0].privileges)}`,
    );

    const pluginId = "acme.slots-demo";
    const resolverCalls = [];
    electron.installPluginRendererProtocol((resolvedId, requestPath) => {
      resolverCalls.push([resolvedId, requestPath]);
      if (resolvedId !== pluginId) return null;
      return join(files, requestPath);
    });
    const handler = globalThis.__PI_PROTOCOL_HANDLERS__?.[PLUGIN_RENDERER_SCHEME];
    assert(handler, `no handler installed for ${PLUGIN_RENDERER_SCHEME}`);

    const request = (path, method = "GET") =>
      handler(new Request(`plugin-renderer://${pluginId}/${path}`, { method }));

    const cases = [
      ["renderer/index.mjs", "text/javascript"],
      ["renderer/index.js", "text/javascript"],
      ["renderer/panel.css", "text/css"],
      ["renderer/data.json", "application/json"],
      ["renderer/index.mjs.map", "application/json"],
    ];
    for (const [path, contentType] of cases) {
      const response = await request(path);
      assert.equal(response.status, 200, `${path} answered ${response.status}, not 200`);
      assert.equal(
        response.headers.get("content-type"),
        contentType,
        `${path} was served as ${response.headers.get("content-type")}`,
      );
      assert.equal(response.headers.get("cache-control"), "no-store", `${path} is cacheable`);
      assert.equal(
        response.headers.get("x-content-type-options"),
        "nosniff",
        `${path} may be sniffed`,
      );
      assert.equal(
        await response.text(),
        readFileSync(join(files, path), "utf8"),
        `${path} was served with different bytes`,
      );
    }

    // A path is percent-decoded once, the way a module URL encodes it.
    assert.equal((await request("renderer/with%20space.mjs")).status, 200, "an encoded path is not decoded");
    assert(
      resolverCalls.some(([, path]) => path === "renderer/with space.mjs"),
      "the resolver saw an undecoded request path",
    );

    // `html` is deliberately not on the allowlist: the scheme serves module
    // graphs, not navigable pages.
    assert.equal((await request("renderer/view.html")).status, 404, "html is served by the scheme");

    // The method is checked before resolution: a POST never reaches a plugin.
    resolverCalls.length = 0;
    assert.equal((await request("renderer/index.mjs", "POST")).status, 404, "POST is served");
    assert.equal((await request("renderer/index.mjs", "HEAD")).status, 404, "HEAD is served");
    assert.equal(resolverCalls.length, 0, "a non-GET request reached the resolver");
    assert.equal((await request("")).status, 404, "an empty path is served");

    // A file the plugin package does not have, and a plugin whose grant was
    // revoked (the resolver answers null), are both plain 404s.
    assert.equal((await request("renderer/missing.mjs")).status, 404, "a missing file is served");
    const revoked = await handler(new Request("plugin-renderer://someone.else/renderer/index.mjs"));
    assert.equal(revoked.status, 404, "another plugin's source is reachable");
    record(
      "E2E-PLUGIN-renderer-scheme-privileges-and-mime-allowlist",
      true,
      "GET-only, 5 MIME types, html and revoked plugins refused",
    );
  } catch (error) {
    record("E2E-PLUGIN-renderer-scheme-privileges-and-mime-allowlist", false, error.message);
  }

  // ── E2E-PLUGIN-renderer-scheme-prepared-before-first-window ─────────────
  // Protects: Electron only accepts scheme privileges before the app is ready
  // and the handler has to be installed with the runtime's own gate, so the
  // call order in the boot sequence is a hard requirement, not style.
  try {
    const startup = readFileSync(STARTUP, "utf8");
    const registerAt = startup.indexOf("registerPluginRendererScheme()");
    const readyAt = startup.indexOf("app.whenReady()");
    const installAt = startup.indexOf("installPluginRendererProtocol(");
    assert(registerAt > -1, "the boot sequence never reserves the renderer scheme");
    assert(readyAt > -1, "the boot sequence no longer starts on app.whenReady()");
    assert(
      registerAt < readyAt,
      "the renderer scheme is reserved after app.whenReady(), which Electron refuses",
    );
    assert(installAt > readyAt, "the renderer protocol handler is installed before the app is ready");
    const wiring = callSource(startup.slice(installAt), "installPluginRendererProtocol");
    assert(wiring, "installPluginRendererProtocol() has no argument list");
    assert(
      /plugins\s*\.\s*resolveRendererSource\s*\(\s*pluginId\s*,\s*requestPath\s*\)/.test(wiring),
      `the handler is not wired to the runtime's gate: ${wiring.replace(/\s+/g, " ")}`,
    );
    record("E2E-PLUGIN-renderer-scheme-prepared-before-first-window", true, "reserved pre-ready, installed through plugins.resolveRendererSource");
  } catch (error) {
    record("E2E-PLUGIN-renderer-scheme-prepared-before-first-window", false, error.message);
  }

  // ── E2E-PLUGIN-renderer-entry-gated-by-declaration-and-grant ────────────
  // Protects: both entry points the renderer has (`rendererEntry` over IPC and
  // `resolveRendererSource` over the scheme) go through one gate that requires
  // BOTH the declared `manifest.renderer` and the live `renderer.extension`
  // grant. Dropping either half would serve plugin code to an unreviewed plugin.
  try {
    const runtime = readFileSync(PLUGIN_RUNTIME, "utf8");
    const gate = methodSource(runtime, "private rendererPlugin(");
    assert(gate, "plugin-runtime.ts no longer has a rendererPlugin() gate");
    assert(/this\.loaded\.get\(pluginId\)/.test(gate), "the gate does not require a loaded plugin");
    assert(/loaded\.disposing/.test(gate), "the gate does not exclude a plugin that is unloading");
    assert(/loaded\.manifest\.renderer/.test(gate), "the gate does not require a declared renderer entry");
    assert(
      /permissions\s*\.\s*has\(\s*"renderer\.extension"\s*\)/.test(gate),
      "the gate does not require the renderer.extension grant",
    );

    const entry = methodSource(runtime, "rendererEntry(pluginId: string)");
    assert(entry, "plugin-runtime.ts no longer has rendererEntry()");
    assert(/this\.rendererPlugin\(pluginId\)/.test(entry), "rendererEntry() does not go through the gate");

    const source = methodSource(runtime, "resolveRendererSource(pluginId: string, requestPath: string)");
    assert(source, "plugin-runtime.ts no longer has resolveRendererSource()");
    assert(/this\.rendererPlugin\(pluginId\)/.test(source), "resolveRendererSource() does not go through the gate");
    assert(/resolveInsidePlugin\(/.test(source), "resolveRendererSource() no longer confines the path to the plugin package");
    record("E2E-PLUGIN-renderer-entry-gated-by-declaration-and-grant", true, "declared entry + renderer.extension, one gate for IPC and scheme");
  } catch (error) {
    record("E2E-PLUGIN-renderer-entry-gated-by-declaration-and-grant", false, error.message);
  }

  // ── E2E-PLUGIN-renderer-entry-channel-whitelisted ───────────────────────
  // Protects: the renderer asks the main process for its entry path over one
  // channel, and the preload refuses every channel outside the derived
  // whitelist. A constant that is not in the set never reaches the main process.
  try {
    const protocol = await import(pathToFileURL(SHARED_PROTOCOL).href);
    const channel = "pi-desktop/plugin/renderer/entry";
    assert.equal(
      protocol.IPC.invoke.pluginRendererEntry,
      channel,
      "the renderer entry channel was renamed; update the preload contract and this check",
    );
    assert(
      protocol.IPC_WHITELIST.has(channel),
      "the renderer entry channel is not in the derived IPC whitelist",
    );
    const shared = readFileSync(SHARED_PROTOCOL, "utf8");
    assert(
      /IPC_WHITELIST\s*=\s*new Set<string>\(\[\s*\.\.\.Object\.values\(IPC\.invoke\)/.test(shared),
      "IPC_WHITELIST is no longer derived from IPC.invoke",
    );
    const preload = readFileSync(PRELOAD, "utf8");
    assert(
      /import\s*\{[^}]*IPC_WHITELIST[^}]*\}\s*from\s*"@pi-desktop\/shared\/protocol"/.test(preload),
      "the preload no longer imports the shared whitelist",
    );
    assert(/IPC_WHITELIST\.has\(channel\)/.test(preload), "the preload no longer enforces the whitelist");
    assert(
      /contextBridge\.exposeInMainWorld\(\s*"piDesktop"/.test(preload),
      "the preload no longer exposes the bridge the renderer host calls",
    );
    record("E2E-PLUGIN-renderer-entry-channel-whitelisted", true, `${channel} derived, enforced, exposed`);
  } catch (error) {
    record("E2E-PLUGIN-renderer-entry-channel-whitelisted", false, error.message);
  }

  // ── E2E-PLUGIN-slots-demo-manifest-and-entries ──────────────────────────
  // Protects: the example a plugin author copies has to pass the same manifest
  // validation an install runs, request the grant its entry needs, and point at
  // files that exist — host-core refuses a missing `main` or `renderer` file.
  try {
    const sdk = await import(pathToFileURL(SDK_INDEX).href);
    const manifest = JSON.parse(readFileSync(join(EXAMPLE_PLUGIN, "manifest.json"), "utf8"));
    const validation = sdk.validateManifest(manifest);
    assert.equal(validation.ok, true, `examples/plugins/slots-demo/manifest.json is invalid: ${validation.error}`);
    assert(
      (manifest.permissions ?? []).includes("renderer.extension"),
      "the example does not request renderer.extension, so its entry would never be served",
    );
    assert(typeof manifest.renderer === "string" && manifest.renderer, "the example declares no renderer entry");
    assert(
      existsSync(join(EXAMPLE_PLUGIN, manifest.renderer)),
      `the declared renderer entry is missing: ${manifest.renderer}`,
    );
    assert(typeof manifest.main === "string" && manifest.main, "the example declares no main entry");
    assert(existsSync(join(EXAMPLE_PLUGIN, manifest.main)), `the declared main entry is missing: ${manifest.main}`);

    const renderer = readFileSync(join(EXAMPLE_PLUGIN, manifest.renderer), "utf8");
    assert(
      (renderer.match(/pi\.slots\.register\(/g) ?? []).length >= 2,
      "the example registers fewer than two slots, so it no longer demonstrates the host",
    );
    for (const slot of ["entryExtra", "modal"]) {
      assert(renderer.includes(`"${slot}"`), `the example no longer registers the ${slot} slot`);
    }
    assert(/pi\.ui\.injectStyle\(/.test(renderer), "the example no longer injects a namespaced stylesheet");
    record("E2E-PLUGIN-slots-demo-manifest-and-entries", true, "manifest valid, renderer.extension granted, both entries present");
  } catch (error) {
    record("E2E-PLUGIN-slots-demo-manifest-and-entries", false, error.message);
  }
} catch (error) {
  // A failure before the first check (missing build output, unusable toolchain)
  // still has to be reported as a failed scenario rather than as a crash, and it
  // must not borrow an id from a check that already ran.
  const headline = "E2E-PLUGIN-renderer-slots-survive-a-packaged-build";
  if (!results.some((result) => result.id === headline)) {
    record(headline, false, error instanceof Error ? error.stack ?? error.message : String(error));
  }
} finally {
  rmSync(temp, { recursive: true, force: true });
  try {
    require("esbuild").stop();
  } catch {
    // esbuild was never loaded, so there is no service to stop.
  }
}

const failed = results.filter((result) => !result.ok);
console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
