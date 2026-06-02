# Phase 2 — otto-vault design

**Status:** approved (brainstorming complete, awaiting writing-plans).
**Date:** 2026-06-01.
**Parent spec:** `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` (§2.2, §3.3, §3.6).
**Roadmap entry:** `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` (Phase 2).
**Scope:** graduate `@otto/coworker-vault` from `export {}` stub to credential storage with safe kernel handoff.

---

## 1. Goal

Ship the credential pillar so that:

> `/connect jira prod` stores creds → `/sp new p1-1234 --use jira:prod` spawns a kernel with `OTTO_DS_JIRA_PROD__URL`, `OTTO_DS_JIRA_PROD__EMAIL`, `OTTO_DS_JIRA_PROD__TOKEN` in its environment → a cell calls the Jira REST API using `process.env.OTTO_DS_JIRA_PROD__*`.

Secondary outcome: every credential write, read, inject, and SecretScanner redaction is recorded to a shared audit log readable via `/audit`.

---

## 2. Decisions locked during brainstorming

| Topic | Decision | Why |
|---|---|---|
| Threat model boundary | **Laptop-trust + audit log.** chmod-600 + atomic writes; rely on FileVault/BitLocker for disk-at-rest. Every vault operation audited. | NOC laptops are corp-encrypted by policy; OS keychain integration remains out-of-scope (spec §9); audit log gives compliance answer to "who read X when?" without expanding crypto surface in week 4. |
| Audit surface | **Top-level `/audit` slash command, shared sink.** | Multiple future producers (vault, secret-scanner, memory in Phase 3, consolidator in Phase 5) all write to one sink. Cheaper to centralize now than migrate from a vault-only `/connect audit` later. |
| Kernel handoff binding declaration | **Explicit per-scratchpad bindings in `meta.json`.** `/sp new --use jira:prod`; `/sp use` / `/sp unuse` mutate post-hoc. | Matches spec's static-spawn model; gives auditable list per kernel; plays well with `/sp fork` (forked kernel inherits binding list); avoids implicit "active scratchpad inherits whatever you /connect'd" coupling. |
| Storage resolution | **Workspace-first per-entry shadow.** | Multi-tenant NOC analysts (workspace = customer) want shared Datadog + per-customer ServiceNow. All-or-nothing per workspace is too coarse; defer-to-later means a backfill migration. |
| Engine YAML schema | **Minimal flavor (id, label, fields[]); JIRA only seed.** Forward-compatible with future `test:` block. | Roadmap milestone is "creds stored → cell hits API", not "vault validates before storing". Generic HTTP smoke-test runner is its own Phase 2.5 effort. |
| SecretScanner integration | **Output-only redaction.** Cell stdout/stderr scanned before journal write; live TUI shows real value; audit records every redaction. No input scanning. | Matches roadmap's "prevent leaks back into the cell journal" framing literally. Avoids false-positive blocking failure mode. Input scanning is naturally Phase 5's problem (consolidator output). |

---

## 3. Architecture

### 3.1 Package additions

```
packages/coworker-vault/src/
  index.ts                ← public exports
  data-vault.ts           ← LocalDataVault: read/write per-entry JSON, chmod 600,
                            atomic .tmp+rename, workspace-first resolution
  engine-registry.ts      ← parse engines/*.yaml, zod-validate, expose Engine type
  injector.ts             ← CredentialInjector: builds OTTO_DS_* env from binding list
  vault-keep.ts           ← VAULT_KEEP sentinel constant + sentinel-aware merge
  slash-connect.ts        ← /connect interactive wizard
  slash-datasource.ts     ← /datasource list|edit|remove|test (test is name-preview only in v1)
  engines/jira.yaml       ← only seeded engine for v1
  errors.ts               ← named error classes

packages/coworker-utils/src/
  audit-log.ts            ← NEW: shared sink at ~/.otto/audit.jsonl

apps/otto-cli/src/cli/slash/
  audit.ts                ← /audit reader (multi-producer surface, not in vault package)
```

### 3.2 Module responsibilities

- **`LocalDataVault`** — owns the bytes on disk. Per-entry JSON files at `<scope>/.otto/data_vault/<engine>-<name>.json`. Atomic writes via `.tmp` + rename. chmod 600 enforced on every write. Maintains `_last_modified.json` sidecar for fast staleness checks at kernel spawn time.

- **`EngineRegistry`** — loads YAML from three locations (builtin, `~/.otto/engines/`, `<workspace>/.otto/engines/`), validates with zod, exposes `get(id)`. Slug collision: later location wins; load-time conflicts emit `engine-resolved` audit records.

- **`CredentialInjector`** — translates a binding list like `['jira:prod', 'datadog:prod']` into an `OTTO_DS_*` env block. Pure function over inputs: vault entries + engine YAMLs + binding list → env. Emits one audit `inject` record per binding, with field *names* only.

- **`VAULT_KEEP` sentinel** — exported constant string `[VAULT_KEEP]` (literal, including brackets). The wizard pre-fills secret-field prompts with this string on edit; submitting the prompt unchanged preserves the stored value verbatim; submitting any other value (including empty for an optional field) replaces it. Never accepted as a *new* stored value — `/connect` rejects literal `[VAULT_KEEP]` in create-mode field input.

- **`AuditLog`** (in `@otto/coworker-utils`) — append-only JSONL at `~/.otto/audit.jsonl`, rotation at 10 MB via short flock, max 5 rotated tails. Single sink for multiple producers — Phase 2 ships `producer: 'vault'` and `producer: 'secret-scanner'`; Phase 3+ adds `'memory'`, `'consolidator'`.

- **Scratchpad integration** — six touch points in `@otto/coworker-scratchpad`:
  1. `meta.json` schema gains `bindings: string[]` (forward-compatible with existing files).
  2. `ScratchpadManager.create` accepts `bindings` option.
  3. `ChildProcessRuntime.spawn` calls `vault.injectEnv` before `child_process.spawn`.
  4. `kernel-bindings.ts` cell-output handler runs `SecretScanner.redact` before journal write.
  5. `/sp use` and `/sp unuse` mutate `meta.bindings`.
  6. `/sp fork` copies `meta.bindings`. `/sp list` adds a binding-count column.

### 3.3 Cross-package contracts

This phase implements `CredentialInjector` from spec §2.6 with minor refinements:

```typescript
class CredentialInjector {
  constructor(private vault: LocalDataVault, private audit: AuditLog) {}

  async injectEnv(
    baseEnv: NodeJS.ProcessEnv,
    bindings: string[],
    ctx: { scratchpadName: string; sessionId: string; pid: number }
  ): Promise<NodeJS.ProcessEnv>;

  // For Phase 3+ host-side bound clients. v1 returns null for every service.
  loadForBinding(serviceName: string): Promise<null>;
}
```

`injectEnv` differs from spec §2.6 only by being `async` (vault reads are async) and by taking a context object so audit records carry session metadata. Forward-compatible.

---

## 4. On-disk layout

```
~/.otto/
  data_vault/
    <engine>-<name>.json                ← chmod 600; one file per entry
    _last_modified.json                 ← {entryRef: ISO-8601} sidecar
  engines/
    *.yaml                              ← user-global engine overrides (optional)
  audit.jsonl                           ← shared sink (NOT just vault)
  audit.1.jsonl ... audit.5.jsonl       ← rotated tails (max 5)

<workspace>/.otto/                       ← workspace lookup walks up from CWD to $HOME
  data_vault/
    <engine>-<name>.json                ← workspace override; same chmod, same schema
    _last_modified.json
  engines/
    *.yaml                              ← workspace engine overrides (optional)
```

**Workspace detection:** walk up from CWD until a `.otto/` directory is found, stopping at `$HOME`. First match wins. If none found, only global scope is consulted. This matches Phase 1's workspace detection for `inputs/`.

### 4.1 Per-entry file schema

```json
{
  "_schema": 1,
  "engine": "jira",
  "name": "prod",
  "fields": {
    "url": "https://acme.atlassian.net",
    "email": "user@acme.io",
    "token": "ATATT3xFfGF0..."
  },
  "created_at": "2026-06-01T14:22:18.443Z",
  "last_modified_at": "2026-06-01T14:22:18.443Z"
}
```

### 4.2 Atomic write protocol

`LocalDataVault.set`:

1. Resolve target scope (workspace if `<workspace>/.otto/data_vault/` exists, else global).
2. `mkdir -p` target with mode 0700.
3. Write to `<entry>.json.tmp` with mode 0600.
4. `fs.rename(tmp, final)`.
5. Update `_last_modified.json` via the same pattern.
6. Append audit record `{ producer: 'vault', action: 'set', engine, name, scope, fields_set, ts }`.

Cross-file (entry + sidecar) is not transactional. If process dies between steps 4 and 5, entry is correct but sidecar is stale. Banner becomes advisory (misses a rotation). Acceptable: the banner is UX hint, not a correctness gate; env vars at spawn time always reflect current file contents. Orphan `.tmp` files from a crashed write are logged and removed on next vault open.

### 4.3 Resolution at `vault.get(ref)`

```typescript
vault.get('jira:prod')  // → { url, email, token, ... } or throws VaultEntryNotFound
```

1. Parse ref → `{ engine: 'jira', name: 'prod' }`.
2. Try `<workspace>/.otto/data_vault/jira-prod.json` (if workspace exists).
3. Fall back to `~/.otto/data_vault/jira-prod.json`.
4. Throw `VaultEntryNotFound` with both paths searched.
5. Audit `{ producer: 'vault', action: 'get', engine, name, scope_resolved, ts }`.

---

## 5. Engine YAML

### 5.1 Schema (zod-validated)

```typescript
interface EngineDefinition {
  schema_version: 1;
  id: string;              // matches /^[a-z][a-z0-9-]*$/; used in OTTO_DS_<ID>_<NAME>__<FIELD>
  label: string;
  description?: string;
  fields: EngineField[];
}

interface EngineField {
  name: string;            // matches /^[a-z][a-z0-9_]*$/; uppercased in env var
  label: string;
  secret: boolean;         // redacted in /datasource list; sentinel-eligible on edit; audited on inject
  required: boolean;
  default?: string;        // only for non-secret fields
}
```

Unknown top-level keys (e.g., a future `test:` block) are accepted but ignored. Logged at debug.

### 5.2 Load-time precedence

1. Built-in seeds at `packages/coworker-vault/src/engines/*.yaml`.
2. User-defined at `~/.otto/engines/*.yaml`.
3. Workspace-defined at `<workspace>/.otto/engines/*.yaml`.

Later wins on slug collision. Each resolved engine emits `{ producer: 'vault', action: 'engine-resolved', engine_id, source }` at registry construction.

### 5.3 JIRA seed (the only v1 engine)

`packages/coworker-vault/src/engines/jira.yaml`:

```yaml
schema_version: 1
id: jira
label: Jira
description: Atlassian Jira Cloud / Server via Basic auth (email + API token)
fields:
  - name: url
    label: "Instance URL (e.g. https://yourorg.atlassian.net)"
    secret: false
    required: true
  - name: email
    label: "Atlassian account email"
    secret: false
    required: true
  - name: token
    label: "API token (from id.atlassian.com → Account → Security)"
    secret: true
    required: true
```

Resulting env vars when bound: `OTTO_DS_JIRA_<NAME>__URL`, `OTTO_DS_JIRA_<NAME>__EMAIL`, `OTTO_DS_JIRA_<NAME>__TOKEN`.

---

## 6. Kernel handoff

### 6.1 Env-var naming

```
OTTO_DS_<ENGINE_ID>_<ENTRY_NAME>__<FIELD_NAME>
```

- Engine id, entry name, field name all uppercased.
- Hyphens in engine id and entry name → underscores.
- Field name is `[a-z0-9_]` only (parser-enforced); never contains hyphens.
- `__` (double underscore) between entry name and field name disambiguates "entry name ends in `_FOO`" from "field name is `FOO`".

Examples:
- `jira:prod` field `token` → `OTTO_DS_JIRA_PROD__TOKEN`
- `jira:prod-east-1` field `url` → `OTTO_DS_JIRA_PROD_EAST_1__URL`

### 6.2 Spawn sequence

`ChildProcessRuntime.spawn`:

1. Read `meta.bindings: string[]` from scratchpad `meta.json`.
2. Call `vault.injectEnv(filteredBaseEnv, meta.bindings, ctx)` — returns new env block; `baseEnv` is not mutated.
3. Spawn kernel subprocess with that env. `OTTO_DS_*` exists only inside child; parent never holds these vars.
4. Record `spawn_time` in in-memory runtime handle for staleness checks.
5. Audit `inject` once per binding, with `fields_injected: [...]` field-names-only payload.

### 6.3 Staleness banner

On every `cw_scratchpad exec` before forwarding to kernel:

1. Read `_last_modified.json` for the scratchpad's bindings.
2. If any binding's `last_modified_at > runtime.spawn_time`, emit one-shot banner:
   > `jira:prod was modified 12m ago; this kernel still has the old creds. Use /sp reset to respawn with current values.`
3. Banner is one-shot per (scratchpad, binding, session); tracked in runtime handle, not persisted.

### 6.4 Lifecycle

| Event | Vault action |
|---|---|
| Kernel cold spawn | `injectEnv` runs; audit `inject` per binding |
| Kernel respawn (`/sp reset`) | same as cold spawn; new `spawn_time` |
| Kernel idle-evicted | no vault action (parent never held creds) |
| `/sp use` adds binding | `meta.bindings` updated; banner suggests `/sp reset` |
| `/sp unuse` removes binding | `meta.bindings` updated; banner notes live kernel still has env var until reset |
| Vault entry rotated via `/connect` | `_last_modified.json` updated; banner fires on next exec for bound scratchpads |
| Vault entry removed (`/datasource remove`) | live kernels with the binding keep env var until reset; banner notes this; `meta.bindings` NOT auto-pruned (audit trail) |
| Otto exit | `clearEnv()` defensive no-op (parent is clean by construction) |

### 6.5 `clearEnv()` (revised vs spec §2.2)

Under this design, parent process never sets `OTTO_DS_*`. The original `clearEnv()` purpose (purge at shutdown) is moot. We still ship `clearEnv()` as a defensive no-op safety net: iterates `process.env`, unsets any `OTTO_DS_*` it finds. Called from Otto's exit hook regardless. Logs at warn if it actually unset anything (indicates a bug in injection scoping).

---

## 7. Slash commands

### 7.1 `/connect` — interactive wizard

```
/connect                                  → engine picker → name prompt → field prompts
/connect <engine>                         → name prompt → field prompts
/connect <engine> <name>                  → field prompts (create or edit auto-detected)
/connect <engine> <name> --workspace      → force workspace scope even if entry exists globally
```

Flow:
1. Resolve engine YAML (error if unknown).
2. Detect existing entry at resolved scope.
3. If editing → show `[VAULT_KEEP]` in secret-field prompts; empty for create.
4. Prompt each field in YAML order. Required fields can't be empty. Default values pre-fill when present.
5. On submit:
   - Secret-field value equal to `VAULT_KEEP` AND editing → preserve stored value.
   - Otherwise → use submitted value.
   - Reject `VAULT_KEEP` literal in any create-mode field.
6. Write via `LocalDataVault.set`.
7. Confirmation: `Stored jira:prod (workspace). Use /sp use <scratchpad> jira:prod to attach.`

### 7.2 `/datasource` — manage stored entries

```
/datasource list                         → table: engine, name, scope, fields_set, last_modified
/datasource list --engine jira           → filtered
/datasource edit <engine>:<name>         → alias for /connect <engine> <name> (edit path)
/datasource remove <engine>:<name>       → confirm prompt → delete file + audit
/datasource test <engine>:<name>         → v1: print OTTO_DS_* env-var names that would inject;
                                            no network calls. Forward-compatible with future
                                            test: YAML block.
```

`list` redacts secret-field values to `••••••` (count only). Non-secret values truncated for table fit. Single `list` audit record per invocation, not per row.

### 7.3 `/audit` — shared audit reader

Lives in `apps/otto-cli/src/cli/slash/audit.ts` (not in vault package — it's a multi-producer surface).

```
/audit                                   → last 50 entries, descending ts
/audit --since 1h | 24h | 7d             → time filter
/audit --producer vault                  → producer filter
/audit --producer secret-scanner
/audit --engine jira                     → only records mentioning this engine
/audit --action inject|set|get|remove
/audit --severity warn|info
/audit --json                            → full records as JSONL
```

Renders one line per record:
```
2026-06-01T14:22:18Z  vault       inject      jira:prod          pid=4112  scratchpad=p1-1234
```

Truncates wide fields to terminal width. `--tail` (follow mode) is explicitly **deferred** to Phase 3 to keep Phase 2 scope tight.

---

## 8. SecretScanner integration

`SecretScanner` already exists in `@otto/coworker-utils/secret-scanner.ts`. Phase 2 wires it into the scratchpad's cell-output pipeline.

### 8.1 Where it runs

`packages/coworker-scratchpad/src/kernel-bindings.ts` cell-output handler adds a `redactBeforeJournal` step. Only `cells.jsonl` writes go through the scanner; live TUI stdout is untouched.

### 8.2 Behavior

```typescript
function redactCellOutput(raw: string, ctx: CellContext): string {
  const findings = SecretScanner.scan(raw);
  if (findings.length === 0) return raw;
  for (const f of findings) {
    audit.append({
      _schema: 1,
      ts: new Date().toISOString(),
      producer: 'secret-scanner',
      action: 'redact',
      severity: 'warn',
      sessionId: ctx.sessionId,
      scratchpadName: ctx.scratchpadName,
      pid: ctx.pid,
      detail: { cell_id: ctx.cellId, kind: f.kind, offset: f.start, length: f.length },
    });
  }
  return SecretScanner.redact(raw, findings);  // each finding → '[REDACTED:<kind>]'
}
```

**Never** include the raw value in the audit record. Pattern kind + offset + length only.

### 8.3 Coverage

Phase 2 wires the existing scanner; it does **not** expand pattern coverage. Pattern set (per spec §6.5, already in `secret-scanner.ts`): AWS access keys, Anthropic keys, OpenAI keys, ServiceNow tokens, GitHub PATs, JWTs, generic high-entropy strings.

Artifact spill paths (`artifact://<id>` overflow files written by the scratchpad) are journal-equivalent persistence and route through the same redaction step.

---

## 9. AuditLog details

### 9.1 Record shape

```typescript
interface AuditRecord {
  _schema: 1;
  ts: string;                      // ISO-8601
  producer: string;                // 'vault' | 'secret-scanner' (Phase 3+ adds 'memory', 'consolidator')
  action: string;                  // producer-defined verb
  severity?: 'info' | 'warn';      // default 'info'
  sessionId?: string;
  scratchpadName?: string;
  pid?: number;
  detail: Record<string, unknown>; // producer-defined; NEVER raw secret values
}
```

### 9.2 Vault audit verbs

| `action` | `detail` payload |
|---|---|
| `set` | `{ engine, name, scope, fields_set: [field_names...] }` |
| `get` | `{ engine, name, scope_resolved }` |
| `remove` | `{ engine, name, scope }` |
| `inject` | `{ engine, name, fields_injected: [field_names...] }` |
| `engine-resolved` | `{ engine_id, source: 'builtin'|'user'|'workspace' }` (registry load-time) |
| `list` | `{ filter: { engine?: string } }` |
| `workspace-skipped` | `{ reason: string, path }` (when workspace data_vault unreadable) |

### 9.3 Rotation & concurrency

Sink path: `~/.otto/audit.jsonl`. Rotation on append when ≥ 10 MB:
1. Acquire short `flock` on `~/.otto/audit.lock`.
2. Rename current `audit.jsonl` → `audit.<n>.jsonl` (n = lowest unused integer 1..5).
3. If a rotation would exceed 5 tails, delete `audit.5.jsonl` first with a final `meta` record (`{ producer: 'audit', action: 'tail-deleted', path }`) appended to the new file.
4. Open fresh `audit.jsonl`.
5. Release flock.

Concurrent appends across Otto processes rely on POSIX `O_APPEND` atomicity for record-sized writes (<4 KB) — sufficient for JSONL. Flock guards rotation only.

### 9.4 Failure mode

`AuditWriteFailure` (disk full, permissions, etc.) logs to stderr once per session, then continues. Audit failure must never break a vault operation. SecretScanner failure means: scanner exception → log to stderr, fall back to passing the value through unredacted (better to err on the side of cell completing, since live TUI already exposed it; audit notes the failure).

---

## 10. Error taxonomy

Each is a named class exported from `@otto/coworker-vault/errors`.

| Error | Trigger | User-facing message |
|---|---|---|
| `EngineNotFound` | YAML id not in registry | `Unknown engine: <id>. Available: jira` |
| `EngineValidationError` | YAML schema invalid | Logged at warn at load-time, that engine skipped, not thrown |
| `VaultEntryNotFound` | `vault.get` resolves nothing | `Vault entry not found: jira:prod. Searched: <ws>, <global>. Use /connect jira prod to create.` |
| `VaultEntryMalformed` | JSON parse fails or `_schema` mismatch | `Vault entry corrupt: <path>. Move it aside and re-create with /connect jira prod.` |
| `BindingRefMalformed` | `--use` arg not `<engine>:<name>` | `Bad binding: <input>. Expected <engine>:<name>, e.g., jira:prod` |
| `BindingNotFound` | `injectEnv` can't resolve | Strict (default): refuse spawn, surface to user with `/connect` hint. Loose (`OTTO_VAULT_MISSING_OK=1`): log warn, skip binding, spawn. |
| `WorkspaceVaultUnreadable` | `<ws>/.otto/data_vault/` exists but unreadable | Warn, fall back to global, audit `workspace-skipped` |
| `AuditWriteFailure` | `~/.otto/audit.jsonl` unwritable | Stderr once per session, continue. |

---

## 11. Edge cases worth pinning

- **Concurrent `/connect` writes to same entry from two Otto windows:** atomic-rename means last-writer-wins cleanly. Loser's edits silently disappear; audit shows both `set` actions. Acceptable for v1 (single-analyst-per-vault is the mental model).
- **`/sp fork` while a binding is being modified:** fork copies `meta.bindings` (string list) — instant. Forked kernel resolves bindings on next spawn; whatever's stored at that moment is what it sees.
- **Engine YAML edited at runtime:** no live reload in v1. Reload on next Otto start. Banner if a stored entry's fields are stale vs the new YAML: *"jira:prod has fields [url, email, token]; engine YAML now defines [url, email, token, region]. /connect jira prod to add the new field."*
- **Engine YAML removed while entries exist:** entries persist as orphans. `/datasource list` shows `engine: jira [missing]`. Resolution still works (entry JSON has the data); injection still works (env-var naming is derived from the entry, not the YAML).
- **Field names with hyphens/dots in YAML:** parser rejects (`/^[a-z][a-z0-9_]*$/`). Env-var translation requires underscore-only.
- **Entry name with hyphens** (`jira:prod-east-1`): allowed (`/^[a-z][a-z0-9-]*$/`); hyphens → underscores in env var (`OTTO_DS_JIRA_PROD_EAST_1__URL`).
- **`VAULT_KEEP` typed as a non-secret field value:** allowed (sentinel only meaningful for secret fields).
- **Workspace `data_vault/` exists but is empty:** treated as "no workspace overrides"; falls through to global.

---

## 12. Testing

### 12.1 Unit tests (vitest)

| Module | Focus |
|---|---|
| `data-vault.test.ts` | atomic write round-trip; chmod 600 enforced via stat; workspace-first resolution; `_last_modified.json` correctness; crash-recovery (orphan `.tmp`); concurrent-write last-wins |
| `engine-registry.test.ts` | YAML parsing; schema validation rejects bad shapes; precedence (builtin < user < workspace); JIRA seed loads; unknown top-level keys ignored at debug |
| `injector.test.ts` | env-var naming (case, separators, hyphen→underscore); audit `inject` per binding; strict vs loose missing-binding; baseEnv not mutated; field values pass through unmodified |
| `vault-keep.test.ts` | sentinel preserved on edit secret field; sentinel rejected on create; sentinel ignored for non-secret fields |
| `slash-connect.test.ts` | wizard happy path (create + edit); engine-picker fallback; required-field validation; `--workspace` scope flag |
| `slash-datasource.test.ts` | list table renders; remove confirms; test prints env-var preview |
| `audit-log.test.ts` (in coworker-utils) | append; filter (since, producer, severity, engine, action); rotation at maxBytes; flock prevents double-rotate; tail deletion record |

### 12.2 Integration test

`packages/coworker-scratchpad/tests/vault-integration.test.ts` (new):

- `/sp new --use jira:prod` writes `meta.bindings`; spawn injects `OTTO_DS_JIRA_PROD__*`; cell reads `process.env.OTTO_DS_JIRA_PROD__TOKEN` and gets expected value.
- `/sp use` post-hoc; respawn picks up new binding.
- Stale-binding banner fires after `/connect` edits an in-use entry.
- Cell stdout containing fake API key (matching SecretScanner pattern) → redacted in `cells.jsonl`; live TUI capture shows real value.
- `vault.get` from workspace-scoped entry shadows global entry.

### 12.3 Smoke (manual, documented as Phase 2 acceptance)

`/connect jira <name>` with real Atlassian creds → `/sp new test --use jira:<name>` → cell hits `<url>/rest/api/3/myself` via axios with Basic auth → returns account JSON.

### 12.4 Out of scope for Phase 2 tests

- No live network in unit/integration tests.
- No expansion of `SecretScanner` pattern coverage (lives in `coworker-utils`; Phase 2 verifies integration, not detection patterns).
- No multi-process audit-log contention test (relies on POSIX semantics; covered by manual sanity).

---

## 13. Milestone (Phase 2 acceptance)

A clean Otto checkout with no vault entries:

1. `/connect jira prod` → wizard prompts → entry stored at `~/.otto/data_vault/jira-prod.json` with chmod 600.
2. `/audit --producer vault` shows `set` record.
3. `/sp new test --use jira:prod` → meta.bindings recorded, kernel spawned with `OTTO_DS_JIRA_PROD__*`.
4. Cell: `await axios.get(process.env.OTTO_DS_JIRA_PROD__URL + '/rest/api/3/myself', { headers: { Authorization: 'Basic ' + ... } })` → returns Jira account JSON.
5. `/audit` shows `inject` records.
6. Cell printing `process.env.OTTO_DS_JIRA_PROD__TOKEN` → live TUI shows real value; subsequent `/sp view` of the journaled cell shows `[REDACTED:<kind>]`; `/audit --producer secret-scanner` shows `redact` record.
7. `/connect jira prod` (edit) with `VAULT_KEEP` left in token field → entry's token preserved; `_last_modified.json` updated; next `cw_scratchpad exec` on the bound scratchpad shows staleness banner; `/sp reset` clears banner with fresh `spawn_time`.
8. `/datasource remove jira:prod` → entry file deleted; `/audit` shows `remove` record.

---

## 14. Explicitly out of scope for Phase 2

- OS keychain backends (macOS Keychain, Windows Credential Manager, libsecret). Listed in spec §9; `LocalDataVault` is the only backend in v1.
- App-level encryption of vault entries.
- Engine YAML `test:` block / smoke-test runner. Parser accepts but ignores. Phase 2.5 or Phase 6.
- `/datasource test` actually hitting the API. v1 prints env-var preview only.
- Engine seeds beyond JIRA. Roadmap originally listed ServiceNow, IMAP/Outlook, Datadog, SolarWinds, generic-REST; deferred to follow-up phases. Roadmap text needs updating.
- Cell-input SecretScanner pass. Output-only in v1.
- Multi-channel `/connect` (Slack/web wizard). Terminal interactive only.
- Cross-workspace credential federation.
- Live engine YAML reload.
- `/audit --tail` follow mode. Phase 3 alongside memory producer.
- `loadForBinding` returning actual `BoundClient` instances. Returns `null` for everything in v1; Phase 3+ when host-side clients exist.

---

## 15. Dependencies and follow-ups

**Depends on:** Phase 0 (vault package shell, `SecretScanner` utility, persona infrastructure neutral here), Phase 1 (`ChildProcessRuntime`, `meta.json`, `/sp` command surface — extended, not rewritten).

**Phase 2 follow-ups** (post-merge, scope for future work):
- Promote roadmap entry to "Phase 2 complete; engine seeds for ServiceNow/IMAP/Datadog/SolarWinds/generic-REST moved to Phase 2.5 / Phase 6".
- Update roadmap Phase 2 milestone wording to "`/connect jira <name>` ..." instead of "`/connect servicenow` ...".
- Phase 3 memory writes register `producer: 'memory'` with `AuditLog`.
- Phase 5 consolidator registers `producer: 'consolidator'`.
