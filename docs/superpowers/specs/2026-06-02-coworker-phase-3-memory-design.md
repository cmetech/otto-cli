# Phase 3 — otto-memory (Layers A + B + backend interface) design

**Status:** approved (brainstorming complete, awaiting writing-plans).
**Date:** 2026-06-02.
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` (§2.1, §3.3, §3.5, §6.5).
**Roadmap entry:** `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` (Phase 3).
**Scope:** graduate `@otto/coworker-memory` from `export {}` stub to read+write memory pillar covering Layer A (behavior/rules markdown) and Layer B (verbatim drawers in SQLite + FTS5) with a pluggable `MemoryBackend` interface.

---

## 1. Goal

Ship the Day-2 verbatim recall milestone:

> Paste a long incident note on Monday → ask Otto on Tuesday "what did the on-call say about the load balancer?" → exact words come back, with the original turn / paste / file_load that produced them.

Secondary outcome: user-explicit `memorize` calls write durable rules/lessons/profile facts to Layer A markdown that gets injected into the system prompt at every session_start. Persona memory-seed copies into Layer A on first activation (cheap one-shot).

---

## 2. Decisions locked during brainstorming

| Topic | Decision | Why |
|---|---|---|
| Layer B write timing | **Per-turn write** (spec §3.5). Every user message → drawer; pastes/file_loads emit additional drawers right after. SQLite WAL makes per-turn writes effectively free. | Matches Day-2 milestone exactly. "Session-shutdown flush" (roadmap phrasing) is loose — §3.5 is operational truth. |
| Layer A auto-write surface in Phase 3 | **User-explicit + persona seed only.** `memorize` tool + `/memory note` slash for users; persona `memory-seed/` copy on first activation. Cerebellum/ACC/digest stay Phase 5. | Day-2 milestone is "remember the customer's deadline" — the user-explicit path is the load-bearing one. Persona seed is ~30 lines of file copy. |
| Layer B SQLite schema | **Flat `drawers` table with denormalized `wing`/`room`/`kind` columns + content-linked FTS5.** Wings/Rooms are pure string labels; no dimension tables in v1. Migration adds dimension tables later if a use case appears. | Spec §2.1 explicitly says "storage layout is the backend's choice." `SELECT DISTINCT` over workspace-sized drawers tables is microseconds; physical wings/rooms tables are bookkeeping without payoff. |
| Workspace identification | **Stable `workspace.json` id** at `<workspace>/.otto/memory/workspace.json` with `{ id: <slug>, created_at, memory_seed_applied: boolean }`. Falls back to path-hash for older workspaces. | Survives `mv` / `git clone` / rename. Wing labels are user-meaningful in tagged recall results. Doubles as the home for the persona-seed-applied flag spec §2.5 calls for. |
| Auto-retain + LLM tool surface | **Auto-retain every user turn** + paste detection heuristic (multi-line code-block OR length ≥ 500 chars) + scratchpad-emitted file_load drawers via `MemoryRecorder`. Agent text NOT retained. **LLM tools: `memorize` + `recall` only.** `retainEveryNTurns` config knob from the parent spec is dropped — incompatible with verbatim semantics. | The Day-2 milestone is literally "paste Monday → recall Tuesday." For that to work, paste must land in Layer B automatically — the LLM can't be relied on to call `retain()` on every long input. Skipping turns breaks the milestone. |
| SecretScanner gate | **Split policy.** Layer A writes (memorize, persona-seed copy) **block** on detection with a user-facing error; Layer B writes (turn / paste / file_load) **redact** before persist. Two audit verbs: `producer:'memory', action:'block'` and `producer:'memory', action:'redact'`. | Layer A is curated content; a rule that reads "API key is `[REDACTED:anthropic_api_key]`" is gibberish — better to refuse. Layer B is verbatim conversation capture; redaction preserves recall for the surrounding context (ticket title, timestamp, customer name) while killing the secret. |

---

## 3. Architecture

### 3.1 Package layout

```
packages/coworker-memory/src/
  index.ts                        ← public barrel
  types.ts                        ← Wing, Room, DrawerKind, Drawer, RecallQuery, BackendStatus,
                                    LayerAEntry, LayerAKind ('profile'|'rule'|'lesson')
  errors.ts                       ← MemoryNotInitialized, BackendUnavailable,
                                    DrawerKindRejected, LayerAWriteBlocked,
                                    RecallQueryMalformed, MemoryEntryMalformed
  memory-backend.ts               ← MemoryBackend interface
  local-sqlite-backend.ts         ← LocalSqliteBackend: schema bootstrap, recall, retain,
                                    listWings, listRooms, status, clear
  layer-a-store.ts                ← LayerAStore: read/write markdown per scope
  workspace-id.ts                 ← resolveWorkspaceId(): workspace.json read/create
  scope-resolver.ts               ← resolveScope(mode, ctx): wing(s) for write + read
  paste-detector.ts               ← detectPaste(text): heuristic
  memory-recorder.ts              ← MemoryRecorder impl
  persona-seed.ts                 ← applyPersonaSeed(bundle): one-shot copy
  recall-formatter.ts             ← format Drawer[] for LLM tool_result
  context-injection.ts            ← buildLayerAContext({scope, tokenLimit})
  migrations/
    001-init.sql                  ← initial Layer B schema
```

Extension surface (mirrors how `coworker-vault` is structured):

```
src/resources/extensions/coworker-memory/
  extension-manifest.json         ← commands: memory; hooks: session_start, session_shutdown
  memory-singleton.ts             ← createMemoryBundle(opts)
  memorize-tool.ts                ← LLM tool: memorize
  recall-tool.ts                  ← LLM tool: recall
  memory-command.ts               ← /memory note | wing | room | status | clear
  session-hooks.ts                ← session_start (Layer A inject + persona seed)
                                    session_shutdown (WAL checkpoint)
```

Cross-pillar touches:

```
src/resources/extensions/coworker-scratchpad/scratchpad-tool.ts
  ← on FileCollector load, call memoryRecorder.recordFileLoad(...).

src/resources/extensions/coworker-scratchpad/sp-command.ts
  ← expose currentScratchpadName(sessionId) so memory uses it as default Room.
```

### 3.2 `MemoryBackend` interface (Phase 3 surface)

Refines spec §2.1 with Layer-C methods made optional for v1 (`LocalSqliteBackend` returns `null`/empty for those; Phase 5 implements):

```typescript
export type Wing = string;
export type Room = string;
export type DrawerKind = 'turn' | 'paste' | 'file_load' | 'ticket' | 'email' | 'rca' | 'note';

export interface Drawer {
  id: string;                    // ULID
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;               // verbatim (after SecretScanner.redact)
  metadata: Record<string, unknown>;
  created_at: string;            // ISO-8601
  parent_id?: string;            // future branching support (§3.3 parent spec)
  redacted: boolean;             // true if SecretScanner touched content
}

export interface RecallQuery {
  query: string;
  wing?: Wing | Wing[];          // omit = all wings the active scope allows
  room?: Room;
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;          // default 8; clamped at 64
}

export interface RecallResult {
  drawer: Drawer;
  score: number;                 // BM25 score from FTS5
  snippet: string;               // FTS5 snippet() with <mark>...</mark>
}

export interface BackendStatus {
  ready: boolean;
  workspace_wing: Wing;
  drawer_count: number;
  layer_b_db_path: string;
  schema_version: number;
}

export interface MemoryBackend {
  recall(query: RecallQuery): Promise<RecallResult[]>;
  retain(input: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  status(): Promise<BackendStatus>;
  clear(args: { wing?: Wing; confirm: true }): Promise<{ deleted: number }>;
}
```

### 3.3 Module responsibilities

- **`LocalSqliteBackend`** — owns the `<workspace>/.otto/memory/layer-b.db` file. Bootstraps schema from `migrations/001-init.sql`. Handles WAL pragma, FTS5 virtual table sync via triggers. Pure storage; does NOT know about scope modes or workspace IDs (caller passes the wing).

- **`LayerAStore`** — reads + writes `profile.md` / `rules.md` / `lessons.md` per scope. Each file carries YAML frontmatter `{ schema_version: 1, last_modified_at, source }`. Append-only for `lessons.md` (entries are timestamped bullets); replace-in-place for `profile.md` and `rules.md` (user-edited).

- **`WorkspaceId`** — reads `<workspace>/.otto/memory/workspace.json`; if missing, creates one with a stable slug derived from the workspace directory's basename + 6-hex hash of the absolute path. Returns `{ id, created_at, memory_seed_applied }`.

- **`ScopeResolver`** — pure function over `{ mode, workspaceWing, globalWing }`:
  - `mode: 'global'` → write wing = `'global'`, read wings = `['global']`.
  - `mode: 'per-project'` → write wing = workspaceWing, read wings = `[workspaceWing]`.
  - `mode: 'per-project-tagged'` (default) → write wing = workspaceWing, read wings = `[workspaceWing, 'global']`.

- **`PasteDetector`** — heuristic returning `'paste' | 'turn'` for an incoming user message. Paste if: contains triple-backtick code fence OR message length ≥ 500 chars OR > 10 newlines. Threshold values are config knobs.

- **`MemoryRecorder`** — the cross-pillar contract. Constructed with `{ backend, scopeResolver, scanner, audit, currentScratchpadProvider }`. Methods:
  - `recordTurn(args)` — auto-called for every user message. Detects paste via `PasteDetector`; emits one `kind:'turn'` OR `kind:'paste'` drawer to the active wing.
  - `recordPaste(args)` — explicit paste recording (e.g., `/memory paste` slash).
  - `recordFileLoad(args)` — called by scratchpad on FileCollector load.

- **`PersonaSeed`** — checks `workspace.json.memory_seed_applied`. If false and the active persona declares `memory-seed/` files, copies them into the workspace Layer A. Flips the flag. One-shot per workspace per persona switch.

- **`RecallFormatter`** — turns `RecallResult[]` into a markdown block for the LLM tool_result. Format:
  ```
  ### Memory recall (N matches)

  1. [wing/room/kind · 2026-06-01 14:22] (score 5.21)
     > paste content snippet with <mark>matched</mark> terms
     drawer://abc123

  2. ...
  ```

- **`ContextInjection`** — at session_start, reads Layer A files for the active scope (global always; workspace if scope mode ≠ 'global'), concatenates with priority ordering (`profile.md` > `rules.md` > `lessons.md`), truncates to `injectionTokenLimit` (3000 default), returns the markdown block to be inserted into the system prompt at the spec §5.3 "Memory section" slot.

### 3.4 Audit verbs (added to the shared `~/.otto/audit.jsonl` sink)

| `action` | `detail` payload |
|---|---|
| `write-layer-a` | `{ scope, kind: 'profile'\|'rule'\|'lesson', source: 'user'\|'persona-seed', byte_count }` |
| `write-drawer` | `{ wing, room, kind, byte_count, redacted: boolean }` |
| `block` | `{ scope, kind, reason: 'secret', secret_kind: string }` |
| `redact` | `{ wing, room, kind, secret_kind, offset, length }` (never the value) |
| `recall` | `{ wing_filter, room_filter, kind_filter, days_back, result_count }` (NOT the query string — it may contain user secrets) |
| `seed-applied` | `{ persona_id, files_copied: [name…] }` |

---

## 4. On-disk layout

```
~/.otto/                                  ← USER-GLOBAL
  memory/                                 ← global Layer A only
    profile.md                            ← global behavior / preferences
    rules.md                              ← global rules
    lessons.md                            ← global lessons (append-only)
  audit.jsonl                             ← shared sink (Phase 2 added it; Phase 3 is a new producer)

<workspace>/.otto/                        ← PROJECT-SCOPED
  memory/
    workspace.json                        ← { id, created_at, memory_seed_applied }
    profile.md                            ← workspace Layer A (overrides global)
    rules.md
    lessons.md
    layer-b.db                            ← SQLite + FTS5 for verbatim drawers
    layer-b.db-wal                        ← WAL companion (transient)
    layer-b.db-shm                        ← shared memory (transient)
```

Global Layer B is **not** stored — per-project-tagged mode reads the same `layer-b.db` from the workspace and tags wing values. Cross-workspace global verbatim recall would need a `~/.otto/memory/layer-b.db` shared file; deferred to v2.

### 4.1 `workspace.json` schema

```json
{
  "_schema": 1,
  "id": "acme-noc-7f3a9c12",
  "created_at": "2026-06-02T10:00:00.000Z",
  "memory_seed_applied": false,
  "memory_seed_persona": null
}
```

`id` format: `<workspace-dir-basename>-<6 hex chars of SHA256(absolute path)>`. Falls back to `workspace-<6 hex>` if basename is empty or invalid (e.g., `/`).

### 4.2 Layer A markdown structure

Each Layer A file carries YAML frontmatter:

```markdown
---
schema_version: 1
last_modified_at: 2026-06-02T11:30:00.000Z
source: user
---

# Profile

Operator role: NOC analyst. Prefers polars over pandas.
```

- `profile.md` and `rules.md` — user-editable; replace-in-place writes. Section structure is freeform — user decides organization. `memorize({kind:'profile'\|'rule', text})` appends to the appropriate file's body under a `## (timestamp)` heading.
- `lessons.md` — append-only. Each entry is a `- (timestamp) lesson text` bullet. Order is chronological. `memorize({kind:'lesson', text})` appends.

### 4.3 Layer B SQLite schema (migration 001)

```sql
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;
PRAGMA foreign_keys = ON;

CREATE TABLE drawers (
  id TEXT PRIMARY KEY,             -- ULID
  wing TEXT NOT NULL,
  room TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('turn','paste','file_load','ticket','email','rca','note')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  parent_id TEXT REFERENCES drawers(id) ON DELETE SET NULL,
  redacted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL          -- ISO-8601
);

CREATE INDEX idx_drawers_wing_room ON drawers (wing, room);
CREATE INDEX idx_drawers_kind ON drawers (kind);
CREATE INDEX idx_drawers_created_at ON drawers (created_at);

CREATE VIRTUAL TABLE drawers_fts USING fts5 (
  content,
  content='drawers',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS5 in sync (standard contentless-virtual pattern)
CREATE TRIGGER drawers_ai AFTER INSERT ON drawers BEGIN
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER drawers_ad AFTER DELETE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER drawers_au AFTER UPDATE ON drawers BEGIN
  INSERT INTO drawers_fts (drawers_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
  INSERT INTO drawers_fts (rowid, content) VALUES (new.rowid, new.content);
END;
```

**Tokenizer choice:** `unicode61 remove_diacritics 2` handles NOC content (IPs, hostnames, CIDRs, mixed-case identifiers) without aggressive stemming. Punctuation is treated as a token separator, which means `prod-web-01` matches both `prod` and `prod-web` queries — desired for NOC names.

**Recall ranking:** FTS5 default `bm25(drawers_fts)` ordering, ascending (lower is better in SQLite's FTS5 convention; we invert to descending in the result for "best first"). No recency boost in v1 — adds complexity and the default Day-2 milestone doesn't need it. Recency filtering is available via `days_back` query parameter.

---

## 5. Scope modes and wing/room derivation

### 5.1 Scope modes

| Mode | Write wing | Read wings | Use case |
|---|---|---|---|
| `global` | `'global'` | `['global']` | All workspaces share one bank. Useful for solo analysts. |
| `per-project` | workspace id (e.g., `'acme-noc-7f3a9c12'`) | `[workspace id]` | Hard isolation per customer/project. |
| `per-project-tagged` (default) | workspace id | `[workspace id, 'global']` | Project-local writes; recall sees both and tags results with source wing. |

Configured via `memory.scoping` in the config file or `OTTO_MEMORY_SCOPING` env var. Per-workspace override in `workspace.json` is **not** added in v1 (one less knob; default suits NOC).

### 5.2 Wing derivation

- `WorkspaceId.resolve()` returns the workspace's stable id from `workspace.json` (creating it if missing).
- Memory writes use `ScopeResolver.writeWing(mode, workspaceId)`.
- Memory reads use `ScopeResolver.readWings(mode, workspaceId)`.

### 5.3 Room derivation

The "Room == active scratchpad name" alignment from spec §2.1 is load-bearing:

```typescript
interface CurrentScratchpadProvider {
  currentScratchpadName(sessionId: string): string | null;
}
```

The scratchpad extension exports this via a small accessor added to `sp-command.ts`. Memory's `MemoryRecorder.recordTurn/recordPaste` defaults `room` to `currentScratchpadName(sessionId) ?? 'inbox'`. Explicit `/memory room <name>` overrides for the session.

`/memory wing <name>` is also supported — explicit wing override for the session, useful for cross-cutting groupings like `'customer-acme'`. Wing overrides do NOT change the scope; recall still uses `ScopeResolver.readWings(mode, workspaceId)` plus the override (so explicit wings are additive to the default read set).

---

## 6. Auto-retain semantics

### 6.1 Trigger

`MemoryRecorder.recordTurn` is called from Otto's session machinery (the layer that owns user-turn lifecycle) on every committed user message — once per message, after the message is accepted but before agent response. Single hook; no `retainEveryNTurns` knob, no batching.

### 6.2 Decision flow

```
user message arrives
  ↓
PasteDetector.detect(content)
  ↓
"paste" if (contains ``` block) OR (length ≥ 500) OR (>10 newlines)
"turn" otherwise
  ↓
SecretScanner.scan(content)
  ↓
zero hits → write Drawer with kind: 'turn'|'paste', redacted: false
  ↓
hits → SecretScanner.redact(content) → write Drawer with redacted: true
       emit audit {action: 'redact', wing, room, kind, secret_kind, offset, length}
       emit one audit record per hit; never include the value or preview
  ↓
audit {action: 'write-drawer', wing, room, kind, byte_count, redacted}
```

### 6.3 Agent text is NOT retained

Otto's own responses do not produce drawers. The recall index stays focused on what the user said + what landed in the workspace. Phase 5 may add an opt-in for capturing agent responses if user testing reveals a need; v1 doesn't.

### 6.4 File load drawers

Scratchpad calls `MemoryRecorder.recordFileLoad` after a successful `FileCollector.open(uri)`:

```typescript
await recorder.recordFileLoad({
  scratchpadName: 'p1-1234',
  collector: 'file',
  uri: 'file:///workspace/inputs/cmdb_q4.csv',
  bytes: 12_345_678,
  rows_loaded: 47_000,
  schema: { columns: ['hostname','env','kernel'] },
  turnId: '...',
});
```

Drawer content is a structured JSON blob (`JSON.stringify({collector, uri, bytes, rows_loaded, schema})`). Wing = active scope's write wing. Room = `scratchpadName` (always, since file_load is by definition cell-driven).

---

## 7. SecretScanner gate — split policy

### 7.1 Layer A — block on detection

```typescript
async function memorize(args: { text, kind, scope }) {
  const hits = scanner.scan(args.text);
  if (hits.length > 0) {
    audit.append({
      producer: 'memory', action: 'block', severity: 'warn',
      detail: { scope: args.scope, kind: args.kind, reason: 'secret',
                secret_kind: hits[0].kind },
    });
    throw new LayerAWriteBlocked(hits[0].kind);
  }
  // ... write to Layer A markdown
}
```

User-facing message:

> *"Refused to store: contains secret-shaped value (kind: aws_access_key_id). Remove the secret and retry. Vault entries should land in `/connect`, not memorize."*

The hint at the end nudges the user toward the vault for what they probably meant.

### 7.2 Layer B — redact and persist

```typescript
async function writeDrawer(input) {
  const hits = scanner.scan(input.content);
  if (hits.length === 0) {
    return backend.retain({ ...input, redacted: false });
  }
  for (const h of hits) {
    audit.append({
      producer: 'memory', action: 'redact', severity: 'warn',
      detail: { wing: input.wing, room: input.room, kind: input.kind,
                secret_kind: h.kind, offset: h.start, length: h.end - h.start },
    });
  }
  return backend.retain({ ...input, content: scanner.redact(input.content), redacted: true });
}
```

Audit details carry `secret_kind`, `offset`, `length` only. Never the value, never `SecretHit.preview` (which would expose 8 secret chars).

### 7.3 The `redacted` flag in recall results

Drawers persisted with `redacted: true` flag the recall result so the LLM (and future TUI render) can show a "this drawer was redacted" indicator. The flag is also useful for analyst forensics ("is anything in this room ever redacted?").

---

## 8. LLM tool surface (Phase 3)

### 8.1 `memorize`

```typescript
tool memorize(args: {
  text: string;                       // ≤ 10_000 chars
  kind: 'profile' | 'rule' | 'lesson';
  scope?: 'global' | 'workspace';     // default 'workspace'
}) -> { stored: true; layer_a_file: string }
```

- Throws `LayerAWriteBlocked` if SecretScanner hits.
- Writes the text under a timestamped section (profile/rules) or as a timestamped bullet (lessons).
- `last_modified_at` frontmatter updated atomically (.tmp + rename).
- Emits `audit { action: 'write-layer-a' }`.

### 8.2 `recall`

```typescript
tool recall(args: {
  query: string;                      // required
  kind?: DrawerKind | DrawerKind[];
  wing?: Wing;                        // explicit wing override
  room?: Room;
  days_back?: number;
  max_results?: number;               // default 8, max 64
}) -> { results: Array<{ drawer: Drawer; score: number; snippet: string }> }
```

- Translates query into FTS5 MATCH expression, escaping FTS5 syntax characters.
- Applies wing/room/kind/days_back filters via SQL WHERE.
- Returns top N by BM25 score, descending.
- Each result includes a snippet with `<mark>...</mark>` highlights (FTS5 `snippet()` function).
- Emits `audit { action: 'recall', wing_filter, room_filter, kind_filter, result_count }`.
  - **Never** logs the query string (may contain secrets).
- Output formatted by `RecallFormatter` into a markdown block before returning to the LLM.

### 8.3 No other LLM tools in Phase 3

- `entity_query` / `entity_assert` → Phase 5 (Layer C).
- `explain` → already in scratchpad extension; Phase 3 doesn't extend it.

---

## 9. Slash commands

| Command | Purpose |
|---|---|
| `/memory note <text>` | Same as `memorize({kind:'lesson', text, scope:'workspace'})` — fast user-side capture. |
| `/memory wing <name>` | Override the wing for the current session's writes. Reverts on session end. |
| `/memory room <name>` | Override the room for the current session's writes. Reverts on session end. |
| `/memory status` | Prints active scope mode, workspace_wing, drawer_count, layer_b_db_path, schema_version. |
| `/memory clear --wing <wing>` | Confirm prompt → deletes all drawers for `<wing>`. Audit emits a `clear` record. |
| `/memory seed --persona <id>` | Force re-application of persona memory-seed (overrides `memory_seed_applied` flag). Confirm prompt. |

Not in scope for Phase 3:
- `/memory recall` interactive search (LLM tool covers this; analyst can ask Otto directly).
- `/memory digest` (Phase 5 weekly digest UX).

---

## 10. Context injection on session_start

### 10.1 Flow

```
session_start hook fires
  ↓
ContextInjection.build({ scope, tokenLimit: 3000 })
  ↓
1. Resolve which Layer A scopes to read using scope mode:
     'global'              → read global only
     'per-project'         → read workspace only
     'per-project-tagged'  → read both; workspace shadows global on conflict
2. For each scope: LayerAStore.read(scope) → profile.md, rules.md, lessons.md
3. Concatenate in priority order:
     profile (workspace > global) > rules > lessons (workspace > global)
4. Truncate at injectionTokenLimit; lower-priority files dropped first
5. Wrap in markdown block:

   ## Memory (Layer A)

   ### Profile
   <content>

   ### Rules
   <content>

   ### Recent lessons
   <content>

  ↓
Returned to session machinery → injected at the §5.3 "Memory section" slot of the system prompt
```

### 10.2 Token budget

`injectionTokenLimit: 3000` (configurable). Token counting approximate (4 chars ≈ 1 token); precision not critical because the limit is a soft ceiling, not a hard cap.

### 10.3 Empty case

If no Layer A files exist (fresh install, no persona seed applied), the block is omitted entirely — no `## Memory (Layer A)` header, no placeholder text. Saves prompt tokens.

---

## 11. Persona seed application

### 11.1 Trigger

On every session_start, after Layer A context build:

```typescript
const ws = await resolveWorkspaceId(workspaceDir);
if (!ws.memory_seed_applied) {
  const persona = await personaRegistry.activePersona();
  if (persona?.hasMemorySeed()) {
    await applyPersonaSeed({ persona, layerAStore, workspaceWing });
    ws.memory_seed_applied = true;
    ws.memory_seed_persona = persona.id;
    await writeWorkspaceJson(workspaceDir, ws);
  }
}
```

### 11.2 What gets copied

`<persona-dir>/memory-seed/` is the spec §2.5 location. Files copied (overwrite if collision):
- `profile.md` → `<workspace>/.otto/memory/profile.md`
- `rules.md` → `<workspace>/.otto/memory/rules.md`
- `lessons.md` → `<workspace>/.otto/memory/lessons.md`

Each copy passes through SecretScanner (Layer A blocks). Persona files containing secrets fail seed application — emits audit `block` and continues with the remaining files. Audit `seed-applied` records the file list.

### 11.3 Re-application

`/memory seed --persona <id>` flips `memory_seed_applied` back to false, triggering re-seed on the next session_start. Useful when persona content updates.

---

## 12. Persistence triggers (Phase 3 additions to spec §3.5)

| Trigger | What writes |
|---|---|
| User turn arrives | `MemoryRecorder.recordTurn` → Layer B drawer (`kind:'turn'` or `'paste'`) |
| Cell completes FileCollector load | Scratchpad → `MemoryRecorder.recordFileLoad` → Layer B drawer (`kind:'file_load'`) |
| LLM calls `memorize` | Layer A markdown file rewritten atomically |
| LLM calls `recall` | Read-only; audit record only |
| Session start | Layer A read + context injection; persona seed applied if pending |
| Session shutdown | SQLite WAL checkpoint (cheap, ensures clean handoff) |
| `/memory note <text>` | Same as `memorize` lesson |
| `/memory clear --wing` | Bulk delete + audit |

### 12.1 Crash semantics

- Layer B: SQLite WAL keeps committed transactions durable. Per-turn writes commit immediately. A crash mid-write rolls back the partial transaction; nothing is half-stored.
- Layer A: atomic `.tmp` + rename for every write. Crash during write leaves the previous valid file untouched.
- `workspace.json`: same atomic write pattern.

---

## 13. Error taxonomy

| Error | Trigger | User-facing message |
|---|---|---|
| `MemoryNotInitialized` | Memory bundle constructor failed (corrupted workspace.json, unwritable dir) | `Memory not initialized: <reason>. /memory status to inspect.` |
| `BackendUnavailable` | SQLite open or schema bootstrap failed | `Memory backend unavailable: <reason>.` |
| `DrawerKindRejected` | `recordTurn` etc. receive a kind not in the closed vocabulary | `Drawer kind '<k>' is not in v1 vocabulary. Allowed: turn, paste, file_load, ticket, email, rca, note.` |
| `LayerAWriteBlocked` | SecretScanner hit during memorize / persona-seed copy | `Refused to store: contains secret-shaped value (<kind>). Remove the secret and retry. Vault entries should land in /connect.` |
| `RecallQueryMalformed` | Empty query, invalid wing/room shape | `Bad recall query: <reason>.` |
| `MemoryEntryMalformed` | Layer A markdown failed frontmatter parse | `Layer A file <path> is malformed: <reason>. Move it aside and re-create.` |

---

## 14. Edge cases

- **Workspace.json corrupted:** falls back to path-hash for wing; logs a warning. The corrupted file is moved to `workspace.json.broken-<ts>`; a fresh one is written with the path-hash id. `memory_seed_applied` is reset to false (idempotent on benign personas, but could re-trigger seed copy — accepted because users almost never see this case).

- **Layer A file edited externally while session is running:** memorize reads-then-writes the file. If the file changes between read and write (rare), the user's external edit is preserved AND the new memorize entry is appended; conflict is "additive last-writer-wins" which suits append semantics. profile/rules use the same pattern — last writer wins. (A lockfile would tighten this; deferred until a user actually reports a collision.)

- **Layer B DB locked by another process:** SQLite returns SQLITE_BUSY. We retry with exponential backoff (3 attempts at 50ms, 200ms, 500ms); if still busy, the write fails with `BackendUnavailable`. Audit emits `backend-unavailable` event for observability.

- **Recall query contains FTS5 special characters** (`"`, `*`, `(`, `)`, `:`, `^`, etc.): Escape via wrapping in `""` and doubling internal quotes. Multi-word queries become phrase-or-OR: `"foo bar" OR foo OR bar`. Documented in the tool description for the LLM.

- **Empty wings/rooms in recall**: filter omitted = "any". An explicit `wing: ''` is rejected as malformed.

- **Drawer content over FTS5 limit (1 MB per row)**: rejected with `MemoryEntryMalformed`. Spec §3.4b output-spill (artifact://) handles large cell stdout; user pastes >1MB are rejected with a hint to attach as a file via `inputs/`.

- **Concurrent recall during a write:** SQLite WAL supports concurrent readers and one writer. No locking issues.

- **No persona active when seeding:** no seed is copied; `memory_seed_applied` stays false until a persona activates and the next session_start runs.

- **Workspace scoped to a root-level dir** (e.g., `/`): rejected at `WorkspaceId.resolve()` with an error; user must `cd` into a real project directory. (Matches Phase 1 / Phase 2 workspace detection behavior.)

---

## 15. Testing strategy

### 15.1 Unit tests (node:test + node:assert/strict)

| Module | Test focus |
|---|---|
| `types.test.ts` | DrawerKind narrowing; closed-vocab validation |
| `errors.test.ts` | Six classes carry args; name set; messages contain identifier |
| `workspace-id.test.ts` | Creates workspace.json on first call; idempotent on second; fallback to path-hash on corruption; basename + 6-hex format |
| `scope-resolver.test.ts` | Each of three modes returns correct write wing + read wings; per-project-tagged includes global |
| `paste-detector.test.ts` | Triple-backtick triggers paste; length ≥ 500 triggers; > 10 newlines triggers; short single-line returns 'turn' |
| `layer-a-store.test.ts` | Frontmatter round-trip; append-only lessons preserves chronological order; replace-in-place profile/rules; atomic write (orphan .tmp cleanup); SecretScanner block before write |
| `local-sqlite-backend.test.ts` | Schema bootstrap idempotent; WAL pragma applied; retain + recall round-trip; BM25 ordering correct; FTS5 snippet returns `<mark>` tags; trigger sync (insert/update/delete); status/listWings/listRooms/clear; SQLITE_BUSY retry |
| `memory-recorder.test.ts` | recordTurn → paste detect → drawer write; recordFileLoad metadata; SecretScanner redact path emits audit + sets redacted:true; agent text rejection |
| `persona-seed.test.ts` | One-shot copy on first call; idempotent on second; flag flips; secret-bearing persona file blocks but other files proceed; re-seed via flag reset |
| `recall-formatter.test.ts` | Markdown block format; `<mark>` highlights preserved; empty results returns empty block, not error |
| `context-injection.test.ts` | Priority ordering profile > rules > lessons; workspace overrides global; token-limit truncation drops lowest-priority first; empty case returns empty block |

### 15.2 Integration test

`packages/coworker-memory/tests/memory-integration.test.ts` (new):
- Full cycle: createMemoryBundle → recordTurn → recall → results match content.
- Cross-pillar: a fake scratchpad calls recordFileLoad; recall by `kind:'file_load'` returns the drawer.
- Layer A → context injection: memorize three lessons; build context; assert block contains all three in chronological order.
- Persona seed → memorize: fake persona with `memory-seed/lessons.md`; first session_start applies; second is no-op.
- Day-2 milestone: setup A writes paste at T0; tear down; setup B (fresh process) opens same workspace; recall returns the paste verbatim.

### 15.3 Smoke (manual, documented as Phase 3 acceptance)

- `/memory note "MTTR target is 30 minutes for P1"` → lesson lands in `lessons.md`.
- Paste a 600-char fake incident ticket → drawer with `kind:'paste'` appears.
- Otto recalls "MTTR" → returns the lesson.
- Otto recalls "incident" → returns the paste.
- Try memorize'ing a string containing `AKIAABCDEFGHIJKLMNOP` → BlockedError; hint suggests `/connect`.
- Paste a string with the same fake AWS key → drawer written with `redacted:true`; recall finds it (because surrounding context is preserved).
- `/memory status` shows current workspace_wing + drawer_count.

---

## 16. Milestone (Phase 3 acceptance)

Day-2 verbatim recall on a clean Otto checkout with no existing memory state:

1. **Monday 10am:** start Otto in a workspace. Paste a multi-line incident ticket including the line *"customer says the load balancer started returning 503s around 14:00 UTC"*.
2. Verify: `<workspace>/.otto/memory/layer-b.db` exists; one row with kind=`paste`; recall("load balancer") returns it.
3. **Exit Otto.** Wait. (In a test, simulate by closing + relaunching; in human test, do the workflow over a real day.)
4. **Tuesday 2pm:** start Otto in the same workspace.
5. Ask Otto: *"What did the customer say about the load balancer?"*
6. Verify: Otto's response cites the exact words from Monday's paste, with a `drawer://` reference. Audit log shows the `recall` action.
7. `/memory status` shows drawer_count ≥ 1, workspace_wing equals the workspace.json id.

Plus the smoke checklist (§15.3) clean across all items.

---

## 17. Explicitly out of scope for Phase 3

- **Layer C — knowledge graph** (entities, edges, aliases, `entity_query`, `entity_assert`, auto-merge, disambiguation thresholds). Phase 5.
- **ACC** (Associative Content Classifier) — content categorization and auto-write decisions. Phase 5.
- **Cerebellum** — cell-error diff → lesson distillation. Phase 5.
- **Consolidator** — two-phase background pipeline producing `MEMORY.md`, `memory_summary.md`, `skills/`. Phase 5.
- **Weekly digest UX** — keep/drop curation surface. Phase 5.
- **`entity_query` / `entity_assert` LLM tools** — Phase 5.
- **Vector embeddings / hybrid recall** (LanceDB, semantic recall). Out-of-scope per spec §9; backend interface accepts `embeddings` field for v2 forward-compat but `LocalSqliteBackend.recall` ignores it.
- **HostedBackend, LanceDbHybridBackend** — backend interface designed for them; only `LocalSqliteBackend` implemented in v1.
- **`memory://` URI resolver beyond `memory://drawer/<id>` for citation** — full `memory://root/MEMORY.md` (consolidator output) is Phase 5.
- **Cross-workspace memory federation** (team memory). Out-of-scope per spec §9.
- **Global Layer B** (cross-workspace verbatim bank). Per-project-tagged reads only the workspace DB; global wing in tagged mode is satisfied from Layer A markdown only, not a separate Layer B DB. v2.
- **`/memory recall` interactive search** — the LLM tool covers this surface.
- **Auto-retention of agent responses** — v1 retains user input only.
- **`retainEveryNTurns` config knob** — dropped (incompatible with verbatim semantics).
- **Layer A per-workspace scope override** — single config knob, no per-workspace.
- **Layer A digest curation** — Phase 5.

---

## 18. Dependencies and follow-ups

**Depends on:** Phase 0 (memory package shell + types; SecretScanner; AuditLog from Phase 2; persona infrastructure for memory-seed), Phase 1 (workspace detection pattern; scratchpad currentName for room derivation; FileCollector for file_load drawers).

**Soft coupling to Phase 2:**
- AuditLog is in `@otto/coworker-utils` (Phase 2 Task 1). Phase 3 is the third producer (`memory`) after `vault` and `secret-scanner`.
- The `/audit` reader (Phase 2 Task 11) automatically surfaces memory records via `--producer memory`. No changes needed to `/audit`.

**Phase 3 follow-ups** (post-merge):
- Roadmap: mark Phase 3 complete; note the deferred items (Layer C, ACC, Cerebellum, Consolidator) live in Phase 5.
- Phase 4 (artifacts) will use `memory://drawer/<id>` for citations from artifact provenance.
- Phase 5 will fill in: entity tables, ACC observer, Cerebellum distillation, Consolidator, weekly digest. The `MemoryBackend` interface in this spec includes Layer C method names as optional → null returns for Phase 3, real impls in Phase 5.
- `better-sqlite3` is the SQLite binding choice for Node — investigate availability in the monorepo before plan-writing (DuckDB is already in use via `@duckdb/node-api`; SQLite is a different binding).
