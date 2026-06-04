# Design: SheetJS Community Edition (`XLSX`) binding in scratchpad cells

**Date:** 2026-06-03
**Targets release:** OTTO 1.3.0
**Status:** Approved — pending writing-plans
**Related:**
- Removal of `exceljs` in 1.2.6 (commit `d429152`)
- Roadmap entry: `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` § Out-of-scope → *"xlsx capability in scratchpad"*
- 1.2.6 CHANGELOG entry under `### Removed`

---

## 1. Problem statement

In 1.2.6 we removed `exceljs@4.4.0` from the scratchpad data-lib bindings to clear eight `npm warn deprecated` warnings on every install (`glob@7` CVE, `inflight` memory leak, `rimraf@2`, `fstream`, `lodash.isequal`, and stale `uuid` chains). The library is unmaintained upstream (last commit January 2024) and stable `4.4.0` is the only version we could pin to.

The cost of that removal: scratchpad cells lost the ability to read or write `.xlsx` workbooks. The North-Star NOC scenario (§ 4 of the co-worker spec) explicitly assumes the analyst can ingest a vendor spreadsheet, transform it via polars/DuckDB, and emit a polished xlsx report. Without an xlsx library, that flow breaks.

This spec covers restoring xlsx capability via **SheetJS Community Edition**, with a documented path to swap to SheetJS Pro later without any code change.

## 2. Goals and non-goals

**Goals:**
1. Restore xlsx read/write capability in scratchpad cells under a clearly-named binding.
2. Zero outbound network for the xlsx library at end-user install time — `npm i -g @cmetech/otto` remains the single, sufficient command, including in compliance/air-gapped environments.
3. Document the CE → Pro upgrade as a localised, no-code-change swap.
4. Match the level of test coverage that `exceljs` had pre-1.2.6 (binding presence + a smoke write-buffer cell) plus a vendor-tarball drift guard.
5. Restore the LLM-facing prompt strings that mention xlsx as a pre-bound capability.

**Non-goals:**
- Building a back-compat shim that exposes an `ExcelJS.Workbook` shape on top of SheetJS. The two APIs are fundamentally different; a shim would be its own maintenance burden. Cells from the pre-1.2.6 era already `ReferenceError` (since 1.2.6 dropped the binding entirely) and would continue to.
- Runtime CE/Pro tier switching (env var, side-by-side install, etc.). Per the YAGNI principle and the brainstorm decision, the upgrade path is a vendored-file swap — no code change.
- Persona-seed edits for `noc-ops` — that seed does not currently mention xlsx; no change needed.
- A post-publish smoke test that opens a real `.xlsx` file end-to-end. The unit smoke test (`XLSX.write` → buffer) covers the binding works; full I/O coverage is unnecessary at this layer.

## 3. Decisions made during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Install vector | **Vendor the SheetJS tarball into the repo at `vendor/xlsx-0.20.3.tgz`.** | Air-gap-safe (no `cdn.sheetjs.com` reach at install time). Reproducible. Repo grows ~2.4 MB per CE/Pro version bump — acceptable. |
| Cell-sandbox binding name | **`XLSX`** (SheetJS canonical). | Matches every SheetJS doc, example, and LLM training corpus. Copy-pasteable snippets work first try. |
| CE → Pro path | **Document-only, manual tarball swap.** | YAGNI. Both CE and Pro expose the same `XLSX` API surface; the only delta is the tarball file. A swap procedure in `vendor/README.md` is enough. |
| Scope | **Full functional replacement** of what `exceljs` covered: binding, sandbox key set, LLM prompt strings, restored tests + one new vendor-drift test, CHANGELOG, roadmap. | Per user direction during brainstorm: "wherever exceljs was, SheetJS goes." |
| Release version | **1.3.0** (minor bump). | Restores a previously-bound capability — feature-level, not patch. |

## 4. Architecture

### 4.1 Vendor layout

```
vendor/
├── README.md                              # CE→Pro swap procedure + integrity workflow
├── xlsx-0.20.3.tgz                        # SheetJS CE tarball (committed binary, ~2.4 MB)
└── xlsx-0.20.3.tgz.sha256                 # Recorded SHA-256 of the tarball above
```

Root `package.json`:
- `dependencies.xlsx` = `"file:vendor/xlsx-0.20.3.tgz"`.
- `"files"` array includes `"vendor"` so the tarball ships inside the published `@cmetech/otto-1.3.0.tgz`.

End-user install chain (`npm i -g @cmetech/otto`):
1. npm fetches `@cmetech/otto-1.3.0.tgz` from the registry.
2. npm extracts to `<global-prefix>/lib/node_modules/@cmetech/otto/` — including `vendor/xlsx-0.20.3.tgz`.
3. npm reads `dependencies.xlsx` = `file:vendor/xlsx-0.20.3.tgz`; resolves the path relative to the package root; finds the already-extracted tarball locally.
4. npm extracts the inner tarball to `node_modules/xlsx/`. No CDN reach.

### 4.2 Binding wiring

`packages/coworker-scratchpad/src/kernel-bindings.ts`:

```ts
import pl from 'nodejs-polars';
import XLSX from 'xlsx';                   // ← restored under SheetJS canonical name
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { SecretScanner, type AuditLog, type AuditRecord } from '@otto/coworker-utils';

// XLSX is SheetJS Community Edition (vendored — see vendor/README.md for Pro swap).
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

The post-1.2.6 multi-paragraph removal-rationale comment is replaced by the single line shown above. The full removal rationale already lives in the 1.2.6 CHANGELOG entry and the roadmap, so duplicating it in source is dead weight.

`packages/coworker-scratchpad/src/kernel-entry.ts:KNOWN_BOUND_KEYS` — insert `'XLSX'` between `'DuckDB'` and `'dateFns'`. This set drives namespace-snapshot filtering so user variables don't get mixed with binding names.

**Import style:** SheetJS publishes CJS (`main: xlsx.js`) with type declarations. Default import works under our existing `esModuleInterop: true`. This mirrors the import style already used in this package for `lodash`, `axios`, and previously `exceljs` (confirmed via the Phase 1d historical note, `docs/superpowers/plans/2026-05-31-coworker-phase-1d-data-libs-cell-archive.md:168`).

### 4.3 LLM prompt strings

`src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts`:

| Line | Current text (post-1.2.6) | New text |
|---|---|---|
| 93 (`description`) | `USE FOR: loading or analyzing files (CSV, JSON, Parquet), …` | `USE FOR: loading or analyzing files (CSV, JSON, Parquet, XLSX), …` |
| 98 (`description`) | `Pre-bound libs in every cell: polars, DuckDB, dateFns, lodash, zod, axios.` | `Pre-bound libs in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios.` |
| 102 (`promptSnippet`) | `USE for files (CSV/JSON/Parquet), polars/DuckDB analysis, …` | `USE for files (CSV/JSON/Parquet/XLSX), polars/DuckDB analysis, …` |
| 104 (`promptGuidelines[0]`) | `Trigger criteria: the request involves loading a file (CSV/JSON/Parquet/etc.), …` | `Trigger criteria: the request involves loading a file (CSV/JSON/Parquet/XLSX/etc.), …` |
| 112 (`promptGuidelines[?]`) | `Pre-bound libs available in every cell: polars, DuckDB, dateFns, lodash, zod, axios.` | `Pre-bound libs available in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios.` |

(Exact line numbers may shift by the time the plan executes; the `polars, DuckDB, …` substring is unique enough to find each occurrence.)

## 5. Tests

### 5.1 Restored: `packages/coworker-scratchpad/src/kernel-bindings.test.ts`

Two changes to existing tests:

```ts
// Test name: "exposes all seven pre-bound data libraries"  (was "six" in 1.2.6)
for (const key of ['polars', 'DuckDB', 'XLSX', 'dateFns', 'lodash', 'zod', 'axios']) {
  assert.ok(key in b, `missing binding: ${key}`);
  assert.notEqual(b[key], undefined, `binding is undefined: ${key}`);
}

// In "binds usable shapes", add one assertion:
assert.equal(typeof b.XLSX.utils.book_new, 'function');
```

### 5.2 Restored: `packages/coworker-scratchpad/src/child-process-runtime.test.ts`

The smoke-cell test loses its 1.2.6 name and regains a SheetJS-flavoured assertion:

```ts
it('polars / lodash / zod / date-fns / XLSX / axios / DuckDB are bound', async () => {
  rt = new ChildProcessRuntime({ workspace: ws, inactivityTimeoutMs: 20_000, cellTimeoutMs: 20_000 });
  await rt.start();
  // ... existing polars/lodash/zod/dateFns assertions stay ...
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

### 5.3 New: vendor-drift guard

`src/tests/vendor-xlsx.test.ts` (or co-located near other root tests — final location decided in plan phase):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM (`module: NodeNext`) — no __dirname; derive from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');           // adjust per actual location
const TARBALL = resolve(ROOT, 'vendor/xlsx-0.20.3.tgz');
const SHA = resolve(ROOT, 'vendor/xlsx-0.20.3.tgz.sha256');

test('vendor/xlsx-0.20.3.tgz exists', () => {
  assert.ok(existsSync(TARBALL), `missing: ${TARBALL}`);
});

test('vendor/xlsx-0.20.3.tgz SHA-256 matches recorded value', () => {
  const expected = readFileSync(SHA, 'utf-8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(TARBALL)).digest('hex');
  assert.equal(actual, expected);
});

test('package.json xlsx dep points at the vendored tarball', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.dependencies.xlsx, 'file:vendor/xlsx-0.20.3.tgz');
});
```

### 5.4 Existing `prepublishOnly` chain

`scripts/verify-vendored-xlsx.mjs` (new) runs as part of `prepublishOnly` and asserts the three things above **plus**:
- `npm pack --dry-run --json` output contains an entry for `vendor/xlsx-0.20.3.tgz`. If a future refactor accidentally drops `vendor/` from `"files"` (or `.npmignore` shadows it), this hard-fails the publish before reaching npm.

The existing `validate-pack` and post-publish `pack-install-resolve` smoke tests are the secondary safety net — both touch the install chain end-to-end.

## 6. CE → Pro upgrade procedure (documented in `vendor/README.md`)

When upgrading from CE to Pro:

1. Obtain the Pro tarball from SheetJS (purchase + tarball URL with embedded token).
2. Download it to `vendor/xlsxPro-X.Y.Z.tgz`. Record its SHA-256 to `vendor/xlsxPro-X.Y.Z.tgz.sha256`.
3. In root `package.json`:
   - `"dependencies"."xlsx"` → `"file:vendor/xlsxPro-X.Y.Z.tgz"`.
4. Update `scripts/verify-vendored-xlsx.mjs` to point at the new file + SHA.
5. Run `npm install --package-lock-only --ignore-scripts` to refresh the lockfile.
6. Optionally remove `vendor/xlsx-0.20.3.tgz` once you're confident in the swap.
7. Commit. Tag a release. Publish.

The `XLSX` binding name does not change. No edits to `kernel-bindings.ts`, `kernel-entry.ts`, prompts, tests (other than `verify-vendored-xlsx.mjs`'s targets), or the cell sandbox.

## 7. Release surface

### 7.1 CHANGELOG entry (1.3.0, `### Added`)

> **SheetJS Community Edition (`XLSX`) bound in scratchpad cells.** Restores the xlsx read/write capability dropped in 1.2.6 with the removal of `exceljs`. Vendored at `vendor/xlsx-0.20.3.tgz` (SHA-256 verified at prepublish) so no outbound CDN reach at install time — `npm i -g @cmetech/otto` remains the single command for compliance/air-gapped environments. CE → Pro upgrade path documented in `vendor/README.md` (drop a Pro tarball, swap the `file:` reference, regenerate the lockfile — no code change needed; `XLSX` binding stays).

### 7.2 Roadmap update

`docs/superpowers/notes/2026-06-01-coworker-roadmap.md`:
- Move the `### xlsx capability in scratchpad (replacement for dropped ExcelJS)` entry out of `## Out-of-scope reference` into a new sibling section `## Resolved out-of-scope items`.
- New entry (the execute-phase fills in the actual release date when 1.3.0 ships):
  > **xlsx capability in scratchpad** — Resolved on the 1.3.0 release date: SheetJS CE bound as `XLSX`, vendored at `vendor/xlsx-0.20.3.tgz`. Spec: `docs/superpowers/specs/2026-06-03-sheetjs-ce-binding-design.md`.

## 8. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| `vendor/` accidentally dropped from `"files"` in a future refactor → end-user install can't resolve `file:vendor/…` → cryptic install failure. | Medium (refactor risk) | `scripts/verify-vendored-xlsx.mjs` greps `npm pack --dry-run --json` for the tarball entry at `prepublishOnly`. Existing `pack-install-resolve` smoke test catches it post-publish. |
| Vendored tarball gets accidentally modified or corrupted on disk. | Low | `vendor/xlsx-0.20.3.tgz.sha256` + the SHA-check test. |
| SheetJS CDN goes down → can't refresh the vendored tarball. | Low and only at maintainer-refresh time, not end-user install time | The whole point of vendoring is that end users don't depend on CDN reachability. Maintainer can fall back to an archived copy or a Pro tarball. |
| `XLSX` name collides with something already in user cell scope. | Negligible | Cells don't pre-declare `XLSX`; the binding lives in `KNOWN_BOUND_KEYS` so namespace-snapshots filter it out cleanly. |
| Future SheetJS CE version (e.g. 0.21.x) ships a breaking API change. | Low (SheetJS API has been remarkably stable) | The vendor swap procedure is the same. If breaking, callers update cells; CHANGELOG documents. |
| Some old cell history (`cells.jsonl`) calls `new ExcelJS.Workbook()` → ReferenceError on re-run. | Low (already broken since 1.2.6) | Out of scope per § 2. Documented in 1.2.6 CHANGELOG. |

## 9. Open questions

None — all five brainstorm decisions are locked. Plan-phase will surface any tactical-level questions (e.g. exact location of the new vendor-drift test file, whether `scripts/verify-vendored-xlsx.mjs` should be ESM or CJS to match siblings).
