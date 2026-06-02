# Otto Co-worker Artifacts — Phase 4 Human Test Plan

**Status:** Phase 4 (otto-artifacts — workspace-scoped store for typed deliverables) is on branch `feat/coworker-phase-4-artifacts` as of 2026-06-02. This document walks every user-facing surface shipped in Phase 4 — markdown `report` artifacts created from scratchpad cells via `otto.artifact.create()`, persisted under `<workspace>/.otto/artifacts/<slug>/`, indexed in Layer B as `kind:'artifact'` drawers, and exposed through `/artifacts list|show|remove` plus the `list_artifacts` + `open_artifact` LLM tools — and lists the scenarios you need to run before merging the branch and tagging.

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`. **Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`.

> **Phase 4 activator wiring landed at first commit.** Unlike Phase 3, the production activator ships with the package (Phase 3.1 lesson applied). Scenarios that previously would have required script substitutes for `/artifacts` are now exercisable in the TUI directly — the live walkthrough remains the final manual gate (see `2026-06-02-phase-4-artifacts-smoke.md`).

**Not covered (Phase 4.5+ / Phase 5+ deferrals):**
- Workbook (xlsx) + dataset artifact kinds — spec §1 explicitly narrows v1 to markdown-only `report`; Phase 4.5+ pending NOC analyst pull.
- HTML / PDF rendering — parent design spec §1 excludes.
- Auto-`recordTurn` on cell-binding `create` / `update` from the manager activator — relies on `pendingPrompt` capture being passed through to `onArtifactCreate`; deferred to a small follow-up. Scenarios that expect a populated `provenance.json` call out the script-based equivalent through `store.recordTurn(...)`.
- Persona-bundled artifact templates (`artifact-templates/`, parent spec §2.3) — Phase 6.
- TUI artifact panel / preview UI — Phase 5+.
- Cross-workspace global artifacts (`~/.otto/artifacts/`) — v2.
- Vector embeddings / semantic recall on artifacts — out-of-scope per Phase 3 spec §9.

---

## Supported artifact kinds in Phase 4

Phase 4 ships **one kind**: `report` (markdown). The `ArtifactKind` type is a literal union — passing any other string throws `ArtifactKindRejected`.

| Kind | Supported in Phase 4 | What it would take to add |
|---|---|---|
| **`report` (markdown)** | ✅ Primary path. `report.md` is the `primary_file`. Additional `.md` siblings allowed via `update([{path, content}])`. | — |
| **`workbook` (xlsx)** | ❌ Throws `ArtifactKindRejected`. | Add `'workbook'` to `ARTIFACT_KINDS`, extend `ArtifactStore.create` to seed an empty `workbook.xlsx`, teach `renderReadme` about binary primaries, ship a writer dependency. Phase 4.5+. |
| **`dataset` (csv/parquet/json)** | ❌ Throws `ArtifactKindRejected`. | Add `'dataset'` plus a schema-checking write path; tighter security review for binary blobs. Phase 4.5+. |
| **HTML / PDF rendering** | ❌ Excluded by parent design spec §1. | Out of scope. |
| **Persona-bundled templates** | ❌ Not wired. | `applyArtifactTemplate` helper akin to `applyPersonaSeed`; first-activation copy of `artifact-templates/<kind>/*` from persona bundle. Phase 6. |

**Backend capability vs Phase 4 tooling — important distinction:**

- **`ArtifactStore` class:** atomic create/update/recordTurn/list/get/remove with `tmp+rename` writes, mode `0o700`/`0o600`, slug derivation + collision suffix (`slug`, `slug-2`, ..., `slug-101` then `ArtifactSlugCollision`), append-only provenance, README re-render on every metadata change.
- **`resolveArtifactUri(uri, workspaceDir)`:** pure validator + path builder. Rejects bad scheme, uppercase, path traversal, leading/trailing dash, >64 chars, empty slug.
- **Kernel bindings (`otto.artifact.create`, `spillIfLarge`):** RPC over NDJSON stdio to the parent process; the parent calls `getArtifactStore()` and routes through the activator's `onArtifactCreate` closure → memory `recordArtifact`.

**Practical recommendation for first real test:** create one artifact via a scratchpad cell, update it once, then list + show + remove. The integration test (`packages/coworker-artifacts/src/artifacts-integration.test.ts`) already proves the wiring at the API + disk layer; the human-test scenarios below confirm the same paths in the TUI.

---

## Setup

Before starting:

```bash
# Branch
git checkout feat/coworker-phase-4-artifacts

# Build everything (utils, vault, scratchpad, memory, artifacts)
cd packages/coworker-utils && npm run build && cd ../..
cd packages/coworker-vault && npm run build && cd ../..
cd packages/coworker-memory && npm run build && cd ../..
cd packages/coworker-artifacts && npm run build && cd ../..
cd packages/coworker-scratchpad && npm run build && cd ../..
npm run build

# Verify memory build copied migration 002 to dist/
ls packages/coworker-memory/dist/migrations/002-artifact-kind.sql

# Compile tests so script-substitute scenarios can run
npm run test:compile

# (Optional) Clear pre-existing state to start clean
rm -rf ~/.otto/memory/ ~/.otto/scratchpads/ ~/.otto/data_vault/ ~/.otto/audit.jsonl ~/.otto/audit.*.jsonl
# Also remove workspace state if any exists
rm -rf <workspace>/.otto/memory/ <workspace>/.otto/artifacts/
```

**Disk layout reference — peek here any time:**

```
<workspace>/.otto/
  artifacts/
    <slug>/                                       e.g. rca-load-balancer-503/
      report.md                                   primary_file (markdown)
      metadata.json                               { _schema:1, slug, kind, name, created_at, last_updated_at, turn_count, primary_file, uri }
      provenance.json                             append-only TurnEntry[] (created on artifact create as `[]`)
      README.md                                   deterministic render of metadata + provenance + file stats
      <any other writes via update([...]) >       additional .md siblings
  memory/                                         (Phase 3 layout)
    layer-b.db                                    artifact creations land here as kind:'artifact' drawers
    ...
```

**Programmatic API entry points** (for scenarios that need to bypass the deferred auto-`recordTurn` activator hop, or for non-TUI runs):

```typescript
import {
  ArtifactStore, resolveArtifactUri, deriveSlug, nextCollisionSlug,
} from '@otto/coworker-artifacts';
import { createArtifactsBundle } from 'src/resources/extensions/coworker-artifacts/artifacts-singleton.js';
import { runListArtifacts } from 'src/resources/extensions/coworker-artifacts/list-tool.js';
import { runOpenArtifact } from 'src/resources/extensions/coworker-artifacts/open-tool.js';
import { runArtifactsCommand } from 'src/resources/extensions/coworker-artifacts/artifacts-command.js';
```

---

## Scenario 1 — Artifact create + update + retrieve via `/artifacts show`

**Goal:** Creating a `report` artifact materializes the directory + metadata + empty primary + initial empty provenance + README; updating writes the primary file; `/artifacts show` prints the content back.

**Phase coverage:** Task 6 (`ArtifactStore.create` / `update`), Task 11 (artifacts extension scaffold + `/artifacts` slash dispatcher).

**Substitute verification (script):**

```typescript
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createArtifactsBundle } from 'src/resources/extensions/coworker-artifacts/artifacts-singleton.js';
import { runArtifactsCommand } from 'src/resources/extensions/coworker-artifacts/artifacts-command.js';

const workspaceDir = mkdtempSync(join(tmpdir(), 'art-s1-'));
const bundle = await createArtifactsBundle({ workspaceDir });

const h = await bundle.store.create('report', 'RCA: load balancer 503');
await bundle.store.update(h, [{ path: 'report.md', content: '# RCA\n\nSummary…\n' }]);

const out = await runArtifactsCommand(bundle.store, ['show', h.slug]);
console.assert(out.body.includes('# RCA'));
```

**Disk checks:**
```bash
cat <workspace>/.otto/artifacts/rca-load-balancer-503/metadata.json | jq
# { _schema:1, slug:"rca-load-balancer-503", kind:"report", primary_file:"report.md", uri:"artifact://rca-load-balancer-503", ... }
cat <workspace>/.otto/artifacts/rca-load-balancer-503/report.md
# # RCA
# Summary…
```

**Pass criteria:**
- Directory exists at mode `0o700`; files at mode `0o600`.
- `metadata.json._schema = 1`, `kind = 'report'`, `primary_file = 'report.md'`.
- `update` returned `files_touched = ['report.md']`.
- `/artifacts show <slug>` returns the body of `report.md` verbatim.

---

## Scenario 2 — URI resolution via `resolveArtifactUri`

**Goal:** The pure `resolveArtifactUri` validator accepts well-formed `artifact://` URIs and rejects malformed ones with a stable error taxonomy. Equivalent paths come back regardless of platform separators.

**Phase coverage:** Task 4 (`resolveArtifactUri` + `ArtifactUriMalformed`).

**Substitute verification (script):**

```typescript
import { resolveArtifactUri, ARTIFACT_URI_SCHEME } from '@otto/coworker-artifacts';

const ws = '/tmp/workspace';
const r = resolveArtifactUri('artifact://rca-1', ws);
console.assert(r.slug === 'rca-1');
console.assert(r.dir === '/tmp/workspace/.otto/artifacts/rca-1');
console.assert(r.primaryPath.endsWith('/report.md'));
console.assert(r.metadataPath.endsWith('/metadata.json'));
console.assert(r.provenancePath.endsWith('/provenance.json'));
console.assert(r.readmePath.endsWith('/README.md'));
console.assert(ARTIFACT_URI_SCHEME === 'artifact://');

// Each of these throws ArtifactUriMalformed:
['memory://x', 'artifact://RCA', 'artifact://../escape',
 'artifact://-foo', 'artifact://foo-', `artifact://${'a'.repeat(65)}`,
 'artifact://']
  .forEach(u => {
    try { resolveArtifactUri(u, ws); console.error('UNEXPECTED PASS:', u); }
    catch (e) { /* expected */ }
  });
```

**Pass criteria:**
- Happy path returns all six fields (`slug`, `dir`, `primaryPath`, `metadataPath`, `provenancePath`, `readmePath`).
- Every malformed URI throws `ArtifactUriMalformed` with `uri` + `reason`.
- `ARTIFACT_URI_SCHEME` exported as `'artifact://'`.

---

## Scenario 3 — Slug collision: same name → `slug` + `slug-2`

**Goal:** Two artifacts created with the same display name yield distinct slugs via the collision-suffix routine; `nextCollisionSlug` skips already-taken numeric suffixes; >100 collisions throw `ArtifactSlugCollision`.

**Phase coverage:** Task 2 (`deriveSlug` + `nextCollisionSlug`), Task 6 (`ArtifactStore.create` collision retry + EEXIST race recovery).

**Substitute verification (script):**

```typescript
const bundle = await createArtifactsBundle({ workspaceDir: mkdtempSync(join(tmpdir(), 'art-s3-')) });
const a = await bundle.store.create('report', 'RCA');
const b = await bundle.store.create('report', 'RCA');
const c = await bundle.store.create('report', 'RCA');
console.assert(a.slug === 'rca');
console.assert(b.slug === 'rca-2');
console.assert(c.slug === 'rca-3');
console.assert(a.uri === 'artifact://rca');
console.assert(b.uri === 'artifact://rca-2');
```

**Pass criteria:**
- First create gets the base slug.
- Subsequent creates pick the next free numeric suffix.
- After exhausting `MAX_COLLISION_ATTEMPTS` (100), `create` throws `ArtifactSlugCollision` with `base` + `attempts`.

---

## Scenario 4 — Provenance: create + update sequence → both entries

**Goal:** Calling `recordTurn` after `create` then again after `update` appends both entries to `provenance.json` (append-only, in order), bumps `turn_count`, and the README re-render reflects both rows.

**Phase coverage:** Task 5 (`renderReadme` provenance table), Task 6 (`ArtifactStore.recordTurn` append + metadata bump).

**Substitute verification (script — auto-`recordTurn` from cell binding is the deferred bit; calling `recordTurn` directly proves the surface):**

```typescript
const bundle = await createArtifactsBundle({ workspaceDir });
const h = await bundle.store.create('report', 'inc-209');
await bundle.store.recordTurn(h, {
  action: 'create', turn_id: 't1', user_prompt: 'draft the RCA', files_touched: [],
});
await bundle.store.update(h, [{ path: 'report.md', content: '# v2\n' }]);
await bundle.store.recordTurn(h, {
  action: 'update', turn_id: 't2', user_prompt: 'add timeline', files_touched: ['report.md'],
});

import { readFileSync } from 'node:fs';
const prov = JSON.parse(readFileSync(h.provenancePath, 'utf8'));
console.assert(prov.length === 2);
console.assert(prov[0].action === 'create' && prov[0].turn_id === 't1');
console.assert(prov[1].action === 'update' && prov[1].turn_id === 't2');

const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
console.assert(meta.turn_count === 2);

const readme = readFileSync(h.readmePath, 'utf8');
console.assert(/\| 1 \|.*create.*t1.*draft the RCA/.test(readme));
console.assert(/\| 2 \|.*update.*t2.*add timeline/.test(readme));
```

**Pass criteria:**
- `provenance.json` has both entries in order; each carries `_schema:1`, `ts`, `action`, `turn_id`, `user_prompt`, `files_touched`.
- `metadata.turn_count === 2`; `last_updated_at` matches the latest `recordTurn` `ts`.
- README provenance table has rows `1` (create) and `2` (update) with the user prompts.

---

## Scenario 5 — DirSnapshot: cell writes two new files → `files_touched` includes both

**Goal:** A single `update([...])` call writing two new files returns both in `files_touched`. `DirSnapshot` diff excludes `metadata.json` / `provenance.json` / `README.md` to avoid noise (these are bumped synchronously by the store itself).

**Phase coverage:** Task 3 (`takeSnapshot` + `diffSnapshots`), Task 6 (`update` uses snapshot diff).

**Substitute verification (script):**

```typescript
const bundle = await createArtifactsBundle({ workspaceDir });
const h = await bundle.store.create('report', 'multi-file');

const out = await bundle.store.update(h, [
  { path: 'report.md', content: '# top\n' },
  { path: 'appendix.md', content: '## A\n' },
]);
console.assert(out.files_touched.sort().join(',') === 'appendix.md,report.md');

// A second update bumps an existing file + adds another
await new Promise(r => setTimeout(r, 20));
const out2 = await bundle.store.update(h, [
  { path: 'report.md', content: '# top v2\n' },
  { path: 'timeline.md', content: '## T\n' },
]);
console.assert(out2.files_touched.sort().join(',') === 'report.md,timeline.md');
```

**Pass criteria:**
- First update returns both files as touched.
- Second update returns modified `report.md` + added `timeline.md`.
- Metadata/provenance/README are NOT included in `files_touched`.
- Path traversal (`../escape`, `/abs`) rejected by `update`.

---

## Scenario 6 — README re-render: write file → README updated

**Goal:** Every `update` and `recordTurn` triggers a deterministic README re-render including the new file stats and provenance rows. Identical inputs produce byte-identical output (deterministic across runs).

**Phase coverage:** Task 5 (`renderReadme` determinism + human-size formatting), Task 6 (re-render trigger on every write).

**Substitute verification (script):**

```typescript
const bundle = await createArtifactsBundle({ workspaceDir });
const h = await bundle.store.create('report', 'rerender');
import { readFileSync } from 'node:fs';

const before = readFileSync(h.readmePath, 'utf8');
console.assert(before.includes('(none)'));

await bundle.store.update(h, [{ path: 'report.md', content: 'x'.repeat(4200) }]);
const after = readFileSync(h.readmePath, 'utf8');
console.assert(/`report.md` — 4\.1 KB/.test(after));

// Deterministic — re-rendering with same inputs gives same bytes
const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8'));
const prov = JSON.parse(readFileSync(h.provenancePath, 'utf8'));
import { renderReadme } from '@otto/coworker-artifacts';
const a = renderReadme(meta, prov, [{ path: 'report.md', sizeBytes: 4200 }]);
const b = renderReadme(meta, prov, [{ path: 'report.md', sizeBytes: 4200 }]);
console.assert(a === b);
```

**Pass criteria:**
- Initial README contains `(none)` under Files.
- After update, README lists `report.md` with human-readable size.
- `renderReadme(meta, prov, stats)` is byte-identical for identical inputs.
- Metadata fields (`Kind`, `URI`, `Created`, `Last updated`, `Turns`) all appear.

---

## Scenario 7 — `/memory recall` finds `kind:'artifact'` drawer

**Goal:** Creating an artifact via the cell binding (or directly via `recordArtifact`) writes a memory drawer with `kind:'artifact'` whose `content` references the artifact URI; a recall query against the artifact name returns it.

**Phase coverage:** Task 8 (memory migration 002 adds `'artifact'` to `DRAWER_KINDS`; `recordArtifact` in `memory-recorder.ts`), Task 12 (scratchpad cross-import + `onArtifactCreate` → `getMemoryRecorder()?.recordArtifact(...)`).

**Substitute verification (script — uses memory recorder directly; the activator-driven `onArtifactCreate` hop is exercised by `artifacts-integration.test.ts`):**

```typescript
import { createMemoryBundle } from 'src/resources/extensions/coworker-memory/memory-singleton.js';
import { runRecall } from 'src/resources/extensions/coworker-memory/recall-tool.js';

const mem = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
const art = await createArtifactsBundle({ workspaceDir });
const h = await art.store.create('report', 'lb-503-incident');
await mem.recorder.recordArtifact({
  scratchpadName: 't7', slug: h.slug, kind: h.kind, uri: h.uri,
  turnId: 't7-create',
});

const r = await runRecall(mem, { query: 'lb-503-incident' });
console.assert(r.results.some(x => x.drawer.kind === 'artifact'));
console.assert(r.results.some(x => x.drawer.content.includes('artifact://lb-503-incident')));
```

**Pass criteria:**
- Recall returns at least one row with `kind = 'artifact'`.
- The matching drawer content references the artifact URI.
- Audit `write-drawer` record carries `kind: 'artifact'`.

---

## Scenario 8 — `/memory recall --kind artifact` filters correctly

**Goal:** The `kind` filter in `runRecall` narrows results to artifact drawers only. Mixing artifact + turn + paste drawers in the same workspace and querying with `--kind artifact` returns only the artifact rows.

**Phase coverage:** Task 8 (memory backend kind-filter still works with the new kind value).

**Substitute verification (script):**

```typescript
const mem = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
const art = await createArtifactsBundle({ workspaceDir });

// Plant a turn + paste + artifact, all containing the same distinctive token
await mem.recorder.recordTurn({ role: 'user', content: 'sentinel-marker', turnId: 't-t' });
await mem.recorder.recordTurn({
  role: 'user',
  content: '```\n' + 'sentinel-marker '.repeat(50) + '\n```',
  turnId: 't-p',
});
const h = await art.store.create('report', 'sentinel-marker-report');
await mem.recorder.recordArtifact({
  scratchpadName: 'sp', slug: h.slug, kind: h.kind, uri: h.uri, turnId: 't-a',
});

const allMatches = await runRecall(mem, { query: 'sentinel-marker' });
const onlyArtifacts = await runRecall(mem, { query: 'sentinel-marker', filters: { kind: 'artifact' } });

console.assert(allMatches.results.length >= 3);
console.assert(onlyArtifacts.results.every(r => r.drawer.kind === 'artifact'));
console.assert(onlyArtifacts.results.length >= 1);
```

**Pass criteria:**
- Unfiltered recall returns turn + paste + artifact rows.
- `filters.kind = 'artifact'` returns only artifact rows.
- The artifact row's content references the artifact URI.

---

## Scenario 9 — `spillIfLarge` above + below threshold

**Goal:** `otto.artifact.spillIfLarge(value, { thresholdBytes })` creates an artifact and returns a handle when `value`'s byte length is at or above the threshold; returns `null` (no side effects, no artifact dir created) when it's below.

**Phase coverage:** Task 9 (kernel-side `spillIfLarge` binding + RPC), Task 10 (scratchpad manager `onArtifactCreate` fan-out).

**Substitute verification (script, exercising the kernel binding via the integration test seam):**

```typescript
// In a scratchpad cell (real binary), or via the integration test harness:
// const big = 'x'.repeat(11000);
// const h = await otto.artifact.spillIfLarge(big, { thresholdBytes: 10240 });
// console.assert(h !== null);
// console.assert(h.uri.startsWith('artifact://'));

// const small = 'x'.repeat(1000);
// const none = await otto.artifact.spillIfLarge(small, { thresholdBytes: 10240 });
// console.assert(none === null);

// Disk:
// ls <workspace>/.otto/artifacts/   -> exactly one new artifact (from the big spill)
```

**Pass criteria:**
- `value.length >= thresholdBytes` → returns a handle with `uri` starting `artifact://`; new dir exists under `<workspace>/.otto/artifacts/`.
- `value.length < thresholdBytes` → returns `null`; no new dir.
- Default threshold (when `thresholdBytes` omitted) is 10 KB per spec §3.10.
- Each spilled artifact gets a unique slug (collision-suffix on identical names).

---

## Scenario 10 — `/artifacts remove --confirm` deletes; `--confirm` omission errors

**Goal:** `/artifacts remove <slug> --confirm` deletes the directory and any nested files. Without `--confirm`, the command errors and the directory is untouched. Removing a non-existent slug throws `ArtifactNotFound`.

**Phase coverage:** Task 6 (`ArtifactStore.remove`), Task 11 (`/artifacts` slash dispatcher confirm gating).

**Substitute verification (script):**

```typescript
import { existsSync } from 'node:fs';

const bundle = await createArtifactsBundle({ workspaceDir });
const h = await bundle.store.create('report', 'to-be-removed');

const dry = await runArtifactsCommand(bundle.store, ['remove', h.slug])
  .catch(err => err);
console.assert(/confirm/i.test(String(dry.message ?? dry)));
console.assert(existsSync(h.dir));  // still there

await runArtifactsCommand(bundle.store, ['remove', h.slug, '--confirm']);
console.assert(!existsSync(h.dir));

const missing = await runArtifactsCommand(bundle.store, ['remove', h.slug, '--confirm'])
  .catch(err => err);
console.assert(/ArtifactNotFound|not found/i.test(String(missing.message ?? missing)));
```

**Pass criteria:**
- Missing `--confirm` errors with a confirm-required message; dir untouched.
- With `--confirm`, dir is gone (recursive).
- Removing again throws `ArtifactNotFound`.

---

## Scenario 11 — Phase 1 + Phase 2 + Phase 3 + Phase 3.1 regression sweep

**Goal:** Phase 4 didn't break Phase 1's scratchpad surface, Phase 2's vault surface, Phase 3's memory surface, or Phase 3.1's activator wiring.

**Phase coverage:** Phase 1 + Phase 2 + Phase 3 + Phase 3.1 surfaces, not Phase 4 — but worth quick checks since Phase 4 touched `scratchpad-manager.ts` (Task 10 — added `getArtifactStore?` + `onArtifactCreate?` options), `memory-recorder.ts` (Task 8 — added `recordArtifact`), `local-sqlite-backend.ts` (Task 8 — migration 002), and the scratchpad extension's `index.ts` (Task 12 — cross-import + `onArtifactCreate` closure).

**Quick sweep — Phase 1 (scratchpad):**

- `/sp new s11-pre` → no `--use` flag → works exactly as before.
- `/sp tree`, `/sp view`, `/sp save`, `/sp detach`, `/sp reset` → unchanged.
- `currentScratchpadName` accessor returns the live name without mutating internal state.
- `/sp evict` and `/sp evict --force` → unchanged.

**Quick sweep — Phase 2 (vault):**

- `/connect jira prod` (or scripted `runConnect`) → still creates entry at chmod 600.
- `/sp new s11-bound --use jira:prod` → spawn-time env injection still works.
- `/datasource list`, `/datasource test`, `/datasource remove` → unchanged.
- `/audit --producer vault` → returns Phase 2 records; new artifact records appear under `--producer artifacts` only (and the memory drawer write appears under `--producer memory`).

**Quick sweep — Phase 3 + 3.1 (memory):**

- `/memory status` → still reports `scope_mode`, `workspace_wing`, `drawer_count`, `layer_b_db_path`, `schema_version: 1`.
- Verify migration 002 applied: `sqlite3 <workspace>/.otto/memory/layer-b.db "PRAGMA user_version"` returns `2`.
- `/memory recall` works on existing turn/paste/file_load drawers (no kind regression).
- `/memory note` still blocks AWS-key-shaped content; `lessons.md` unchanged byte-for-byte.
- `/memory clear --wing <wing> --confirm` still deletes drawers + Layer A markdown.
- Activator session-start injection still produces the `Memory (Layer A)` block.

**Pass criterion:** No regressions; run full test suite:

```bash
npm run test:compile
node --test dist-test/packages/coworker-scratchpad/src/*.test.js
node --test dist-test/packages/coworker-vault/src/*.test.js
node --test dist-test/packages/coworker-memory/src/*.test.js
node --test dist-test/packages/coworker-artifacts/src/*.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
node --test dist-test/src/resources/extensions/coworker-memory/*.test.js
node --test dist-test/src/resources/extensions/coworker-artifacts/*.test.js
```

All green.

---

## Phase 4 coverage matrix

| Scenario | Task(s) | Spec section | Pillar covered |
|---|---|---|---|
| 1 | 6, 11 | §3.1 store API, §7 activator surface | create + update + `/artifacts show` round-trip |
| 2 | 4 | §5.2 URI shape, §13 errors | `resolveArtifactUri` validation |
| 3 | 2, 6 | §6.1 slug derivation, §6.2 collision retry | collision suffix + ArtifactSlugCollision |
| 4 | 5, 6 | §3.5 provenance, §6.2 recordTurn | append-only provenance + README rerender |
| 5 | 3, 6 | §6.2 update + files_touched | DirSnapshot diff excludes meta/prov/readme |
| 6 | 5, 6 | §6.2 README rerender | deterministic markdown |
| 7 | 8, 12 | §3.7 artifact drawer kind, §10 cross-extension wiring | memory drawer `kind:'artifact'` |
| 8 | 8 | §3.7 kind filter | recall `--kind artifact` filter |
| 9 | 9, 10 | §3.10 spill threshold, §8 kernel binding | `spillIfLarge` above/below threshold |
| 10 | 6, 11 | §7 activator surface, §13 confirm gating | `/artifacts remove --confirm` |
| 11 | regression | — | Phase 1+2+3+3.1 surfaces intact |

**Spec section → task delivery map (full spec §1–§16):**

| Spec section | Implemented in |
|---|---|
| §1 scope (markdown report only) | Tasks 1, 6 (`ArtifactKind` literal `'report'`). |
| §2 decision matrix | Locked decisions appear in Tasks 1, 4, 6, 7, 9, 11. |
| §3.1 store API | Task 6 (`ArtifactStore`). |
| §3.5 provenance append-only | Tasks 5, 6. |
| §3.7 `'artifact'` drawer kind | Task 8 (memory migration 002 + `recordArtifact`). |
| §3.10 spill default 10 KB | Task 9 (kernel-entry `spillIfLarge`). |
| §4 activation order indifference | Task 11 (lazy getter pattern from Phase 3.1). |
| §5.1 types | Task 1 (`types.ts`). |
| §5.2 URI shape | Task 4 (`resolveArtifactUri`). |
| §5.3 migration 002 | Task 8 (`002-artifact-kind.sql`). |
| §6.1 slug derivation | Task 2 (`deriveSlug` + `nextCollisionSlug`). |
| §6.2 update + files_touched + README rerender | Tasks 3 (DirSnapshot) + 5 (renderReadme) + 6 (store). |
| §7 activator surface | Task 11 (extension scaffold + activator + tools + slash). |
| §8 kernel binding (otto.artifact) | Task 9 (kernel-protocol + kernel-entry RPC). |
| §9 errors | Task 1 (`errors.ts`). |
| §10 cross-extension wiring | Tasks 10 (manager fan-out) + 12 (scratchpad cross-import + `onArtifactCreate` closure). |
| §11 atomic writes + modes | Task 6 (`tmp+rename`, 0o700/0o600). |
| §12 milestone | Task 13 (integration) + Task 15 (smoke checklist live-run). |
| §13 confirm gating + error taxonomy | Tasks 1, 6, 11. |
| §14 edge cases (path traversal, FTS5 kind handling) | Tasks 4, 6, 8. |
| §15 testing strategy | Each module + Task 13 integration. |
| §16 deferrals | Spec §1 (workbook/dataset/templates). |

---

## Phase 4 sign-off checklist

Run before merging `feat/coworker-phase-4-artifacts`:

- [ ] **Scenario 1:** create + update + `/artifacts show` round-trip; metadata/provenance/README/primary all present
- [ ] **Scenario 2:** `resolveArtifactUri` accepts well-formed, rejects bad scheme + path traversal + leading/trailing dash + >64 chars + empty
- [ ] **Scenario 3:** slug collision yields `slug`, `slug-2`, `slug-3`; >100 collisions throws `ArtifactSlugCollision`
- [ ] **Scenario 4:** `recordTurn` after create + update appends both entries; `metadata.turn_count` matches; README provenance table renders both rows
- [ ] **Scenario 5:** two-file update returns both in `files_touched`; meta/prov/README excluded; path traversal rejected
- [ ] **Scenario 6:** README re-renders on every update with `(none)` → file row; `renderReadme` byte-identical for identical inputs
- [ ] **Scenario 7:** artifact creation writes a `kind:'artifact'` drawer referencing the URI; `/memory recall` finds it
- [ ] **Scenario 8:** `/memory recall --kind artifact` returns only artifact rows when mixed with turn + paste
- [ ] **Scenario 9:** `spillIfLarge` above threshold → handle with `artifact://` URI; below → `null`; new dir created only when spilled
- [ ] **Scenario 10:** `/artifacts remove --confirm` deletes; missing `--confirm` errors; second remove throws `ArtifactNotFound`
- [ ] **Scenario 11:** Phase 1 + Phase 2 + Phase 3 + Phase 3.1 surfaces unaffected; full test suite green

When all 11 boxes are checked, Phase 4 is verified end-to-end and ready for merge.

If any scenario fails, log the issue against the relevant Phase 4 task; if a scenario reveals a Phase 4.5+ follow-up beyond the already-tagged auto-`recordTurn` hop (e.g., need workbook kind, need persona artifact templates), capture it as a separate ticket so the merge isn't blocked.

**Live TUI walkthrough:** PENDING. Replace this line with: `Verified live on YYYY-MM-DD by <name> at commit <short-sha>.`

**Phase 4.5+ carry-over (already known, do not re-file):**
- Auto-`recordTurn` on cell-binding `create` / `update` from the manager activator (deferred follow-up; `pendingPrompt` capture wiring).
- Workbook (xlsx) + dataset artifact kinds.
- Persona-bundled artifact templates (`artifact-templates/`).
- TUI artifact panel / preview UI.
