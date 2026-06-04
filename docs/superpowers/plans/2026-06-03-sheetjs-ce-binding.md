# SheetJS CE Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore xlsx capability in scratchpad cells by vendoring SheetJS Community Edition (`xlsx-0.20.3`) and binding it under the canonical `XLSX` name in the cell sandbox. End-user install remains a single `npm i -g @cmetech/otto` with no outbound CDN reach. Target release: OTTO 1.3.0.

**Architecture:** SheetJS CE ships as a tarball at `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. We download it once, commit it to `vendor/xlsx-0.20.3.tgz`, record its SHA-256 alongside, and reference it from root `package.json` as `"xlsx": "file:vendor/xlsx-0.20.3.tgz"`. The tarball ships inside the published `@cmetech/otto` package via the existing `"files"` allowlist, so the dep resolves entirely from the published tarball. A new `scripts/verify-vendored-xlsx.mjs` runs in `prepublishOnly` and guards against tampering (SHA mismatch) and accidental dropping from the published file list (`npm pack --dry-run` inclusion check). The cell sandbox binding is added to `kernel-bindings.ts` and `kernel-entry.ts:KNOWN_BOUND_KEYS`. The LLM-facing prompt strings that mention pre-bound libs are restored. CE → Pro upgrade is documented as a vendored-file swap — no code change.

**Tech Stack:** Node.js 22+, ESM (`module: NodeNext`), TypeScript 5.9, `node:test` + `node:assert/strict`, `node:crypto` (SHA-256), `xlsx@0.20.3` (SheetJS CE).

**Spec reference:** `docs/superpowers/specs/2026-06-03-sheetjs-ce-binding-design.md`. Five locked decisions: vendor tarball, `XLSX` binding name, doc-only CE→Pro path, full functional replacement scope, target release 1.3.0.

---

## File map

**New files:**
- `vendor/xlsx-0.20.3.tgz` — SheetJS CE binary (2.4 MB, committed as a vendored dependency)
- `vendor/xlsx-0.20.3.tgz.sha256` — recorded SHA-256 (one line: `<hex>  xlsx-0.20.3.tgz`)
- `vendor/README.md` — CE → Pro swap procedure + refresh workflow
- `scripts/verify-vendored-xlsx.mjs` — prepublish guard (SHA check + `npm pack` inclusion check + `package.json` dep-spec check)
- `src/tests/vendor-xlsx.test.ts` — same checks runnable as a unit test

**Modified files:**
- `package.json` — add `xlsx` dep, add `vendor` to `"files"`, add `verify:vendored-xlsx` script, wire into `prepublishOnly`
- `package-lock.json` — regenerated to reflect new dep
- `packages/coworker-scratchpad/src/kernel-bindings.ts` — import `XLSX from 'xlsx'`, add to bindings record, replace removal-rationale comment with one-liner
- `packages/coworker-scratchpad/src/kernel-entry.ts` — add `'XLSX'` to `KNOWN_BOUND_KEYS`
- `packages/coworker-scratchpad/src/kernel-bindings.test.ts` — restore `XLSX` to the bound-key set, add `XLSX.utils.book_new` shape check
- `packages/coworker-scratchpad/src/child-process-runtime.test.ts` — restore SheetJS-flavoured smoke cell
- `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts` — restore `XLSX` to 5 prompt-string locations
- `CHANGELOG.md` — new `[1.3.0]` entry under `### Added`
- `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` — move xlsx entry from `## Out-of-scope reference` to a new `## Resolved out-of-scope items` section
- (Release-machinery — all the platform package.json files sync via `bump-version.mjs` at Task 10)

---

### Task 1: Vendor the SheetJS CE tarball

**Files:**
- Create: `vendor/xlsx-0.20.3.tgz`
- Create: `vendor/xlsx-0.20.3.tgz.sha256`
- Create: `vendor/README.md`

- [ ] **Step 1: Create the vendor directory**

Run: `mkdir -p vendor`

- [ ] **Step 2: Download the SheetJS CE tarball**

Run: `curl -sL "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz" -o vendor/xlsx-0.20.3.tgz`

Expected: `vendor/xlsx-0.20.3.tgz` is 2.4 MB (~2,409,319 bytes).

Verify: `ls -la vendor/xlsx-0.20.3.tgz` should show `2409319` or similar size. If it's under ~1 MB, the download silently failed — re-run with `-v` to debug.

- [ ] **Step 3: Compute and record the SHA-256**

Run: `shasum -a 256 vendor/xlsx-0.20.3.tgz | awk '{print $1 "  xlsx-0.20.3.tgz"}' > vendor/xlsx-0.20.3.tgz.sha256`

Expected `vendor/xlsx-0.20.3.tgz.sha256` content:
```
8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8  xlsx-0.20.3.tgz
```

Verify:
```bash
cat vendor/xlsx-0.20.3.tgz.sha256
shasum -a 256 -c vendor/xlsx-0.20.3.tgz.sha256
```
Second command should print: `xlsx-0.20.3.tgz: OK`.

**If the SHA differs from the value above:** abort. SheetJS may have re-published the tarball. Verify the new SHA against an independent source (e.g. the SheetJS release announcement, prior known-good downloads) before recording.

- [ ] **Step 4: Write `vendor/README.md`**

Create `vendor/README.md`:

````markdown
# Vendored dependencies

This directory holds vendored npm package tarballs that are bundled inside the
published `@cmetech/otto` package. They are referenced from root `package.json`
via `"file:vendor/<name>.tgz"` deps. End users never reach the upstream CDN
during `npm i -g @cmetech/otto` — the tarball ships inside the OTTO tarball.

## Files

| File | Purpose |
|---|---|
| `xlsx-0.20.3.tgz` | SheetJS Community Edition 0.20.3 (binding name `XLSX` in scratchpad cells). Source: <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz>. |
| `xlsx-0.20.3.tgz.sha256` | Recorded SHA-256 of the file above. Verified at `prepublishOnly` and by `src/tests/vendor-xlsx.test.ts`. |
| `README.md` | This file. |

## Refresh procedure (new CE version)

1. Download the new tarball:
   ```bash
   curl -sL "https://cdn.sheetjs.com/xlsx-X.Y.Z/xlsx-X.Y.Z.tgz" -o vendor/xlsx-X.Y.Z.tgz
   ```
2. Compute and record the SHA-256:
   ```bash
   shasum -a 256 vendor/xlsx-X.Y.Z.tgz | awk '{print $1 "  xlsx-X.Y.Z.tgz"}' > vendor/xlsx-X.Y.Z.tgz.sha256
   ```
3. Update root `package.json`:
   - `dependencies.xlsx` → `"file:vendor/xlsx-X.Y.Z.tgz"`.
4. Update `scripts/verify-vendored-xlsx.mjs`: change the `TARBALL_BASENAME` constant to `xlsx-X.Y.Z.tgz`.
5. Update `src/tests/vendor-xlsx.test.ts`: change the `TARBALL_BASENAME` constant.
6. Regenerate the lockfile:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
7. Run the verification:
   ```bash
   npm run verify:vendored-xlsx
   ```
8. Remove the previous tarball + SHA file from `vendor/`.
9. Commit.

## CE → Pro upgrade procedure

SheetJS Pro is distributed as a separate tarball (`xlsxPro-X.Y.Z.tgz`) and
requires a license token at download time. The runtime API is identical to CE —
no code change is needed; only the vendored file and its references move.

1. Obtain the Pro tarball from SheetJS (purchase + tarball URL with embedded
   license token). Download to `vendor/xlsxPro-X.Y.Z.tgz`.
2. Compute and record the SHA-256:
   ```bash
   shasum -a 256 vendor/xlsxPro-X.Y.Z.tgz | awk '{print $1 "  xlsxPro-X.Y.Z.tgz"}' > vendor/xlsxPro-X.Y.Z.tgz.sha256
   ```
3. Update root `package.json`:
   - `dependencies.xlsx` → `"file:vendor/xlsxPro-X.Y.Z.tgz"`.
4. Update `scripts/verify-vendored-xlsx.mjs`: change `TARBALL_BASENAME` to
   `xlsxPro-X.Y.Z.tgz`.
5. Update `src/tests/vendor-xlsx.test.ts`: change `TARBALL_BASENAME`.
6. Regenerate the lockfile:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
7. Optionally remove `vendor/xlsx-*.tgz` (the previous CE tarball) once confident
   in the swap.
8. Commit. Tag a release. Publish.

The `XLSX` binding name does **not** change. No edits to `kernel-bindings.ts`,
`kernel-entry.ts`, the cell sandbox, prompts, or tests other than the basename
constants.
````

- [ ] **Step 5: Commit**

```bash
git add vendor/xlsx-0.20.3.tgz vendor/xlsx-0.20.3.tgz.sha256 vendor/README.md
git commit -m "feat(vendor): add SheetJS CE 0.20.3 tarball + SHA-256 + README"
```

---

### Task 2: Add vendor-drift guard test (TDD)

**Files:**
- Create: `src/tests/vendor-xlsx.test.ts`
- Modify: `package.json` (add `xlsx` dep + `vendor` to `"files"`)
- Modify: `package-lock.json` (regenerated)

- [ ] **Step 1: Write the failing test**

Create `src/tests/vendor-xlsx.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM (`module: NodeNext`) — derive __dirname from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const TARBALL_BASENAME = 'xlsx-0.20.3.tgz';
const TARBALL = resolve(ROOT, 'vendor', TARBALL_BASENAME);
const SHA_FILE = resolve(ROOT, 'vendor', `${TARBALL_BASENAME}.sha256`);
const EXPECTED_DEP_SPEC = `file:vendor/${TARBALL_BASENAME}`;

test('vendor/xlsx tarball exists', () => {
  assert.ok(existsSync(TARBALL), `missing: ${TARBALL}`);
});

test('vendor/xlsx tarball SHA-256 matches recorded value', () => {
  const recorded = readFileSync(SHA_FILE, 'utf-8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(TARBALL)).digest('hex');
  assert.equal(actual, recorded, 'tarball SHA does not match vendor/xlsx-0.20.3.tgz.sha256');
});

test('root package.json xlsx dep points at the vendored tarball', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  assert.equal(
    pkg.dependencies?.xlsx,
    EXPECTED_DEP_SPEC,
    `package.json dependencies.xlsx must equal "${EXPECTED_DEP_SPEC}"`,
  );
});

test('root package.json "files" includes vendor/', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const files: string[] = Array.isArray(pkg.files) ? pkg.files : [];
  assert.ok(
    files.includes('vendor') || files.includes('vendor/'),
    'package.json "files" array must include "vendor" so the tarball ships in the published package',
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test src/tests/vendor-xlsx.test.ts
```

Expected: tests 1 and 2 PASS (tarball + SHA exist from Task 1), but tests 3 and 4 FAIL — `package.json` doesn't yet declare `xlsx` and `vendor` isn't in `"files"`.

- [ ] **Step 3: Add `xlsx` to root package.json dependencies**

Open `package.json`. In the `"dependencies"` block, insert `xlsx` alphabetically (between `undici` and `yaml`):

```json
    "undici": "^7.24.2",
    "xlsx": "file:vendor/xlsx-0.20.3.tgz",
    "yaml": "^2.8.2",
```

- [ ] **Step 4: Add `vendor` to root package.json `"files"`**

In the `"files"` array in `package.json`, add `"vendor"` after `"pkg"`:

```json
  "files": [
    "dist",
    "packages",
    "pkg",
    "vendor",
    "src/resources",
    "scripts/postinstall.js",
    ...
```

- [ ] **Step 5: Regenerate the lockfile**

Run: `npm install --package-lock-only --ignore-scripts`

Expected: the command exits 0. `package-lock.json` gains a `node_modules/xlsx` resolved entry pointing at the file tarball.

Verify: `grep -A2 '"node_modules/xlsx"' package-lock.json | head -5` should show a block with `"resolved": "file:vendor/xlsx-0.20.3.tgz"` (or equivalent local-path notation).

- [ ] **Step 6: Re-run the test to verify it passes**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test src/tests/vendor-xlsx.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tests/vendor-xlsx.test.ts package.json package-lock.json
git commit -m "feat(deps): vendor xlsx@0.20.3 via file: spec; add drift guard test"
```

---

### Task 3: Add the prepublish verify script

**Files:**
- Create: `scripts/verify-vendored-xlsx.mjs`
- Modify: `package.json` (add `verify:vendored-xlsx` script + wire into `prepublishOnly`)

- [ ] **Step 1: Write `scripts/verify-vendored-xlsx.mjs`**

Create `scripts/verify-vendored-xlsx.mjs`:

```js
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
```

- [ ] **Step 2: Make the script executable**

Run: `chmod +x scripts/verify-vendored-xlsx.mjs`

- [ ] **Step 3: Add a `verify:vendored-xlsx` script to package.json**

In `package.json` `"scripts"`, add (alphabetically, between `verify:version-sync` and `verify:fast`, or any sensible adjacent spot):

```json
    "verify:vendored-xlsx": "node scripts/verify-vendored-xlsx.mjs",
```

- [ ] **Step 4: Wire `verify:vendored-xlsx` into `prepublishOnly`**

Find the existing `prepublishOnly` script in `package.json`:

```json
    "prepublishOnly": "npm run sync-pkg-version && npm run verify:version-sync && npm run verify:piconfig-sync && npm run branding:check && node scripts/prepublish-check.mjs && npm run build && npm run typecheck:extensions && npm run verify:native-platform-packages && npm run validate-pack",
```

Add `npm run verify:vendored-xlsx &&` immediately after `npm run verify:version-sync &&`:

```json
    "prepublishOnly": "npm run sync-pkg-version && npm run verify:version-sync && npm run verify:vendored-xlsx && npm run verify:piconfig-sync && npm run branding:check && node scripts/prepublish-check.mjs && npm run build && npm run typecheck:extensions && npm run verify:native-platform-packages && npm run validate-pack",
```

- [ ] **Step 5: Run the verify script locally**

Run: `npm run verify:vendored-xlsx`

Expected output:
```
[verify-vendored-xlsx] OK — xlsx-0.20.3.tgz (8dc73fc3b002…) vendored and packed.
```

If `npm pack --dry-run` is slow (it builds first), this may take 10–30 seconds. If the script fails on the `npm pack` step with a build error, the build is broken — fix it before continuing.

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-vendored-xlsx.mjs package.json
git commit -m "feat(prepublish): verify-vendored-xlsx — SHA + pack-inclusion guard"
```

---

### Task 4: Rebind `XLSX` in `kernel-bindings.ts` (TDD)

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.test.ts`
- Modify: `packages/coworker-scratchpad/src/kernel-bindings.ts`

- [ ] **Step 1: Update the binding-keys test to expect `XLSX`**

Open `packages/coworker-scratchpad/src/kernel-bindings.test.ts`. The current (post-1.2.6) test looks like:

```ts
  it('exposes all six pre-bound data libraries', () => {
    const b = buildDataLibBindings();
    for (const key of ['polars', 'DuckDB', 'dateFns', 'lodash', 'zod', 'axios']) {
      assert.ok(key in b, `missing binding: ${key}`);
      assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
    }
  });

  it('binds usable shapes (polars.DataFrame, zod.string, dateFns.format)', () => {
    const b = buildDataLibBindings() as Record<string, any>;
    assert.equal(typeof b.polars.DataFrame, 'function');
    assert.equal(typeof b.zod.string, 'function');
    assert.equal(typeof b.dateFns.format, 'function');
    assert.equal(typeof b.lodash.chunk, 'function');
    assert.equal(typeof b.axios.get, 'function');
  });
```

Change to:

```ts
  it('exposes all seven pre-bound data libraries', () => {
    const b = buildDataLibBindings();
    for (const key of ['polars', 'DuckDB', 'XLSX', 'dateFns', 'lodash', 'zod', 'axios']) {
      assert.ok(key in b, `missing binding: ${key}`);
      assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
    }
  });

  it('binds usable shapes (polars.DataFrame, zod.string, dateFns.format)', () => {
    const b = buildDataLibBindings() as Record<string, any>;
    assert.equal(typeof b.polars.DataFrame, 'function');
    assert.equal(typeof b.zod.string, 'function');
    assert.equal(typeof b.dateFns.format, 'function');
    assert.equal(typeof b.lodash.chunk, 'function');
    assert.equal(typeof b.axios.get, 'function');
    assert.equal(typeof b.XLSX.utils.book_new, 'function');
  });
```

Two diffs: `'six'` → `'seven'` in the test name, `'XLSX'` inserted between `'DuckDB'` and `'dateFns'` in the key list, and one new `XLSX.utils.book_new` assertion.

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-bindings.test.ts
```

Expected: the `exposes all seven pre-bound data libraries` test FAILs with `missing binding: XLSX`. The `binds usable shapes` test FAILs with `Cannot read properties of undefined (reading 'utils')`.

- [ ] **Step 3: Update `kernel-bindings.ts` to bind `XLSX`**

Open `packages/coworker-scratchpad/src/kernel-bindings.ts`. The current (post-1.2.6) state begins:

```ts
import pl from 'nodejs-polars';
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { SecretScanner, type AuditLog, type AuditRecord } from '@otto/coworker-utils';

/**
 * The data libraries pre-bound into every scratchpad cell's vm sandbox.
 * DuckDB is bound as an in-memory-capable lib here; on-disk kernel.db wiring is 1d2.
 *
 * Note: ExcelJS was removed in 1.2.6 — its transitive deps (glob@7, inflight,
 * rimraf@2, fstream, lodash.isequal) are deprecated with known vulnerabilities
 * and exceljs is no longer maintained upstream. xlsx-populate is the candidate
 * replacement; tracked in docs/superpowers/notes/2026-06-01-coworker-roadmap.md.
 */
export function buildDataLibBindings(): Record<string, unknown> {
  return {
    polars: pl,
    DuckDB,
    dateFns,
    lodash,
    zod: z,
    axios,
  };
}
```

Change to:

```ts
import pl from 'nodejs-polars';
import XLSX from 'xlsx';
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { SecretScanner, type AuditLog, type AuditRecord } from '@otto/coworker-utils';

/**
 * The data libraries pre-bound into every scratchpad cell's vm sandbox.
 * DuckDB is bound as an in-memory-capable lib here; on-disk kernel.db wiring is 1d2.
 *
 * XLSX is SheetJS Community Edition (vendored — see vendor/README.md for the
 * CE → Pro swap procedure).
 */
export function buildDataLibBindings(): Record<string, unknown> {
  return {
    polars: pl,
    DuckDB,
    XLSX,
    dateFns,
    lodash,
    zod: z,
    axios,
  };
}
```

Three diffs: add `import XLSX from 'xlsx';` on line 2; replace the multi-line 1.2.6 removal-rationale comment with the two-line `XLSX is SheetJS CE…` note; insert `XLSX,` between `DuckDB,` and `dateFns,` in the returned record.

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test packages/coworker-scratchpad/src/kernel-bindings.test.ts
```

Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-bindings.ts \
        packages/coworker-scratchpad/src/kernel-bindings.test.ts
git commit -m "feat(coworker-scratchpad): bind XLSX (SheetJS CE) in cell sandbox"
```

---

### Task 5: Add `XLSX` to `KNOWN_BOUND_KEYS`

**Files:**
- Modify: `packages/coworker-scratchpad/src/kernel-entry.ts`

This set drives namespace-snapshot filtering — without `XLSX` in it, cell-state snapshots would treat the binding as a user-defined variable and could mis-handle it.

- [ ] **Step 1: Add `'XLSX'` to the `KNOWN_BOUND_KEYS` set**

Open `packages/coworker-scratchpad/src/kernel-entry.ts`. Find the `KNOWN_BOUND_KEYS` declaration (around line 35–53). The current entries include:

```ts
  'polars',
  'DuckDB',
  'dateFns',
```

Insert `'XLSX',` between `'DuckDB',` and `'dateFns',`:

```ts
  'polars',
  'DuckDB',
  'XLSX',
  'dateFns',
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-scratchpad/src/kernel-entry.ts
git commit -m "feat(coworker-scratchpad): add XLSX to kernel KNOWN_BOUND_KEYS"
```

---

### Task 6: Restore the SheetJS smoke-cell test

**Files:**
- Modify: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

- [ ] **Step 1: Restore the SheetJS-flavoured assertion**

Open `packages/coworker-scratchpad/src/child-process-runtime.test.ts`. The current (post-1.2.6) test looks like:

```ts
  it('polars / lodash / zod / date-fns / axios / DuckDB are bound', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
    await rt.start();
    assert.equal((await rt.runCell('return polars.DataFrame({ a: [1, 2, 3] }).height;')).value, 3);
    assert.equal((await rt.runCell('return lodash.chunk([1, 2, 3, 4], 2).length;')).value, 2);
    assert.equal((await rt.runCell('return zod.string().parse("hi");')).value, 'hi');
    assert.equal((await rt.runCell('return dateFns.format(new Date(1970, 0, 1), "yyyy");')).value, '1970');
    assert.equal((await rt.runCell('return typeof axios.get;')).value, 'function');
    assert.equal((await rt.runCell('return typeof DuckDB.DuckDBInstance;')).value, 'function');
  });
```

Change the test name and insert one new assertion between `dateFns` and `axios`:

```ts
  it('polars / lodash / zod / date-fns / XLSX / axios / DuckDB are bound', async () => {
    rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
    await rt.start();
    assert.equal((await rt.runCell('return polars.DataFrame({ a: [1, 2, 3] }).height;')).value, 3);
    assert.equal((await rt.runCell('return lodash.chunk([1, 2, 3, 4], 2).length;')).value, 2);
    assert.equal((await rt.runCell('return zod.string().parse("hi");')).value, 'hi');
    assert.equal((await rt.runCell('return dateFns.format(new Date(1970, 0, 1), "yyyy");')).value, '1970');
    assert.equal((await rt.runCell(
      'const wb = XLSX.utils.book_new();' +
      'const ws = XLSX.utils.aoa_to_sheet([[1,2,3]]);' +
      'XLSX.utils.book_append_sheet(wb, ws, "s");' +
      'const buf = XLSX.write(wb, {type:"buffer", bookType:"xlsx"});' +
      'return buf.byteLength > 0;'
    )).value, true);
    assert.equal((await rt.runCell('return typeof axios.get;')).value, 'function');
    assert.equal((await rt.runCell('return typeof DuckDB.DuckDBInstance;')).value, 'function');
  });
```

Two diffs: test-name string adds `XLSX /`; one new `await rt.runCell(...)` assertion that builds a workbook and writes it to a buffer.

- [ ] **Step 2: Run the test**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test packages/coworker-scratchpad/src/child-process-runtime.test.ts
```

Expected: the smoke-cell test PASSes. (Task 4 wired the binding; Task 5 added it to KNOWN_BOUND_KEYS; this test exercises it through the child-process kernel.)

If it FAILs with `ReferenceError: XLSX is not defined` inside the cell, the child-process kernel didn't receive the new binding — check that Task 4's `kernel-bindings.ts` edits saved and rebuild deps if needed.

- [ ] **Step 3: Commit**

```bash
git add packages/coworker-scratchpad/src/child-process-runtime.test.ts
git commit -m "test(coworker-scratchpad): smoke-test XLSX.utils + write in a live cell"
```

---

### Task 7: Restore LLM prompt strings in `scratchpad-tool.ts`

**Files:**
- Modify: `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`

Open `src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`. Apply five string edits. Line numbers below were accurate at the time of writing (post-1.2.6); use the unique substrings to find each occurrence.

- [ ] **Step 1: Update the tool `description` (file-extensions hint)**

Find:
```ts
      'USE FOR: loading or analyzing files (CSV, JSON, Parquet), tabular data manipulation with polars or DuckDB, multi-step data exploration where state should persist across turns, or anything that calls otto.collectors. ' +
```

Replace `(CSV, JSON, Parquet)` with `(CSV, JSON, Parquet, XLSX)`:
```ts
      'USE FOR: loading or analyzing files (CSV, JSON, Parquet, XLSX), tabular data manipulation with polars or DuckDB, multi-step data exploration where state should persist across turns, or anything that calls otto.collectors. ' +
```

- [ ] **Step 2: Update the tool `description` (pre-bound libs)**

Find:
```ts
      'Pre-bound libs in every cell: polars, DuckDB, dateFns, lodash, zod, axios. otto.collectors.{list,open} enumerates and loads data sources. ' +
```

Insert `XLSX, ` between `DuckDB, ` and `dateFns`:
```ts
      'Pre-bound libs in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios. otto.collectors.{list,open} enumerates and loads data sources. ' +
```

- [ ] **Step 3: Update the `promptSnippet`**

Find:
```ts
      'cw_scratchpad — run TypeScript cells in a persistent JS kernel. USE for files (CSV/JSON/Parquet), polars/DuckDB analysis, otto.collectors, or multi-step data work. NOT for arithmetic or pure prose. If unsure, ASK the user first.',
```

Replace `(CSV/JSON/Parquet)` with `(CSV/JSON/Parquet/XLSX)`:
```ts
      'cw_scratchpad — run TypeScript cells in a persistent JS kernel. USE for files (CSV/JSON/Parquet/XLSX), polars/DuckDB analysis, otto.collectors, or multi-step data work. NOT for arithmetic or pure prose. If unsure, ASK the user first.',
```

- [ ] **Step 4: Update the `promptGuidelines` trigger-criteria line**

Find:
```ts
      'Trigger criteria: the request involves loading a file (CSV/JSON/Parquet/etc.), querying tabular data via polars or DuckDB, calling otto.collectors, or building state that must survive across turns.',
```

Insert `XLSX/` between `Parquet/` and `etc.`:
```ts
      'Trigger criteria: the request involves loading a file (CSV/JSON/Parquet/XLSX/etc.), querying tabular data via polars or DuckDB, calling otto.collectors, or building state that must survive across turns.',
```

- [ ] **Step 5: Update the `promptGuidelines` pre-bound-libs line**

Find:
```ts
      'Pre-bound libs available in every cell: polars, DuckDB, dateFns, lodash, zod, axios. No imports needed.',
```

Insert `XLSX, ` between `DuckDB, ` and `dateFns`:
```ts
      'Pre-bound libs available in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios. No imports needed.',
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts
git commit -m "feat(prompts): re-add XLSX to cw_scratchpad pre-bound-libs prompt"
```

---

### Task 8: CHANGELOG entry for 1.3.0

**Files:**
- Modify: `CHANGELOG.md`
- (Indirect) `src/resources/extensions/otto/commands/release-notes/_data.ts` regenerated by `sync-release-notes`

- [ ] **Step 1: Add the 1.3.0 entry**

Open `CHANGELOG.md`. Below `## [Unreleased]` (line 25) and above `## [1.2.6] - 2026-06-03` (around line 27), insert:

```markdown
## [1.3.0] - YYYY-MM-DD

_Restores xlsx capability in scratchpad cells via SheetJS Community Edition, replacing the 1.2.6 removal of `exceljs`. Vendored install means `npm i -g @cmetech/otto` remains a single command with no outbound CDN reach._

### Added

- **SheetJS Community Edition (`XLSX`) bound in scratchpad cells.** Restores the xlsx read/write capability dropped in 1.2.6 with the removal of `exceljs`. The SheetJS CE tarball is vendored at `vendor/xlsx-0.20.3.tgz` (SHA-256 verified at prepublish by `scripts/verify-vendored-xlsx.mjs` and at unit-test time by `src/tests/vendor-xlsx.test.ts`), so there is no outbound CDN reach at install time — `npm i -g @cmetech/otto` remains the single command for compliance/air-gapped environments. Cells now write `const wb = XLSX.utils.book_new(); …` (SheetJS canonical API; ExcelJS-style `new Workbook()` calls from pre-1.2.6 cells continue to ReferenceError). CE → Pro upgrade path is documented in `vendor/README.md`: drop a Pro tarball, swap the `file:` reference, regenerate the lockfile — no code change required; the `XLSX` binding name stays.
```

Replace `YYYY-MM-DD` with the actual release date when ready to ship. Until then `YYYY-MM-DD` is acceptable in the unreleased state — `sync-release-notes.mjs` reads the entry but does not require a real date for the build to pass.

- [ ] **Step 2: Regenerate release-notes runtime data**

Run: `node scripts/sync-release-notes.mjs`

Expected output: `[sync-release-notes] Wrote 16 releases (newest: v1.3.0) → src/resources/extensions/otto/commands/release-notes/_data.ts`

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md src/resources/extensions/otto/commands/release-notes/_data.ts
git commit -m "docs(changelog): 1.3.0 — restore xlsx capability via SheetJS CE"
```

---

### Task 9: Roadmap update

**Files:**
- Modify: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`

- [ ] **Step 1: Move the xlsx entry out of `## Out-of-scope reference`**

Open `docs/superpowers/notes/2026-06-01-coworker-roadmap.md`. Find the `### xlsx capability in scratchpad (replacement for dropped ExcelJS)` block under `## Out-of-scope reference` (added in 1.2.6).

Delete the entire `### xlsx capability in scratchpad (replacement for dropped ExcelJS)` heading and the four paragraphs that follow it (everything down to but not including the next `### Vector embeddings…` heading).

- [ ] **Step 2: Add a new `## Resolved out-of-scope items` section**

Immediately before the existing `## Out-of-scope reference (§ 9)` heading, insert:

```markdown
## Resolved out-of-scope items

These entries were previously listed under § Out-of-scope but have since been promoted into a real release.

### xlsx capability in scratchpad

**Status:** Resolved on the 1.3.0 release date.

**Shipped:** SheetJS Community Edition bound as `XLSX` in the scratchpad cell sandbox. Vendored at `vendor/xlsx-0.20.3.tgz` so end-user installs do not reach `cdn.sheetjs.com`. CE → Pro upgrade path documented in `vendor/README.md`.

**Spec:** `docs/superpowers/specs/2026-06-03-sheetjs-ce-binding-design.md`
**Plan:** `docs/superpowers/plans/2026-06-03-sheetjs-ce-binding.md`

---

```

- [ ] **Step 3: Update the "Last updated" line at the top**

Find the line near the top of the file:
```markdown
**Last updated:** 2026-06-02 (Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 3.1 + Phase 4 + Phase 4.5 complete).
```

Append "+ xlsx-restoration via SheetJS CE":
```markdown
**Last updated:** 2026-06-02 (Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 3.1 + Phase 4 + Phase 4.5 complete) + 1.3.0 xlsx-restoration via SheetJS CE.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/notes/2026-06-01-coworker-roadmap.md
git commit -m "docs(roadmap): move xlsx-restoration to resolved out-of-scope"
```

---

### Task 10: Full verification + version bump

**Files:**
- Modify: `package.json`, `package-lock.json`, all platform `package.json` files (via `bump-version.mjs`)

- [ ] **Step 1: Typecheck the full project**

Run: `npx tsc --noEmit`

Expected: exit 0.

- [ ] **Step 2: Run all directly-affected unit tests**

Run:
```bash
node --import ./src/resources/extensions/workflow/tests/resolve-ts.mjs \
  --experimental-strip-types --test \
  src/tests/vendor-xlsx.test.ts \
  packages/coworker-scratchpad/src/kernel-bindings.test.ts \
  packages/coworker-scratchpad/src/child-process-runtime.test.ts
```

Expected: all tests PASS. No failures.

- [ ] **Step 3: Run the prepublish vendor-xlsx verifier**

Run: `npm run verify:vendored-xlsx`

Expected output:
```
[verify-vendored-xlsx] OK — xlsx-0.20.3.tgz (8dc73fc3b002…) vendored and packed.
```

If the `npm pack --dry-run` step inside the script reports the tarball as missing, the `"vendor"` entry in `package.json` `"files"` is not catching it — re-check Task 2 Step 4.

- [ ] **Step 4: Bump version to 1.3.0**

Run: `node scripts/bump-version.mjs 1.3.0`

Expected:
```
[bump-version] package.json: 1.2.6 → 1.3.0
[bump-version] release version surfaces synced to 1.3.0
[bump-version] package-lock.json regenerated at 1.3.0
```

This script also updates: all `packages/*/package.json`, `pkg/package.json`, `extensions/google-search/package.json`, `native/Cargo.toml`, the five `native/npm/<platform>/package.json` files, and the lockfile.

- [ ] **Step 5: Verify version sync**

Run: `node scripts/verify-version-sync.cjs`

Expected output: `Version sync check passed.`

- [ ] **Step 6: Update the CHANGELOG date**

Open `CHANGELOG.md`. Replace `## [1.3.0] - YYYY-MM-DD` with the actual release date (today, ISO format: `## [1.3.0] - 2026-MM-DD`).

Re-sync release-notes runtime data: `node scripts/sync-release-notes.mjs`

- [ ] **Step 7: Commit the release bump**

```bash
git add -A
git commit -m "release: 1.3.0 — restore xlsx capability via SheetJS CE

Restores the xlsx read/write surface dropped in 1.2.6 (when exceljs
was removed for being unmaintained + carrying deprecated transitive
deps). SheetJS CE 0.20.3 is vendored at vendor/xlsx-0.20.3.tgz with
SHA-256 verification at both prepublish and unit-test time. End-user
install remains a single \`npm i -g @cmetech/otto\` — no CDN reach.

CE → Pro upgrade path: swap the vendored tarball + the file: dep
spec. No code change. Documented in vendor/README.md.
"
```

- [ ] **Step 8: Hand off to the standard publish flow**

The maintainer (per the established OTTO release flow) now runs:

```bash
git push origin main
git tag v1.3.0
git push origin v1.3.0
```

The tag push triggers `build-native.yml` (cross-platform matrix), which on success triggers `npm-publish.yml` (OIDC trusted publish). After Build Native finishes, refresh the lockfile so CI's `npm ci` resolves the freshly-published `@cmetech/otto-engine-*@1.3.0` platform packages — same recipe as commits `88f4315` (1.2.4), `e1d941e` (1.2.5), `40c9435` (1.2.6):

```bash
npm install --package-lock-only --ignore-scripts
git add package-lock.json
git commit -m "fix(ci): refresh package-lock.json with 1.3.0 platform pins"
git push origin main
```

Done. `npm i -g @cmetech/otto@1.3.0` will resolve the published tarball with `vendor/xlsx-0.20.3.tgz` inside it.

---

## Self-review (executed at plan-write time)

**Spec coverage:**
- § 4.1 vendor layout → Task 1 ✓
- § 4.2 binding wiring (kernel-bindings.ts) → Task 4 ✓
- § 4.2 KNOWN_BOUND_KEYS → Task 5 ✓
- § 4.3 LLM prompt strings (5 sites) → Task 7 ✓
- § 5.1 restored kernel-bindings.test.ts → Task 4 ✓
- § 5.2 restored child-process-runtime.test.ts → Task 6 ✓
- § 5.3 new vendor-drift guard test → Task 2 ✓
- § 5.4 prepublish chain wiring → Task 3 ✓
- § 6 vendor/README.md CE→Pro procedure → Task 1 Step 4 ✓
- § 7.1 CHANGELOG 1.3.0 entry → Task 8 ✓
- § 7.2 roadmap promotion to Resolved → Task 9 ✓
- Release machinery (version bump, sync, publish handoff) → Task 10 ✓

No gaps.

**Placeholder scan:** No `TBD`, `TODO`, `FIXME`, or "implement later" markers. The `YYYY-MM-DD` placeholder in Task 8 is explicit and addressed in Task 10 Step 6.

**Type consistency:**
- `XLSX` binding name is identical across all tasks (kernel-bindings.ts, kernel-entry.ts, tests, prompts).
- `TARBALL_BASENAME` constant has the same value (`xlsx-0.20.3.tgz`) in `scripts/verify-vendored-xlsx.mjs` and `src/tests/vendor-xlsx.test.ts`.
- `EXPECTED_DEP_SPEC` matches the value written to `package.json` (`file:vendor/xlsx-0.20.3.tgz`).

No issues.
