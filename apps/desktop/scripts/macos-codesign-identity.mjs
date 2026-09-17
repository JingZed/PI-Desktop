#!/usr/bin/env node
/**
 * Keep the macOS code-signing identifier equal to CFBundleIdentifier.
 *
 * Unsigned electron-builder packs leave Electron's adhoc signature
 * (`Identifier=Electron`) on PI-Desktop.app. usernotificationsd then refuses
 * requests for the product bundle ID (issue #524).
 *
 * Developer ID signatures are left untouched. A mismatch there is a packaging
 * bug and must fail the build rather than be overwritten with an adhoc sign.
 *
 * The Apple Silicon pack carries Electron's own adhoc signature, so binding
 * the identifier on the outer bundle is enough. The Intel pack ships nested
 * helpers and frameworks without a signature, and `codesign` then refuses to
 * seal the outer bundle ("code object is not signed at all"). That case signs
 * nested code explicitly, deepest first — the order `@electron/osx-sign` uses —
 * and never `--deep` (ADR 0278).
 */
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import path from "node:path";

export const MAC_BUNDLE_ID = "net.aiuo.pi-desktop";

/** Mach-O magic numbers: thin 32/64-bit and fat, plus their byte-swapped forms. */
const MACH_O_MAGICS = new Set([
  0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca, 0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
]);

function isMachOFile(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const header = Buffer.alloc(4);
    if (readSync(fd, header, 0, 4, 0) < 4) return false;
    return (
      MACH_O_MAGICS.has(header.readUInt32BE(0)) || MACH_O_MAGICS.has(header.readUInt32LE(0))
    );
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Nested code inside the app bundle — Mach-O files and `.app` / `.framework`
 * bundles — deepest first, the order codesign requires because a signature can
 * only reference already-signed children. Symbolic links are skipped: the
 * framework version links resolve inside the bundle that is signed anyway.
 */
export function listNestedSignableCode(appPath) {
  const found = [];
  const walk = (dirPath) => {
    let entries;
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(entryPath);
        if (entry.name.endsWith(".app") || entry.name.endsWith(".framework")) found.push(entryPath);
      } else if (entry.isFile() && isMachOFile(entryPath)) {
        found.push(entryPath);
      }
    }
  };
  walk(path.join(appPath, "Contents"));
  return found.sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
}

function runCodesign(args) {
  return spawnSync("codesign", args, { encoding: "utf8" });
}

function codesignFailure(result) {
  const text = `${result.stderr ?? ""}${result.stdout ?? ""}${result.error?.message ?? ""}`.trim();
  return text || `exit status ${result.status}`;
}

/** codesign refused because nested code carries no signature at all. */
function isUnsignedNestedCodeFailure(result) {
  return /code object is not signed at all/i.test(codesignFailure(result));
}

export function dumpMacCodesign(appPath) {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
    encoding: "utf8",
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function readMacCodesignIdentifier(appPath) {
  const dump = dumpMacCodesign(appPath);
  return {
    dump,
    identifier: dump.match(/^Identifier=(.+)$/m)?.[1] ?? null,
    developerId: /Authority=Developer ID Application/.test(dump),
    unsigned: /code object is not signed at all/i.test(dump),
  };
}

export function ensureMacCodesignIdentifier(appPath, bundleId = MAC_BUNDLE_ID) {
  if (process.platform !== "darwin") {
    return { status: "skipped", reason: "not-darwin" };
  }
  if (!existsSync(appPath)) {
    throw new Error(`macOS app bundle not found: ${appPath}`);
  }

  const current = readMacCodesignIdentifier(appPath);
  if (current.developerId) {
    if (current.identifier !== bundleId) {
      throw new Error(
        `Developer ID identifier is ${current.identifier ?? "missing"}, expected ${bundleId}`,
      );
    }
    return { status: "unchanged", reason: "developer-id", identifier: current.identifier };
  }
  if (current.identifier === bundleId) {
    return { status: "unchanged", reason: "already-matching", identifier: current.identifier };
  }

  const signOuterBundle = () =>
    runCodesign(["--force", "--sign", "-", "--identifier", bundleId, appPath]);

  let signed = signOuterBundle();
  let nestedSigned = 0;
  if (signed.status !== 0 && isUnsignedNestedCodeFailure(signed)) {
    // The Intel pack leaves nested helpers, frameworks, and Mach-O payloads
    // unsigned, which blocks sealing the outer bundle. Sign them deepest-first
    // (the @electron/osx-sign order) and retry the outer bundle; ADR 0278 still
    // forbids --deep.
    const nestedCode = listNestedSignableCode(appPath);
    for (const entryPath of nestedCode) {
      const result = runCodesign(["--force", "--sign", "-", entryPath]);
      if (result.status !== 0) {
        throw new Error(
          `adhoc codesign failed for nested ${path.relative(appPath, entryPath)}: ` +
            codesignFailure(result),
        );
      }
    }
    nestedSigned = nestedCode.length;
    signed = signOuterBundle();
  }
  if (signed.status !== 0) {
    throw new Error(`adhoc codesign failed for ${appPath}: ${codesignFailure(signed)}`);
  }

  const next = readMacCodesignIdentifier(appPath);
  if (next.identifier !== bundleId) {
    throw new Error(
      `adhoc codesign left identifier ${next.identifier ?? "missing"}, expected ${bundleId}`,
    );
  }
  return {
    status: "adhoc-signed",
    identifier: next.identifier,
    previous: current.identifier,
    nestedSigned,
  };
}
