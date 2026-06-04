#!/usr/bin/env node
// Project/App: OTTO
// File Purpose: Prepublish guard for the vendored SheetJS xlsx tarball.
//
// Asserts:
//   1. vendor/<tarball> exists and its SHA-256 matches vendor/<tarball>.sha256.
//   2. root package.json dependencies.xlsx === "file:vendor/<tarball>".
//   3. `npm pack --dry-run --json` lists vendor/<tarball> in the file set.
//
// (3) is the critical safety net: if a future refactor accidentally drops
// "vendor" from package.json "files", end-user installs would fail to resolve
// the file: dep. Catching it here hard-fails the publish before reaching npm.

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Single point of change for refresh / CE→Pro swap.
const TARBALL_BASENAME = 'xlsx-0.20.3.tgz';
const TARBALL = resolve(ROOT, 'vendor', TARBALL_BASENAME);
const SHA_FILE = resolve(ROOT, 'vendor', `${TARBALL_BASENAME}.sha256`);
const EXPECTED_DEP_SPEC = `file:vendor/${TARBALL_BASENAME}`;

function fail(msg) {
  console.error(`[verify-vendored-xlsx] FAIL: ${msg}`);
  process.exit(1);
}

// ── 1. Tarball + SHA ─────────────────────────────────────────────────
if (!existsSync(TARBALL)) fail(`missing tarball: ${TARBALL}`);
if (!existsSync(SHA_FILE)) fail(`missing SHA file: ${SHA_FILE}`);

const recordedSha = readFileSync(SHA_FILE, 'utf-8').trim().split(/\s+/)[0];
const actualSha = createHash('sha256').update(readFileSync(TARBALL)).digest('hex');
if (actualSha !== recordedSha) {
  fail(
    `SHA-256 mismatch for ${TARBALL_BASENAME}:\n` +
    `  recorded: ${recordedSha}\n` +
    `  actual:   ${actualSha}\n` +
    `If the tarball was intentionally refreshed, update ${SHA_FILE} and re-run.`,
  );
}

// ── 2. package.json dep-spec ─────────────────────────────────────────
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
const xlsxDep = pkg.dependencies?.xlsx;
if (xlsxDep !== EXPECTED_DEP_SPEC) {
  fail(
    `package.json dependencies.xlsx mismatch:\n` +
    `  expected: "${EXPECTED_DEP_SPEC}"\n` +
    `  found:    ${JSON.stringify(xlsxDep)}`,
  );
}

// ── 3. npm pack --dry-run includes the tarball ───────────────────────
// `npm pack --dry-run --json` returns an array; the first entry has a "files"
// list with { path, size, mode }. We assert one of them is vendor/<tarball>.
let packOutput;
try {
  packOutput = execSync('npm pack --dry-run --json', {
    cwd: ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm pack --json on a large package can easily exceed the default
    // 1 MB stdout buffer; raise to 64 MB to be safe.
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  fail(`npm pack --dry-run failed: ${err.message}`);
}

let packEntries;
try {
  packEntries = JSON.parse(packOutput);
} catch (err) {
  fail(`could not parse npm pack output as JSON: ${err.message}`);
}

const fileList = Array.isArray(packEntries) && packEntries[0]?.files;
if (!Array.isArray(fileList)) {
  fail('npm pack output did not contain a files[] array');
}

const expectedRelPath = `vendor/${TARBALL_BASENAME}`;
const present = fileList.some((f) => f.path === expectedRelPath);
if (!present) {
  fail(
    `${expectedRelPath} is not in the published file set.\n` +
    `Check root package.json "files" — it must include "vendor" (or an explicit pattern matching the tarball).`,
  );
}

console.log(`[verify-vendored-xlsx] OK — ${TARBALL_BASENAME} (${recordedSha.slice(0, 12)}…) vendored and packed.`);
