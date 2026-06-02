# Otto Co-worker Memory — Phase 3 Human Test Plan

**Status:** Phase 3 (otto-memory A+B + backend interface) is on branch `feat/coworker-phase-3-memory` as of 2026-06-02. This document walks every user-facing feature shipped in Phase 3 — verbatim recall via Layer A (markdown notes) + Layer B (drawer-shaped FTS5 SQLite) with SecretScanner gates — and lists the scenarios you need to run before merging the branch and tagging.

**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`. **Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3-memory.md`.

**Not covered (Phase 3.1+ deferrals):**
- Live `/memory` slash commands, `cw_memorize` / `cw_recall` LLM tool registration, and auto-retain on user turns through Otto's session controller (Task 20). The recorder, slash-command handlers, and LLM tool implementations are complete and unit-tested at the API level (Tasks 8, 14, 15, 16); scenarios that require typing the slash form or invoking the tool in the TUI assume the production extension activator hop has shipped. Where it hasn't, scenarios call out the script-based equivalent. **Same gap as Phase 2 vault — the `coworker-memory` extension lacks a production activator.** The seam exists at `pi-coding-agent`'s `before_agent_start` + `agent_start` events.
- scratchpad `file_load` drawer wiring (Task 19) — the API path is complete and unit-tested at the scratchpad level (`scratchpad-manager.ts`), but the cross-extension call from scratchpad to memory hops through the same activator. Scenarios exercising the file_load path call out the script-based equivalent.
- Layer C entity graph, `entity_query`, `entity_assert` — Phase 5.
- ACC / Cerebellum / Consolidator / weekly digest — Phase 5.
- Vector embeddings / semantic recall — out-of-scope per spec §9.
- `HostedBackend` (cloud-backed Layer B) — Phase 5; `MemoryBackend` interface is forward-compat.
- `/memory wing <name>` / `/memory room <name>` runtime overrides (session-state holder not wired) — captured as Phase 3.1 follow-up.

---

## Recall backend supported in Phase 3

This is the question worth answering up front: **what does Layer B's recall path do today, and what does it not yet cover?**

Phase 3 ships **one backend**: `LocalSqliteBackend` (FTS5 BM25, on-disk SQLite per workspace, WAL journaling). The `MemoryBackend` interface is auth-agnostic and stores any `Drawer` payload; the recall scoring is enforced by the **backend implementation**, not by the recorder or the tool layer.

| Recall mode | Supported by `LocalSqliteBackend` | What it would take to add |
|---|---|---|
| **Exact-match keyword (FTS5 BM25)** | ✅ Primary path. Substring + token matches with BM25 ranking. | — |
| **Phrase / quoted match (FTS5 phrase ops)** | ✅ FTS5 parser handles `"foo bar"` phrase queries. | — |
| **Filter by `kind` (turn/paste/note/file_load)** | ✅ SQL `WHERE kind = ?`. | — |
| **Filter by `room` / `wing`** | ✅ SQL `WHERE room = ? AND wing = ?`. | — |
| **Semantic / vector recall** — "find notes about throughput when the literal word never appears" | ❌ Not supported. `MemoryBackend.recall` returns FTS-only matches. | A second backend implementing the same interface backed by LanceDB or sqlite-vss; or a hybrid layer that blends BM25 + cosine. Phase 5+. |
| **Cross-workspace global Layer B** — recall something written in workspace A while sitting in workspace B | ❌ Not supported. Each workspace has its own `layer-b.db`. | A global `~/.otto/memory/layer-b.db` plus scope-mode routing logic; partially wired (`scope-resolver.ts` already knows about global mode for Layer A). v2. |
| **Hosted / cloud-backed recall** | ❌ | `HostedBackend` implementation of `MemoryBackend` interface; auth + transport; Phase 5+. |

**Backend capability vs Phase 3 tooling — important distinction:**

- **`MemoryBackend` interface (Task 2):** generic; any implementation that satisfies `recordDrawer` / `recall` / `clear` / `onSessionShutdown` works.
- **Recall scoring shipped:** FTS5 BM25 with `<mark>` snippet truncation in `recall-formatter.ts`.
- **What `LocalSqliteBackend` indexes:** drawer `content` (FTS5 column), with `kind` / `room` / `wing` as filterable columns.

**Practical recommendation for first real recall test:** paste a multi-line message with distinctive vocabulary (≥ 500 chars or triple-backtick code block), then recall on a distinctive word from that paste. Anything depending on semantic similarity will return nothing in Phase 3 — that's by design.

---

## Setup

Before starting:

```bash
# Branch
git checkout feat/coworker-phase-3-memory

# Build everything (utils, vault, scratchpad, memory)
cd packages/coworker-utils && npm run build && cd ../..
cd packages/coworker-vault && npm run build && cd ../..
cd packages/coworker-scratchpad && npm run build && cd ../..
cd packages/coworker-memory && npm run build && cd ../..

# Verify memory build copied the init migration to dist/
ls packages/coworker-memory/dist/migrations/001-init.sql

# Compile tests so the integration test can substitute for slash/LLM scenarios
npm run test:compile

# (Optional) Clear pre-existing memory + vault + scratchpads to start clean
rm -rf ~/.otto/memory/ ~/.otto/scratchpads/ ~/.otto/data_vault/ ~/.otto/audit.jsonl ~/.otto/audit.*.jsonl
# Also remove workspace memory if any exists
rm -rf <workspace>/.otto/memory/
```

**Disk layout reference — peek here any time:**

```
~/.otto/
  memory/                                       USER-GLOBAL memory state (when scope_mode = global)
    workspace.json                              identity record; not used in per-project-tagged mode
    lessons.md                                  Layer A (curated lessons; frontmatter + bullets)
    instructions.md                             Layer A (persistent operator directives)
    layer-b.db                                  Layer B SQLite (FTS5 BM25)
  audit.jsonl                                   shared sink (memory + vault + secret-scanner)
  audit.1.jsonl … audit.5.jsonl                 rotated tails

<workspace>/.otto/
  memory/                                       WORKSPACE memory state (per-project-tagged mode)
    workspace.json                              identity: { _schema:1, id:<slug>-<6 hex>, memory_seed_applied:false }
    lessons.md                                  Layer A
    instructions.md                             Layer A
    layer-b.db                                  Layer B SQLite
    layer-b.db-wal                              WAL journal
    layer-b.db-shm                              SHM file
```

**Programmatic API entry points** (for scenarios that need to bypass the deferred activator wiring):

```typescript
import { createMemoryBundle } from 'src/resources/extensions/coworker-memory/memory-singleton.js';
import { runMemorize } from 'src/resources/extensions/coworker-memory/memorize-tool.js';
import { runRecall }   from 'src/resources/extensions/coworker-memory/recall-tool.js';
import { runMemoryCommand } from 'src/resources/extensions/coworker-memory/memory-command.js';
import { onSessionStart, onSessionShutdown }
  from 'src/resources/extensions/coworker-memory/session-hooks.js';
```

---

## Scenario 1 — workspace.json creation + idempotence

**Goal:** First launch in a fresh workspace materializes `workspace.json` with the documented shape; relaunch is idempotent (no schema bump, ID stable).

**Phase coverage:** Task 3 (`resolveWorkspaceId` / `writeWorkspaceId`), Task 13 (`createMemoryBundle`).

```typescript
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createMemoryBundle } from 'src/resources/extensions/coworker-memory/memory-singleton.js';

const workspaceDir = mkdtempSync(join(tmpdir(), 'mem-ws1-'));
const b1 = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
const id1 = b1.workspace.id;
await b1.shutdown();

const b2 = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
const id2 = b2.workspace.id;
await b2.shutdown();
console.assert(id1 === id2, 'workspace id must be stable across runs');
```

**Disk checks:**
```bash
cat <workspace>/.otto/memory/workspace.json | jq
# { _schema: 1, id: "<slug>-<6 hex>", memory_seed_applied: false, ... }
```

**Pass criteria:**
- `_schema` is 1.
- `id` matches `<slug>-<6-lowercase-hex>` (path-hash fallback when no git remote).
- Second creation does NOT overwrite `id` or `memory_seed_applied`.

---

## Scenario 2 — Layer A `memorize` + read-back + session_start injection

**Goal:** A note appended via `runMemorize` lands in `lessons.md` with frontmatter; `onSessionStart` produces a system-prompt fragment containing it.

**Phase coverage:** Task 6 (`LayerAStore`), Task 10 (`buildContextInjection`), Task 11 (persona seed), Task 14 (`runMemorize`), Task 17 (`onSessionStart`).

```typescript
const bundle = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
await runMemorize(bundle, { layer: 'lessons', content: 'MTTR is 30m for P1' });

const ctx = await onSessionStart(bundle, { sessionId: 'sess-1' });
console.log(ctx.systemPromptFragment);
// Contains "Memory (Layer A)" block and the MTTR bullet
```

**Disk checks:**
```bash
cat <workspace>/.otto/memory/lessons.md
# ---
# _schema: 1
# layer: lessons
# ---
# - MTTR is 30m for P1
```

**Pass criteria:**
- `lessons.md` exists with frontmatter (`_schema`, `layer`).
- `systemPromptFragment` contains `Memory (Layer A)` heading and the bullet.
- Audit `write-layer-a` record exists with `layer: 'lessons'`, no value field.

---

## Scenario 3 — Layer B auto-retain on short turn → `kind=turn`

**Goal:** A short single-line user turn passes through the recorder as `kind:'turn'` and lands in `layer-b.db`.

**Phase coverage:** Task 5 (PasteDetector), Task 8 (`MemoryRecorder.recordTurn`).

```typescript
await bundle.recorder.recordTurn({
  role: 'user',
  content: 'restart the load balancer at 14:00',
  turnId: 't1',
});
const r = await runRecall(bundle, { query: 'load balancer' });
console.assert(r.results[0].drawer.kind === 'turn');
```

**Disk check:**
```bash
sqlite3 <workspace>/.otto/memory/layer-b.db "SELECT kind, length(content) FROM drawers"
# turn | <chars>
```

**Pass criteria:**
- Drawer row has `kind = 'turn'`.
- Audit `write-drawer` record carries `kind: 'turn'`, `redacted: false`.

---

## Scenario 4 — Layer B auto-retain on long paste → `kind=paste`

**Goal:** A paste-shaped content blob (≥ 500 chars, or with triple-backticks, or with newlines beyond the heuristic threshold) is classified as `kind:'paste'`.

**Phase coverage:** Task 5 (PasteDetector heuristic), Task 8 (`recordTurn` dispatching to paste path).

```typescript
const longPaste = '```\n' + 'x'.repeat(600) + '\n```';
await bundle.recorder.recordTurn({ role: 'user', content: longPaste, turnId: 't2' });
const r = await runRecall(bundle, { query: 'x' });
console.assert(r.results.some(x => x.drawer.kind === 'paste'));
```

**Pass criteria:**
- At least one drawer is `kind = 'paste'`.
- PasteDetector heuristic triggers on the threshold path documented in spec §6.

---

## Scenario 5 — `file_load` drawer via scratchpad

**Goal:** A FileCollector load inside a scratchpad cell writes a drawer with `kind:'file_load'`, room aligned to the scratchpad's `currentScratchpadName`.

**Phase coverage:** Task 18 (`currentScratchpadName` accessor), Task 19 (scratchpad FileCollector → `recordFileLoad` bridge).

**[BLOCKED on Phase 3.1]** — the cross-extension call from `coworker-scratchpad` into `MemoryRecorder.recordFileLoad` requires the memory extension to be live in `pi-coding-agent`'s activator. The bridge code is in place at the scratchpad layer; the consumer hop is what's missing.

**Substitute verification:** Invoke `recordFileLoad` directly. Confirms the recorder, drawer shape, and room derivation are correct:

```typescript
await bundle.recorder.recordFileLoad({
  filePath: '/tmp/incident-notes.txt',
  content: 'on-call said the LB was flapping',
  scratchpadName: 't5',
});
const r = await runRecall(bundle, { query: 'flapping', filters: { kind: 'file_load' } });
console.assert(r.results[0].drawer.kind === 'file_load');
console.assert(r.results[0].drawer.room.includes('t5'));
```

**Pass criteria:**
- Drawer `kind = 'file_load'`.
- `room` derives from `scratchpadName` per `ScopeResolver`.
- Audit `write-drawer` records `kind: 'file_load'`.

---

## Scenario 6 — Recall happy path + filter by `kind` / `room` / `wing`

**Goal:** `runRecall` returns the highest-BM25 match for a query, with snippets, and honors filters.

**Phase coverage:** Task 7 (`LocalSqliteBackend.recall`), Task 9 (`RecallFormatter`), Task 15 (`runRecall`).

```typescript
const all   = await runRecall(bundle, { query: 'load balancer' });
const turns = await runRecall(bundle, { query: 'load balancer', filters: { kind: 'turn' } });
const pasted = await runRecall(bundle, { query: 'x', filters: { kind: 'paste' } });

console.log(all.results.map(r => `${r.drawer.kind}: ${r.snippet}`));
```

**Pass criteria:**
- `all` returns one or more results sorted by BM25 score descending.
- `turns` returns only `kind = 'turn'` rows.
- `pasted` returns only `kind = 'paste'` rows.
- Each `snippet` is FTS5-truncated with `<mark>` tags around the matched terms; full content is in `drawer.content` only when the consumer asks (formatter omits by default).

---

## Scenario 7 — Recall against rotated FTS5 special chars

**Goal:** Queries containing FTS5 special characters (`"`, `*`, `^`, `:`, `()` — see spec §14) don't crash the backend; they're either escaped or matched literally.

**Phase coverage:** Task 7 (FTS5 quoting), Task 15 (input sanitization).

```typescript
await bundle.recorder.recordTurn({
  role: 'user',
  content: 'service:datadog query "tag:env:prod" ^anchor',
  turnId: 't7',
});

const r1 = await runRecall(bundle, { query: '"tag:env:prod"' });
const r2 = await runRecall(bundle, { query: 'service:datadog' });
const r3 = await runRecall(bundle, { query: '^anchor' });
```

**Pass criteria:**
- No backend error for any of the three queries.
- At least one returns a result.
- Quoted phrase query treats the contents as a literal phrase.

---

## Scenario 8 — SecretScanner block on `memorize`

**Goal:** Layer A is the "curated" lane; secret content is **refused** with a clear error. Lessons.md must not be modified.

**Phase coverage:** Task 6 (`LayerAStore.append` SecretScanner block), Task 14 (`runMemorize` surfacing the error).

```typescript
const before = await readFile(join(workspaceDir, '.otto/memory/lessons.md'), 'utf8').catch(() => '');
await runMemorize(bundle, {
  layer: 'lessons',
  content: 'token AKIAABCDEFGHIJKLMNOP from datadog',
}).catch(err => console.log('blocked:', err.message));
const after = await readFile(join(workspaceDir, '.otto/memory/lessons.md'), 'utf8').catch(() => '');
console.assert(before === after);
```

**Pass criteria:**
- Error message matches `/refused.*aws_access_key_id/i`.
- `lessons.md` unchanged byte-for-byte.
- Audit `block` record exists with `layer: 'lessons'`, `kind: 'aws_access_key_id'`, no value, no preview.

---

## Scenario 9 — SecretScanner redact on paste

**Goal:** Layer B is the "captured" lane; secret content is **redacted** in the stored drawer, `redacted` flag set, audit records the redaction with field metadata only.

**Phase coverage:** Task 8 (`MemoryRecorder` redact path).

```typescript
await bundle.recorder.recordTurn({
  role: 'user',
  content: 'login token AKIAABCDEFGHIJKLMNOP, used for Datadog API',
  turnId: 't9',
});
const r = await runRecall(bundle, { query: 'Datadog' });
const hit = r.results[0];
console.assert(hit.drawer.redacted === true);
console.assert(hit.drawer.content.includes('[REDACTED:aws_access_key_id]'));
console.assert(!hit.drawer.content.includes('AKIAABCDEFGHIJKLMNOP'));
```

**Pass criteria:**
- Drawer `redacted = true`.
- Stored content contains `[REDACTED:aws_access_key_id]`, NOT the original secret.
- Audit `redact` record carries `kind: 'aws_access_key_id'`, `offset`, `length`; no `value`, no `preview`.

---

## Scenario 10 — Persona seed first-activation copy

**Goal:** On first session_start with a persona that defines `memory_seed/`, the bundled seed files copy to `<workspace>/.otto/memory/` and `workspace.json.memory_seed_applied` flips to `true`.

**Phase coverage:** Task 11 (`applyPersonaSeed`), Task 17 (`onSessionStart` invokes seed path).

```typescript
// Use a test persona that bundles a memory_seed/ directory under packages/coworker-persona/test-fixtures/
const bundle = await createMemoryBundle({
  workspaceDir,
  scopeMode: 'per-project-tagged',
  personaSeedDir: '/path/to/test-fixture/memory_seed',
});
const ctx = await onSessionStart(bundle, { sessionId: 'sess-seed' });

const ws = JSON.parse(await readFile(join(workspaceDir, '.otto/memory/workspace.json'), 'utf8'));
console.assert(ws.memory_seed_applied === true);
```

**Pass criteria:**
- Seed files exist at `<workspace>/.otto/memory/` (lessons.md / instructions.md merged or copied per spec §11).
- `workspace.json.memory_seed_applied = true`.
- Audit `seed-applied` record exists.

---

## Scenario 11 — Persona seed re-application via flag reset

**Goal:** Resetting `memory_seed_applied` to `false` in `workspace.json` causes the next session_start to re-apply the seed (idempotent, doesn't double-bullet existing entries).

**Phase coverage:** Task 11 (idempotent seed merge), Task 17.

```typescript
const wsPath = join(workspaceDir, '.otto/memory/workspace.json');
const ws = JSON.parse(await readFile(wsPath, 'utf8'));
ws.memory_seed_applied = false;
await writeFile(wsPath, JSON.stringify(ws, null, 2));

await onSessionStart(bundle, { sessionId: 'sess-seed-2' });
const lessonsAfter = await readFile(join(workspaceDir, '.otto/memory/lessons.md'), 'utf8');
// Each seeded bullet appears exactly once.
```

**Pass criteria:**
- `memory_seed_applied` returns to `true`.
- No duplicated seed bullets (merge is set-like on bullet text).

---

## Scenario 12 — Scope mode switch (global vs per-project-tagged)

**Goal:** Switching `scopeMode` changes where writes land and which wings are visible at read time.

**Phase coverage:** Task 4 (`ScopeResolver`), Task 10 (`buildContextInjection` wing matrix), Task 17 (hook config plumbing).

```typescript
// per-project-tagged: writes go to <workspace>/.otto/memory/; reads see workspace wing only
const ws = await createMemoryBundle({ workspaceDir, scopeMode: 'per-project-tagged' });
await runMemorize(ws, { layer: 'lessons', content: 'project-local lesson' });
const ctxW = await onSessionStart(ws, { sessionId: 'sess-w' });
console.log(ctxW.systemPromptFragment.includes('project-local lesson'));  // true

// global: writes go to ~/.otto/memory/; reads see global wing across workspaces
const gl = await createMemoryBundle({ workspaceDir, globalDir: '/tmp/global-otto', scopeMode: 'global' });
await runMemorize(gl, { layer: 'lessons', content: 'global lesson visible everywhere' });
```

**Pass criteria:**
- `per-project-tagged` writes land under `<workspace>/.otto/memory/`.
- `global` writes land under the configured global dir.
- Context-injection includes the right wings per spec §5 matrix.

---

## Scenario 13 — `/memory note` slash

**Goal:** Typing `/memory note "<text>"` in chat appends to `lessons.md` with the bullet form, refusing secrets.

**Phase coverage:** Task 16 (`runMemoryCommand` `note` subcommand), Task 6 (Layer A append).

**[BLOCKED on Phase 3.1]** — slash-command bus registration is part of the activator hop.

**Substitute verification:** Invoke `runMemoryCommand` from a script. This is equivalent to what the slash bus would dispatch:

```typescript
import { runMemoryCommand } from 'src/resources/extensions/coworker-memory/memory-command.js';

const ok = await runMemoryCommand(bundle, {
  subcommand: 'note',
  args: ['MTTR is 30m for P1'],
});
console.log(ok.message);  // success

const blocked = await runMemoryCommand(bundle, {
  subcommand: 'note',
  args: ['token AKIAABCDEFGHIJKLMNOP'],
}).catch(err => err);
console.assert(/aws_access_key_id/i.test(String(blocked.message ?? blocked)));
```

**Pass criteria:**
- Success path: `lessons.md` grows by one bullet; audit `write-layer-a` record present.
- Block path: error names `aws_access_key_id`; `lessons.md` byte-for-byte unchanged.

---

## Scenario 14 — `/memory status` slash

**Goal:** Returns the operational snapshot: scope mode, workspace wing, drawer count, Layer B db path, schema version.

**Phase coverage:** Task 16 (`runMemoryCommand` `status` subcommand).

**[BLOCKED on Phase 3.1]** — slash-command bus registration.

**Substitute verification:**

```typescript
const status = await runMemoryCommand(bundle, { subcommand: 'status', args: [] });
console.log(status);
// {
//   scope_mode: 'per-project-tagged',
//   workspace_wing: '<slug>',
//   drawer_count: <n>,
//   layer_b_db_path: '<workspace>/.otto/memory/layer-b.db',
//   schema_version: 1
// }
```

**Pass criteria:**
- All fields present.
- `drawer_count` matches `sqlite3 <db> "SELECT COUNT(*) FROM drawers"`.
- `schema_version` is `1`.

---

## Scenario 15 — `/memory clear --wing --confirm` slash

**Goal:** Clearing the wing deletes Layer B drawers and Layer A markdown for that wing; subsequent recall returns 0; requires explicit `--confirm`.

**Phase coverage:** Task 16 (`runMemoryCommand` `clear` subcommand), Task 7 (`LocalSqliteBackend.clear`).

**[BLOCKED on Phase 3.1]** — slash-command bus registration.

**Substitute verification:**

```typescript
const dry = await runMemoryCommand(bundle, {
  subcommand: 'clear',
  args: ['--wing', '<workspace_wing>'],
}).catch(err => err);
console.assert(/confirm/i.test(String(dry.message ?? dry)));

const done = await runMemoryCommand(bundle, {
  subcommand: 'clear',
  args: ['--wing', '<workspace_wing>', '--confirm'],
});
console.log(done.deleted);  // N > 0

const r = await runRecall(bundle, { query: 'anything-from-before' });
console.assert(r.results.length === 0);
```

**Pass criteria:**
- Missing `--confirm` errors.
- With `--confirm`, response carries `deleted: N`.
- Recall after clear returns 0 results.
- Audit `clear` record exists with wing name, no values.

---

## Scenario 16 — Phase 1 + Phase 2 regression sweep

**Goal:** Phase 3 didn't break Phase 1's scratchpad surface or Phase 2's vault surface.

**Phase coverage:** Phase 1 + Phase 2 surfaces, not Phase 3 — but worth quick checks since Phase 3 touched `scratchpad-manager.ts` (Task 18, 19) and shares the same `AuditLog` sink as the vault.

**Quick sweep — Phase 1:**

- `/sp new s16-pre` → no `--use` flag → works exactly as before.
- `/sp new s16-bound --use jira:prod` then a cell that does NOT touch `process.env` → returns its result unchanged.
- `/sp tree`, `/sp view`, `/sp save`, `/sp detach`, `/sp reset` → unchanged.
- `currentScratchpadName` accessor returns the live name without mutating internal state.
- `/sp evict s16-bound` and `/sp evict --force s16-bound` → unchanged.

**Quick sweep — Phase 2:**

- `/connect jira prod` (or scripted `runConnect`) → still creates entry at chmod 600.
- `/sp new s16-bound2 --use jira:prod` → spawn-time env injection still works; cell reads `OTTO_DS_JIRA_PROD__*`.
- `/datasource list`, `/datasource test`, `/datasource remove` → unchanged.
- `/audit --producer vault` → returns Phase 2 records; new memory records appear under `--producer memory` only.
- Staleness banner one-shot semantics → unchanged.

**Pass criterion:** No regressions; run full test suite:

```bash
npm run test:compile
node --test dist-test/packages/coworker-scratchpad/src/*.test.js
node --test dist-test/packages/coworker-vault/src/*.test.js
node --test dist-test/src/resources/extensions/coworker-scratchpad/*.test.js
node --test dist-test/packages/coworker-memory/src/*.test.js
node --test dist-test/src/resources/extensions/coworker-memory/*.test.js
```

All green.

---

## Phase 3 coverage matrix

| Scenario | Task(s) | Spec section | Pillar covered |
|---|---|---|---|
| 1 | 3, 13 | §4.1 workspace.json | identity creation + idempotence |
| 2 | 6, 10, 14, 17 | §3.3, §4.2, §10 | Layer A write + Layer A → system-prompt injection |
| 3 | 5, 8 | §6 auto-retain | short-turn → `kind=turn` |
| 4 | 5, 8 | §6 auto-retain | long-paste → `kind=paste` |
| 5 | 18, 19 | §5 currentScratchpadName | file_load drawer wiring (BLOCKED on 3.1) |
| 6 | 7, 9, 15 | §3.2, §8 | recall + kind/room/wing filters |
| 7 | 7, 15 | §14 edge cases | FTS5 special-char query safety |
| 8 | 6, 14 | §7 split policy | Layer A SecretScanner block |
| 9 | 8 | §7 split policy | Layer B SecretScanner redact |
| 10 | 11, 17 | §11 persona seed | first-activation copy |
| 11 | 11, 17 | §11 persona seed | idempotent re-application |
| 12 | 4, 10, 17 | §5 scope modes | mode switch + injection matrix |
| 13 | 16, 6 | §9 slash commands | /memory note (BLOCKED on 3.1) |
| 14 | 16 | §9 slash commands | /memory status (BLOCKED on 3.1) |
| 15 | 16, 7 | §9 slash commands | /memory clear --wing --confirm (BLOCKED on 3.1) |
| 16 | regression | — | Phase 1 + Phase 2 surfaces intact |

**Spec section → task delivery map (full spec §2–§16):**

| Spec section | Implemented in |
|---|---|
| §2 decision matrix | Locked decisions appear in Tasks 1, 6, 7, 8, 10, 13, 14, 15. |
| §3.1 package layout | Tasks 1–12. |
| §3.2 MemoryBackend interface | Task 2. |
| §3.3 module responsibilities | Each module Task 3–11. |
| §3.4 audit verbs | Tasks 6 (write-layer-a, block), 8 (write-drawer, redact), 15 (recall), 17 (seed-applied). |
| §4 on-disk layout | Tasks 3 (workspace.json), 6 (Layer A files), 7 (Layer B db). |
| §4.1 workspace.json schema | Task 3. |
| §4.2 Layer A frontmatter | Task 6. |
| §4.3 SQLite schema migration | Task 7. |
| §5 scope modes + derivation | Task 4 (scope-resolver), Task 18 (currentScratchpadName). |
| §6 auto-retain semantics | Task 5 (paste-detector) + Task 8 (recordTurn dispatching) + Task 20 (wiring, deferred to 3.1). |
| §7 SecretScanner split policy | Task 6 (Layer A blocks), Task 8 (Layer B redacts). |
| §8 LLM tools | Tasks 14, 15. |
| §9 slash commands | Task 16. |
| §10 context injection on session_start | Task 10 (helper) + Task 17 (hook). |
| §11 persona seed application | Task 11 (helper) + Task 17 (hook). |
| §12 persistence triggers | Distributed across Tasks 8, 14, 16, 17, 20. |
| §13 errors | Task 1. |
| §14 edge cases | Tested across Tasks 3, 6, 7, 8, 11. |
| §15 testing strategy | Each module + Task 21 integration. |
| §16 milestone | Task 21 first test. |

---

## Phase 3 sign-off checklist

Run before merging `feat/coworker-phase-3-memory`:

- [ ] **Scenario 1:** workspace.json creation + idempotence; `_schema:1`, stable `<slug>-<hex>` id
- [ ] **Scenario 2:** `runMemorize` writes lessons.md; `onSessionStart` injects "Memory (Layer A)" block
- [ ] **Scenario 3:** short turn lands as `kind=turn`
- [ ] **Scenario 4:** long paste lands as `kind=paste`
- [ ] **Scenario 5:** [BLOCKED on 3.1] file_load drawer — substitute via `recordFileLoad` script + integration test
- [ ] **Scenario 6:** recall returns BM25-ranked snippets; kind/room/wing filters narrow correctly
- [ ] **Scenario 7:** FTS5 special-char queries do not crash backend
- [ ] **Scenario 8:** memorize blocks AWS-key-shaped content; lessons.md unchanged
- [ ] **Scenario 9:** Layer B retains the drawer with `redacted:true` + `[REDACTED:<kind>]` payload
- [ ] **Scenario 10:** persona seed copies on first session_start; `memory_seed_applied:true`
- [ ] **Scenario 11:** flipping flag re-applies seed idempotently (no duplicate bullets)
- [ ] **Scenario 12:** scope mode switch changes write target + read wings per matrix
- [ ] **Scenario 13:** [BLOCKED on 3.1] /memory note — substitute via `runMemoryCommand`
- [ ] **Scenario 14:** [BLOCKED on 3.1] /memory status — substitute via `runMemoryCommand`
- [ ] **Scenario 15:** [BLOCKED on 3.1] /memory clear --wing --confirm — substitute via `runMemoryCommand`
- [ ] **Scenario 16:** Phase 1 + Phase 2 surfaces unaffected; full test suite green

When all 16 boxes are checked, Phase 3 is verified end-to-end and ready for merge.

If any scenario fails, log the issue against the relevant Phase 3 task; if a scenario reveals a Phase 3.1 follow-up beyond the already-tagged activator hop (e.g., need `/memory wing` runtime override persistence, need new backend interface change), capture it as a separate ticket so the merge isn't blocked.

**Phase 3.1 carry-over (already known, do not re-file):**
- Production extension activator hop for `coworker-memory` extension (LLM tool registration, slash-command bus registration, session-hook attachment) — Tasks 16/17/19/20 all depend on this.
- Auto-retain user-turn wiring (Task 20).
- scratchpad → memory `file_load` cross-extension call (Task 19 consumer side).
