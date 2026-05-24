#!/usr/bin/env node
/**
 * Sync piConfig from root package.json → workspace + pkg/ package.json.
 *
 * piConfig is the single knob that controls LOOP24's brand strings (name,
 * configDir, commandNamespace, brandName). It needs to live in THREE
 * package.json files for these three runtime contexts:
 *
 *   1. Root package.json — read by src/brand.ts, src/help-text.ts, etc.
 *      (the loader-fast synchronous JSON.parse path). This is the canonical
 *      source.
 *   2. packages/pi-coding-agent/package.json — read by getPackageDir() in
 *      pi-coding-agent's config.js when PI_PACKAGE_DIR is unset (tests,
 *      standalone imports).
 *   3. pkg/package.json — read at runtime because src/loader.ts:84-88
 *      explicitly sets PI_PACKAGE_DIR=pkg/ for the loop24 binary path.
 *      Load-bearing for the actual CLI.
 *
 * Mirrors the existing scripts/sync-pkg-version.cjs pattern. Run by `prebuild`
 * so any edit to root piConfig flows to the other two automatically.
 *
 * If you change piConfig, edit ONLY root package.json. This script handles
 * the rest. (scripts/verify-piconfig-sync.mjs guards against direct edits
 * to the mirrors.)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CANONICAL = join(ROOT, "package.json");
const MIRRORS = [
  {
    path: join(ROOT, "packages", "pi-coding-agent", "package.json"),
    label: "packages/pi-coding-agent/package.json",
  },
  {
    path: join(ROOT, "pkg", "package.json"),
    label: "pkg/package.json",
  },
];

const SYNC_COMMENT = "AUTO-SYNCED from root package.json by scripts/sync-piconfig.mjs (runs on prebuild). Do not edit this block directly — edit root package.json and re-run `npm run build` or `npm run sync-piconfig`.";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJsonPreserveNewline(path, obj) {
  const text = JSON.stringify(obj, null, 2);
  // Preserve the trailing-newline convention seen in the repo's package.json files.
  writeJsonAtomic(path, text + "\n");
}

function writeJsonAtomic(path, text) {
  writeFileSync(path, text, "utf-8");
}

const canonical = readJson(CANONICAL);
const canonicalPi = canonical.piConfig;

if (!canonicalPi || typeof canonicalPi !== "object") {
  console.error(`[sync-piconfig] ERROR: root package.json has no piConfig block`);
  process.exit(1);
}

// Build the canonical piConfig that mirrors should adopt.
// The mirrors get an AUTO-SYNC `_comment` (overwriting whatever was there).
const fieldsToSync = ["name", "configDir", "commandNamespace", "brandName"];
const mirrorPi = { _comment: SYNC_COMMENT };
for (const field of fieldsToSync) {
  if (field in canonicalPi) mirrorPi[field] = canonicalPi[field];
}

let changedAny = false;
for (const mirror of MIRRORS) {
  const pkg = readJson(mirror.path);
  const currentPi = pkg.piConfig || {};

  // Check if a sync is needed (compare the canonical fields only, ignoring _comment).
  let needsSync = false;
  for (const field of fieldsToSync) {
    if (currentPi[field] !== canonicalPi[field]) {
      needsSync = true;
      break;
    }
  }
  if (currentPi._comment !== SYNC_COMMENT) needsSync = true;

  if (!needsSync) {
    console.log(`[sync-piconfig] ${mirror.label} already in sync`);
    continue;
  }

  pkg.piConfig = mirrorPi;
  writeJsonPreserveNewline(mirror.path, pkg);
  console.log(`[sync-piconfig] updated ${mirror.label}`);
  changedAny = true;
}

if (!changedAny) {
  console.log("[sync-piconfig] all mirrors already in sync");
}
