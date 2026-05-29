#!/usr/bin/env node
// Project/App: OTTO
// File Purpose: Generate the /release-notes data file from CHANGELOG.md.
/**
 * Single-source-of-truth pipeline:
 *
 *   CHANGELOG.md  →  this script  →  src/resources/extensions/otto/commands/release-notes/_data.ts
 *
 * Runs as part of `prebuild`. The release flow (`bump-version` →
 * `generate-changelog` → `update-changelog`) updates CHANGELOG.md; the next
 * build automatically picks up the new entry and ships it inside OTTO so
 * `/release-notes` lists it.
 *
 * Format expected per release (Keep a Changelog + an OTTO extension for
 * an optional one-line italic "headline" used in the selector label):
 *
 *   ## [X.Y.Z] - YYYY-MM-DD
 *
 *   _Optional headline._
 *
 *   ### Added | Fixed | Changed | Removed | Notes
 *   - bullet
 *
 * The "Unreleased" heading and section-less heads are skipped silently.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const changelogPath = resolve(root, "CHANGELOG.md");
const outPath = resolve(
  root,
  "src/resources/extensions/otto/commands/release-notes/_data.ts",
);

const changelog = readFileSync(changelogPath, "utf-8");

// ─── Parse ──────────────────────────────────────────────────────────────────

const HEADING_RE = /^## \[(?<version>[^\]]+)\](?:\s*-\s*(?<date>\d{4}-\d{2}-\d{2}))?\s*$/;
const SECTION_RE = /^### (Added|Fixed|Changed|Removed|Notes)\s*$/i;
const BULLET_RE = /^[-*+]\s+(.+)$/;
const HEADLINE_RE = /^_(.+?)_\.?\s*$/; // single-line italic; trailing period optional

const SECTION_MAP = {
  added: "added",
  fixed: "fixed",
  changed: "changed",
  removed: "changed", // collapse "Removed" into "Changed" for selector simplicity
  notes: "notes",
};

const releases = [];
let current = null;
let activeSection = null;

const lines = changelog.split("\n");
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const headingMatch = line.match(HEADING_RE);
  if (headingMatch) {
    // Push the previous release if it had any usable content.
    if (current && current.version !== "Unreleased") {
      pushIfUsable(releases, current);
    }
    const { version, date } = headingMatch.groups;
    if (version === "Unreleased") {
      current = null;
      activeSection = null;
      continue;
    }
    current = {
      version,
      date: date ?? "",
      headline: undefined,
      added: [],
      fixed: [],
      changed: [],
      notes: [],
    };
    activeSection = null;
    continue;
  }

  if (!current) continue;

  // Optional headline: first italic single-line block before any ### section.
  if (!activeSection && current.headline === undefined) {
    const headlineMatch = line.match(HEADLINE_RE);
    if (headlineMatch) {
      current.headline = headlineMatch[1].trim();
      continue;
    }
  }

  const sectionMatch = line.match(SECTION_RE);
  if (sectionMatch) {
    activeSection = SECTION_MAP[sectionMatch[1].toLowerCase()] ?? null;
    continue;
  }

  if (!activeSection) continue;
  const bulletMatch = line.match(BULLET_RE);
  if (bulletMatch) {
    current[activeSection].push(bulletMatch[1].trim());
  }
}
if (current && current.version !== "Unreleased") {
  pushIfUsable(releases, current);
}

function pushIfUsable(arr, release) {
  const total =
    release.added.length +
    release.fixed.length +
    release.changed.length +
    release.notes.length;
  if (total === 0 && !release.headline) {
    // Empty section under a header — skip to avoid shipping noise.
    return;
  }
  arr.push(release);
}

if (releases.length === 0) {
  console.error("[sync-release-notes] No release sections parsed from CHANGELOG.md");
  process.exit(1);
}

// Newest-first is the order the data file expects.
releases.sort((a, b) => compareVersion(b.version, a.version));

function compareVersion(a, b) {
  const norm = (v) => v.split(".").map((n) => Number.parseInt(n, 10));
  const [aMaj, aMin, aPat] = norm(a);
  const [bMaj, bMin, bPat] = norm(b);
  return (aMaj - bMaj) || (aMin - bMin) || (aPat - bPat);
}

// ─── Emit ────────────────────────────────────────────────────────────────────

function tsString(s) {
  // Always emit single-quoted strings so embedded backticks/dollars don't trip
  // TypeScript's template-literal parsing. Escape single quotes and backslashes.
  const escaped = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

function emitArray(field, items) {
  if (!items || items.length === 0) return "";
  const lines = items.map((item) => `\t\t\t${tsString(item)},`).join("\n");
  return `\t\t${field}: [\n${lines}\n\t\t],\n`;
}

function emitRelease(r) {
  const headline = r.headline ? `\t\theadline: ${tsString(r.headline)},\n` : "";
  return [
    "\t{\n",
    `\t\tversion: ${tsString(r.version)},\n`,
    `\t\tdate: ${tsString(r.date)},\n`,
    headline,
    emitArray("added", r.added),
    emitArray("fixed", r.fixed),
    emitArray("changed", r.changed),
    emitArray("notes", r.notes),
    "\t},\n",
  ].join("");
}

const header = `// AUTO-GENERATED — DO NOT EDIT.
// Source: CHANGELOG.md  (regenerated by scripts/sync-release-notes.mjs on prebuild)
//
// To add or correct release notes, edit CHANGELOG.md and rebuild. Editing this
// file directly will be clobbered on the next build.

export interface ReleaseNote {
\tversion: string;
\tdate: string;
\theadline?: string;
\tadded?: string[];
\tfixed?: string[];
\tchanged?: string[];
\tnotes?: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
`;

const body = releases.map(emitRelease).join("");

const footer = `];

export function getLatestRelease(): ReleaseNote {
\treturn RELEASE_NOTES[0];
}

export function findReleaseByVersion(version: string): ReleaseNote | undefined {
\tconst normalized = version.trim().replace(/^v/, "");
\treturn RELEASE_NOTES.find((r) => r.version === normalized);
}

export function countItems(release: ReleaseNote): number {
\treturn (
\t\t(release.added?.length ?? 0) +
\t\t(release.fixed?.length ?? 0) +
\t\t(release.changed?.length ?? 0) +
\t\t(release.notes?.length ?? 0)
\t);
}
`;

writeFileSync(outPath, header + body + footer);
console.log(
  `[sync-release-notes] Wrote ${releases.length} releases (newest: v${releases[0].version}) → ${outPath.replace(root + "/", "")}`,
);
