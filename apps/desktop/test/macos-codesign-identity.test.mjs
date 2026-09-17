import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  ensureMacCodesignIdentifier,
  listNestedSignableCode,
  MAC_BUNDLE_ID,
  readMacCodesignIdentifier,
} from "../scripts/macos-codesign-identity.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

/** Mach-O 64-bit magic (0xfeedfacf) as stored little-endian on disk. */
const MACH_O_HEADER = Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0x00, 0x00, 0x00, 0x00]);

async function writeExecutable(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, MACH_O_HEADER, { mode: 0o755 });
}

function toBundlePaths(appPath, paths) {
  return paths.map((entry) => relative(appPath, entry).split(sep).join("/"));
}

test("packaging binds the macOS codesign identifier after pack", () => {
  assert.equal(packageJson.build.appId, MAC_BUNDLE_ID);
  assert.equal(packageJson.build.afterPack, "./scripts/after-pack.mjs");
});

test("nested signable code is collected deepest-first and without plain resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-desktop-nested-code-"));
  const appPath = join(root, "PI-Desktop.app");
  const helperAppPath = join(
    appPath,
    "Contents",
    "Frameworks",
    "PI-Desktop Helper (Renderer).app",
  );
  try {
    await writeExecutable(join(appPath, "Contents", "MacOS", "PI-Desktop"));
    await writeExecutable(
      join(helperAppPath, "Contents", "MacOS", "PI-Desktop Helper (Renderer)"),
    );
    await writeExecutable(
      join(appPath, "Contents", "Frameworks", "Electron Framework.framework", "Versions", "A", "Electron Framework"),
    );
    await mkdir(join(appPath, "Contents", "Resources"), { recursive: true });
    await writeFile(join(appPath, "Contents", "Resources", "app.asar"), "not code\n");
    await writeFile(join(appPath, "Contents", "Resources", "models.json"), "{}\n");

    const nested = listNestedSignableCode(appPath);

    assert.deepEqual(
      toBundlePaths(appPath, nested).sort(),
      [
        "Contents/Frameworks/Electron Framework.framework",
        "Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework",
        "Contents/Frameworks/PI-Desktop Helper (Renderer).app",
        "Contents/Frameworks/PI-Desktop Helper (Renderer).app/Contents/MacOS/PI-Desktop Helper (Renderer)",
        "Contents/MacOS/PI-Desktop",
      ].sort(),
    );

    // A signature can only reference already-signed children, so the deepest
    // code objects must come first.
    const depths = nested.map((entry) => entry.split(sep).length);
    assert.deepEqual(depths, [...depths].sort((left, right) => right - left));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "adhoc re-sign replaces Electron identifier with the product bundle id",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-desktop-codesign-"));
    const appPath = join(root, "PI-Desktop.app");
    const macos = join(appPath, "Contents", "MacOS");
    try {
      await mkdir(macos, { recursive: true });
      await writeFile(join(macos, "PI-Desktop"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      await writeFile(
        join(appPath, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PI-Desktop</string>
<key>CFBundleIdentifier</key><string>${MAC_BUNDLE_ID}</string>
<key>CFBundleName</key><string>PI-Desktop</string>
</dict></plist>
`,
      );

      const signed = spawnSync(
        "codesign",
        ["--force", "--sign", "-", "--identifier", "Electron", appPath],
        { encoding: "utf8" },
      );
      assert.equal(signed.status, 0, signed.stderr || signed.stdout);
      assert.equal(readMacCodesignIdentifier(appPath).identifier, "Electron");

      const result = ensureMacCodesignIdentifier(appPath, MAC_BUNDLE_ID);
      assert.equal(result.status, "adhoc-signed");
      assert.equal(result.previous, "Electron");
      assert.equal(result.identifier, MAC_BUNDLE_ID);
      assert.equal(result.nestedSigned, 0);
      assert.equal(readMacCodesignIdentifier(appPath).identifier, MAC_BUNDLE_ID);

      const second = ensureMacCodesignIdentifier(appPath, MAC_BUNDLE_ID);
      assert.equal(second.status, "unchanged");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "binding the identifier still succeeds when nested helper code is unsigned",
  { skip: process.platform !== "darwin" },
  async () => {
    // The Intel pack ships a previous outer signature next to unsigned nested
    // helpers, which is what rejects a plain outer re-sign.
    const root = await mkdtemp(join(tmpdir(), "pi-desktop-codesign-nested-"));
    const appPath = join(root, "PI-Desktop.app");
    const helperAppPath = join(
      appPath,
      "Contents",
      "Frameworks",
      "PI-Desktop Helper (Renderer).app",
    );
    try {
      await writeExecutable(join(appPath, "Contents", "MacOS", "PI-Desktop"));
      await writeFile(
        join(appPath, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PI-Desktop</string>
<key>CFBundleIdentifier</key><string>${MAC_BUNDLE_ID}</string>
<key>CFBundleName</key><string>PI-Desktop</string>
</dict></plist>
`,
      );
      await writeExecutable(
        join(helperAppPath, "Contents", "MacOS", "PI-Desktop Helper (Renderer)"),
      );
      await writeFile(
        join(helperAppPath, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>PI-Desktop Helper (Renderer)</string>
<key>CFBundleIdentifier</key><string>${MAC_BUNDLE_ID}.helper.renderer</string>
<key>CFBundleName</key><string>PI-Desktop Helper (Renderer)</string>
</dict></plist>
`,
      );

      const stale = spawnSync(
        "codesign",
        ["--force", "--sign", "-", "--identifier", "Electron", appPath],
        { encoding: "utf8" },
      );
      assert.equal(stale.status, 0, stale.stderr || stale.stdout);

      const result = ensureMacCodesignIdentifier(appPath, MAC_BUNDLE_ID);
      assert.equal(result.status, "adhoc-signed");
      assert.equal(result.identifier, MAC_BUNDLE_ID);
      assert.ok(listNestedSignableCode(appPath).length > 0);
      assert.equal(readMacCodesignIdentifier(appPath).identifier, MAC_BUNDLE_ID);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
