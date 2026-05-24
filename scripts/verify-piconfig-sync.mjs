#!/usr/bin/env node
/**
 * Verify piConfig is in sync across all three package.json files.
 *
 * Exits 1 if any mirror has diverged from root (with a clear diff). Wired
 * into `prepublishOnly` so a stale publish is impossible.
 *
 * Run `npm run sync-piconfig` (or just `npm run build`) to fix.
 */

import { readFileSync } from "node:fs";
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

const FIELDS = ["name", "configDir", "commandNamespace", "brandName"];

const canonical = JSON.parse(readFileSync(CANONICAL, "utf-8"));
const canonicalPi = canonical.piConfig || {};

const issues = [];
for (const mirror of MIRRORS) {
  const pkg = JSON.parse(readFileSync(mirror.path, "utf-8"));
  const mirrorPi = pkg.piConfig || {};
  for (const field of FIELDS) {
    if (mirrorPi[field] !== canonicalPi[field]) {
      issues.push(
        `${mirror.label}: piConfig.${field} = ${JSON.stringify(mirrorPi[field])}, expected ${JSON.stringify(canonicalPi[field])} (from root)`,
      );
    }
  }
}

if (issues.length > 0) {
  console.error("[verify-piconfig-sync] FAILED — piConfig out of sync:");
  for (const issue of issues) console.error(`  - ${issue}`);
  console.error("");
  console.error("Fix: edit root package.json piConfig, then run `npm run sync-piconfig` (or `npm run build`).");
  process.exit(1);
}

console.log("[verify-piconfig-sync] piConfig is in sync across all three package.json files");
