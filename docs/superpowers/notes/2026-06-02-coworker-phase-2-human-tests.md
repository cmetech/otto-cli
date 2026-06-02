# Otto Co-worker Vault — Phase 2 Human Test Plan

**Status:** Phase 2 (otto-vault) is on branch `feat/coworker-phase-2-vault` as of 2026-06-02 (367 unit + integration tests green). This document walks every user-facing feature shipped in Phase 2 — credential storage with safe kernel handoff — and lists the scenarios you need to run before merging the branch and tagging.

**Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-2-vault-design.md`. **Plan:** `docs/superpowers/plans/2026-06-01-coworker-phase-2-vault.md`.

**Not covered (Phase 2.1+ deferrals):**
- ~~`/connect`, `/datasource`, `/audit` registration on Otto's slash-command bus through the new `coworker-vault` extension activator. The programmatic APIs (`runConnect`, `runDatasourceList`, `runAudit`, `runDatasourceRemove`, `runDatasourceTest`) are complete and unit-tested; scenarios that require typing the slash form in the TUI assume that small activator wiring task has shipped. Where it hasn't, scenarios call out the script-based equivalent.~~ **[Closed in Phase 3.1 — see 2026-06-02-phase-2-vault-smoke.md activator-landed footnote.]**
- Cross-extension wiring of the staleness banner emission inside `/sp`'s cell-exec path. The `StalenessBanner` helper is built and unit-tested; the integration test (Task 17) verifies the seam. Scenarios 11–12 exercise it via test scripts rather than the TUI.
- Engine YAML `test:` block / smoke-test runner (the YAML parser accepts the field forward-compat; no runner ships in Phase 2).
- ServiceNow, IMAP/Outlook, Datadog, SolarWinds, generic-REST engine seeds — deferred to Phase 2.5 / Phase 6.
- `/audit --tail` (follow mode) — deferred to Phase 3.
- OS keychain backends — out-of-scope per spec §9.

---

## Connection types supported in Phase 2

This is the question worth answering up front: **what auth shapes does the JIRA engine handle today, and what does the vault not yet cover?**

The vault layer (`LocalDataVault` + `CredentialInjector`) is auth-agnostic at the storage level — it stores any name/value pairs and emits them as `OTTO_DS_<engine>_<name>__<field>` env vars in the kernel subprocess. The auth scheme is enforced by **the cell code** that consumes those env vars, not by the vault itself.

What we shipped in Phase 2 is one engine seed (`packages/coworker-vault/src/engines/jira.yaml`) shaped for one concrete auth pattern:

| Auth scheme | Supported by JIRA seed | What it would take to add |
|---|---|---|
| **Atlassian Cloud + API token (Basic auth)** — `Authorization: Basic base64(email:token)` | ✅ Primary path. Token from id.atlassian.com → Account → Security. | — |
| **Jira Server / Data Center + username + password (Basic)** | ⚠️ Works mechanically: enter username in the email field, password in the token field. Field label says "email" so this is awkward but functional. | A second seed `jira-dc.yaml` with `username` and `password` field names. |
| **Jira Server / Data Center + Personal Access Token (Bearer)** — `Authorization: Bearer <PAT>` | ⚠️ Vault stores the PAT, but the example cell code constructs `Basic`, not `Bearer`. User must write their own header. | A second seed `jira-dc-pat.yaml` with `pat` field and a different example cell; or add an optional `auth_hint` YAML field (forward-compat already in place — parser passes through unknown keys). |
| **OAuth 2.0 (3LO, user-on-behalf-of)** | ❌ Not supported. | Real flow implementation: auth-code redirect, callback receiver, refresh-token storage, token-expiry handling. Own phase. |
| **OAuth 2.0 (server-to-server)** | ❌ | Same — needs flow logic. |
| **Atlassian Forge** | ❌ | Forge apps run inside Atlassian's runtime; vault model doesn't apply. |

**Vault capability vs JIRA seed — important distinction:**

- **Vault storage and `OTTO_DS_*` injection:** generic; works for any string-shaped credential (API token, password, PAT, client-secret, anything).
- **Engine YAML schema (Task 4):** name/label/secret/required/default per field; no auth-kind metadata; unknown top-level keys pass through for forward-compat.
- **JIRA seed shipped:** hard-coded to the Atlassian-Cloud-Basic-auth field shape.

**Practical recommendation for first real Jira test:** use Atlassian Cloud + API token. Anything else means writing custom cell code that constructs a different header. The smoke checklist scenarios assume Cloud + token.

---

## Setup

Before starting:

```bash
# Branch
git checkout feat/coworker-phase-2-vault

# Build everything (vault, scratchpad, extensions)
cd packages/coworker-utils && npm run build && cd ../..
cd packages/coworker-vault && npm run build && cd ../..
cd packages/coworker-scratchpad && npm run build && cd ../..

# Verify vault build copied the JIRA seed YAML to dist/
ls packages/coworker-vault/dist/engines/jira.yaml

# (Optional) Clear pre-existing vault and scratchpads to start clean
rm -rf ~/.otto/data_vault/ ~/.otto/audit.jsonl ~/.otto/audit.*.jsonl ~/.otto/scratchpads/

# Have ready: Atlassian Cloud URL + email + API token from id.atlassian.com.
```

**Disk layout reference — peek here any time:**

```
~/.otto/
  data_vault/                                 USER-GLOBAL credential entries
    <engine>-<name>.json                      chmod 600 atomic JSON
    _last_modified.json                       sidecar for staleness checks
  engines/                                    OPTIONAL user-global engine YAML overrides
    *.yaml
  audit.jsonl                                 shared sink (vault + secret-scanner)
  audit.1.jsonl … audit.5.jsonl               rotated tails (10MB cap each, max 5)

<workspace>/.otto/
  data_vault/                                 WORKSPACE override (shadows global)
    <engine>-<name>.json
    _last_modified.json
  engines/                                    OPTIONAL workspace engine overrides
    *.yaml
```

**Programmatic API entry points** (for scenarios that need to bypass the deferred slash-command wiring):

```typescript
import { createVaultBundle } from 'src/resources/extensions/coworker-vault/vault-singleton.js';
import { runConnect } from 'src/resources/extensions/coworker-vault/connect-command.js';
import { runDatasourceList, runDatasourceRemove, runDatasourceTest }
  from 'src/resources/extensions/coworker-vault/datasource-command.js';
import { runAudit } from 'src/resources/extensions/coworker-vault/audit-command.js';
```

---

## Scenario 1 — `/connect` creates an entry (atomic write + chmod 600 + audit)

**Goal:** First-time entry creation lands on disk with correct mode and emits the audit `set` record.

**Phase coverage:** Task 5 (LocalDataVault), Task 9 (runConnect wizard), Task 1 (AuditLog).

**If the slash command is wired:**
```
/connect jira prod
```
Wizard prompts URL, email, API token in order.

**If the slash command is not yet wired** (deferred per Phase 2.1), run an equivalent script in the repo:
```typescript
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createVaultBundle } from 'src/resources/extensions/coworker-vault/vault-singleton.js';
import { runConnect } from 'src/resources/extensions/coworker-vault/connect-command.js';

const bundle = await createVaultBundle({ globalDir: join(homedir(), '.otto') });
await runConnect(bundle, {
  engineId: 'jira', entryName: 'prod', forceWorkspace: false,
  promptProvider: async (field) => {
    if (field === 'url')   return 'https://YOURORG.atlassian.net';
    if (field === 'email') return 'you@yourorg.com';
    if (field === 'token') return 'ATATT3xFf...your-token...';
    return '';
  },
});
```

**Disk checks:**
```bash
ls -l ~/.otto/data_vault/jira-prod.json        # mode -rw------- (0600)
cat ~/.otto/data_vault/jira-prod.json | jq .   # _schema:1, engine:'jira', name:'prod', fields.{url,email,token}, created_at, last_modified_at
cat ~/.otto/data_vault/_last_modified.json     # {"jira:prod":"<ISO ts>"}
tail -1 ~/.otto/audit.jsonl | jq               # producer:'vault', action:'set', detail.fields_set:['url','email','token']
```

**Pass criteria:**
- File mode is exactly `0o600`.
- `_schema` is 1.
- Audit `detail.fields_set` is the list of field NAMES — no values.
- Sidecar entry exists for `jira:prod`.

---

## Scenario 2 — `/connect` edit flow preserves the secret via `VAULT_KEEP`

**Goal:** Re-running `/connect` on an existing entry pre-fills secret fields with `[VAULT_KEEP]`; submitting unchanged preserves the stored value; submitting a real value replaces it.

**Phase coverage:** Task 3 (VAULT_KEEP sentinel + mergeWithSentinel), Task 9 (runConnect edit path).

**Setup:** Scenario 1 has run (jira:prod exists).

**Test edit flow (preserve token):**
```typescript
await runConnect(bundle, {
  engineId: 'jira', entryName: 'prod', forceWorkspace: false,
  promptProvider: async (field, { defaultValue }) => {
    // Simulate "user presses Enter, accepts default"
    return defaultValue ?? '';
  },
});
```

**Pass criteria:**
- Stored token value before and after edit is identical (read `~/.otto/data_vault/jira-prod.json`).
- New audit `set` record exists with `last_modified_at` advanced.
- `_last_modified.json` updated.

**Test edit flow (replace token):**
Re-run with `promptProvider` returning `'NEW_TOKEN_VALUE'` for `token`.

**Pass criterion:** Stored token is `NEW_TOKEN_VALUE`.

**Test sentinel-in-create rejection:**
```typescript
// Fresh entry; user types the literal "[VAULT_KEEP]" as token
await runConnect(bundle, {
  engineId: 'jira', entryName: 'new-test', forceWorkspace: false,
  promptProvider: async (field) => field === 'token' ? '[VAULT_KEEP]' : 'x',
}).catch(err => console.log('rejected:', err.message));
```

**Pass criterion:** Error message contains `VAULT_KEEP is reserved`.

---

## Scenario 3 — Required-field validation

**Goal:** Empty required fields error cleanly.

**Phase coverage:** Task 9 (runConnect required check).

```typescript
await runConnect(bundle, {
  engineId: 'jira', entryName: 'empty-test', forceWorkspace: false,
  promptProvider: async (field) => field === 'url' ? '' : 'x',
}).catch(err => console.log(err.message));
```

**Pass criterion:** Error message matches `/required/i` and names `url`.

---

## Scenario 4 — `/sp new --use jira:prod` persists bindings; cell reads `OTTO_DS_*`

**Goal:** End-to-end happy path — create a bound scratchpad, kernel spawns with env vars, cell reads them.

**Phase coverage:** Task 12 (meta.json `bindings`), Task 13 (env injection on spawn), Task 16 (`--use` flag on `/sp new`).

```
/sp new rca-test --use jira:prod
```

Then ask Otto:
> *"Use cw_scratchpad: `return { url: process.env.OTTO_DS_JIRA_PROD__URL, has_token: !!process.env.OTTO_DS_JIRA_PROD__TOKEN };`"*

**Disk checks:**
```bash
cat ~/.otto/scratchpads/rca-test/meta.json | jq '.schema_version, .bindings'
# schema_version: 4, bindings: ["jira:prod"]
```

**Audit check:**
```bash
grep '"action":"inject"' ~/.otto/audit.jsonl | tail -1 | jq
# detail: { engine:'jira', name:'prod', fields_injected:['url','email','token'] }
# No raw token value anywhere in the record.
```

**Pass criteria:**
- Cell returns `{ url: 'https://YOURORG.atlassian.net', has_token: true }`.
- meta.json carries `bindings: ['jira:prod']` and `schema_version: 4`.
- Audit `inject` record carries field NAMES only.
- Parent `process.env.OTTO_DS_JIRA_PROD__*` is NOT set — only the kernel subprocess sees it. Verify:
  ```bash
  # Inside Otto, in a NON-cell context (e.g., a parent-process script):
  node -e "console.log(Object.keys(process.env).filter(k=>k.startsWith('OTTO_DS_')))"
  # Should print []
  ```

---

## Scenario 5 — End-to-end real Jira API call

**Goal:** Cell hits the actual Jira REST API using the injected creds. Requires real Atlassian Cloud creds from Scenarios 1–4.

**Phase coverage:** Full Phase 2 stack.

Ask Otto:
> *"Use cw_scratchpad to call Jira and return my user profile."*

Or paste explicit cell code:

```js
const url = process.env.OTTO_DS_JIRA_PROD__URL;
const email = process.env.OTTO_DS_JIRA_PROD__EMAIL;
const token = process.env.OTTO_DS_JIRA_PROD__TOKEN;
const auth = Buffer.from(`${email}:${token}`).toString('base64');
const r = await axios.get(`${url}/rest/api/3/myself`, {
  headers: { Authorization: `Basic ${auth}` },
});
return { accountId: r.data.accountId, displayName: r.data.displayName, email: r.data.emailAddress };
```

**Pass criterion:** Returns your real Jira account JSON. If you get 401, the token in the vault is wrong — re-run Scenario 2 with the correct one.

---

## Scenario 6 — SecretScanner redacts secrets in the journal but NOT in the live result

**Goal:** A cell that prints a secret-shaped string shows the real value in the live TUI (so the analyst can debug) but the persisted `cells.jsonl` has it redacted. Audit records the redaction event with field names only — never the value or preview.

**Phase coverage:** Task 14 (SecretScanner integration), `redactForJournal` in kernel-bindings.

```
/sp new t06-redaction
```

Ask Otto:
> *"Use cw_scratchpad: `console.log('leaked AKIAABCDEFGHIJKLMNOP'); return 1;`"*

**Live check:** Otto's TUI shows the actual `AKIAABCDEFGHIJKLMNOP` string in the cell output.

**Journal check:**
```bash
cat ~/.otto/scratchpads/t06-redaction/cells.jsonl | jq 'select(.id==1) | .stdout'
# Should contain "[REDACTED:aws_access_key_id]" and NOT the original AKIA string.
```

**Audit check:**
```bash
grep '"producer":"secret-scanner"' ~/.otto/audit.jsonl | tail -1 | jq '.detail'
# { cell_id: 1, kind: "aws_access_key_id", offset: <int>, length: <int> }
# NO "value" field. NO "preview" field.
```

**Important contract observation:** The cell's `code` field in `cells.jsonl` preserves the original source verbatim (`console.log('leaked AKIAABCDEFGHIJKLMNOP')`). Phase 2 redaction covers `stdout` and `error.message` only — code is intentionally preserved for reproducibility. If your threat model requires code redaction too, that's a Phase 2.x extension.

**Pass criteria:**
- Live TUI: shows raw secret.
- `cells.jsonl` stdout: `[REDACTED:aws_access_key_id]`.
- Audit `redact` record has kind/offset/length only.

---

## Scenario 7 — `/sp use` and `/sp unuse` mutate bindings idempotently

**Goal:** Post-hoc binding mutation works without re-creating the scratchpad. Idempotent.

**Phase coverage:** Task 16 (`/sp use` / `/sp unuse`, `ScratchpadManager.addBinding` / `removeBinding`).

```
/sp new t07-binds
/sp use t07-binds jira:prod
```

Expected message: `binding added: jira:prod → t07-binds. /sp reset to inject into the live kernel.`

```
/sp use t07-binds jira:prod         # idempotent: re-add
```

Expected: `binding already present`.

```
/sp unuse t07-binds jira:prod
```

Expected: binding removed.

```
/sp unuse t07-binds jira:prod        # idempotent: re-remove
```

Expected: `binding not present`.

**Disk check:**
```bash
cat ~/.otto/scratchpads/t07-binds/meta.json | jq '.bindings'
# After add: ["jira:prod"]
# After remove: []
```

**Malformed ref check:**
```
/sp use t07-binds jira/prod
```

Expected: error message names the expected `engine:name` format.

---

## Scenario 8 — `/sp list` shows binding count

**Goal:** `/sp list` output reports the number of bindings per scratchpad.

**Phase coverage:** Task 16 (`/sp list` column).

```
/sp new t08a --use jira:prod
/sp new t08b
/sp list
```

Expected: t08a row shows `uses:1` (or whichever format the implementation uses); t08b row shows no binding marker (or `uses:0`).

**Pass criterion:** Row for t08a shows binding count of 1; row for t08b shows zero or hidden.

---

## Scenario 9 — `/sp fork` copies bindings

**Goal:** Forked scratchpad inherits the source's bindings.

**Phase coverage:** Task 16 (ScratchpadManager.fork bindings inheritance).

```
/sp new t09-src --use jira:prod
/sp fork t09-src t09-dst
```

**Disk check:**
```bash
cat ~/.otto/scratchpads/t09-dst/meta.json | jq '.bindings'
# ["jira:prod"]
```

**Pass criterion:** Destination meta.bindings equals source's.

---

## Scenario 10 — `/sp reset` preserves bindings (and clears the staleness banner)

**Goal:** Resetting a scratchpad's kernel does NOT drop its vault bindings, and does clear staleness-banner state.

**Phase coverage:** Task 16 (bindings preservation on reset + StalenessBanner.resetForRespawn).

```
/sp new t10-reset --use jira:prod
# attach and run a cell so a kernel exists
/sp reset t10-reset
cat ~/.otto/scratchpads/t10-reset/meta.json | jq '.bindings'
# Still ["jira:prod"]
```

**Pass criterion:** bindings array survives reset.

---

## Scenario 11 — Staleness banner fires after vault rotation

**Goal:** Editing the vault entry while a kernel is alive causes the next cell exec to surface a banner mentioning the stale binding and `/sp reset`.

**Phase coverage:** Task 6 (sidecar lookupLastModified), Task 15 (StalenessBanner.check).

**Direct test (the cross-extension wiring is deferred — exercise via the helper directly):**

```typescript
import { StalenessBanner } from '@otto/coworker-scratchpad';
import { createVaultBundle } from 'src/resources/extensions/coworker-vault/vault-singleton.js';

const bundle = await createVaultBundle({ globalDir: join(homedir(), '.otto') });
const sb = new StalenessBanner();

// Suppose runtime.spawnTime was at some past time T0:
const spawnTime = new Date('2026-06-02T10:00:00Z');

// Rotate the vault entry:
await bundle.vault.set({ engine: 'jira', name: 'prod' }, {
  url: '...current...', email: '...', token: '...rotated...',
});

const banner = await sb.check({
  scratchpadName: 't11', sessionId: 'sess-1',
  bindings: ['jira:prod'], spawnTime,
  lookupLastModified: (ref) => bundle.vault.lookupLastModified(ref),
});
console.log(banner);
// Output: "jira:prod was modified after this kernel was spawned; env vars are stale. Run /sp reset to respawn with current values."
```

**Pass criteria:**
- Banner is non-null after rotation.
- String contains `jira:prod` and `/sp reset`.
- Second `sb.check(...)` with the same args returns `null` (one-shot per session+ref).

---

## Scenario 12 — Staleness banner does NOT re-fire after `/sp reset`

**Goal:** After a kernel respawn, the banner's new spawnTime is ahead of the rotated `last_modified_at`, so the staleness condition no longer holds.

**Phase coverage:** Task 15 (resetForRespawn semantics).

Continuing from Scenario 11:

```typescript
sb.resetForRespawn('t11');
const newSpawnTime = new Date();  // post-respawn

const banner = await sb.check({
  scratchpadName: 't11', sessionId: 'sess-1',
  bindings: ['jira:prod'], spawnTime: newSpawnTime,
  lookupLastModified: (ref) => bundle.vault.lookupLastModified(ref),
});
console.log(banner);  // null
```

**Pass criterion:** Banner is null.

---

## Scenario 13 — Workspace vault shadows global vault

**Goal:** A workspace-scoped entry overrides a global one for the same engine:name. Falls back to global when the workspace entry is absent.

**Phase coverage:** Task 6 (workspace-first resolution).

```typescript
import { LocalDataVault, AuditLog } from '@otto/coworker-utils';  // AuditLog actually from utils

const root = '/tmp/vault-shadow-' + Date.now();
const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
const vault = new LocalDataVault({
  globalDir: join(root, 'home'),
  workspaceDir: join(root, 'ws'),
  audit,
});

// Write a global entry (forceWorkspace omitted, but if wsDir already exists vault.set defaults to workspace)
// Easier: write the global one directly to bypass writeScope:
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync(join(root, 'home', 'data_vault'), { recursive: true });
writeFileSync(join(root, 'home', 'data_vault', 'jira-prod.json'), JSON.stringify({
  _schema: 1, engine: 'jira', name: 'prod', fields: { url: 'GLOBAL' },
  created_at: '2026-06-01T00:00:00Z', last_modified_at: '2026-06-01T00:00:00Z',
}, null, 2), { mode: 0o600 });

// Write workspace entry via forceWorkspace
await vault.set({ engine: 'jira', name: 'prod' }, { url: 'WORKSPACE' }, { forceWorkspace: true });

const got = await vault.get({ engine: 'jira', name: 'prod' });
console.log(got.fields.url);  // "WORKSPACE"
```

**Pass criterion:** Resolved value is `WORKSPACE`.

**Fallback test:** Remove the workspace entry file; re-run `vault.get`. Pass criterion: returns `GLOBAL`.

---

## Scenario 14 — `/datasource list` masks secret fields

**Goal:** Listing entries renders secret fields as `••••••`; non-secret fields show truncated stored values.

**Phase coverage:** Task 10 (runDatasourceList).

```typescript
const rows = await runDatasourceList(bundle, {});
console.log(JSON.stringify(rows, null, 2));
```

**Expected shape:**
```json
[{
  "engine": "jira",
  "name": "prod",
  "scope": "global",
  "fields": [
    { "name": "url",   "secret": false, "display": "https://YOURORG.atlassian.net" },
    { "name": "email", "secret": false, "display": "you@yourorg.com" },
    { "name": "token", "secret": true,  "display": "••••••" }
  ],
  "last_modified_at": "..."
}]
```

**Pass criterion:** `token` row shows `••••••`, not the stored token.

**Filter test:** `runDatasourceList(bundle, { engine: 'datadog' })` returns `[]`.

---

## Scenario 15 — `/datasource test` prints env-var names (no network)

**Goal:** `test` is a name-preview only in v1. It does not call the API.

**Phase coverage:** Task 10 (runDatasourceTest).

```typescript
const preview = await runDatasourceTest(bundle, { ref: 'jira:prod' });
console.log(preview.envVarNames.sort());
// [ "OTTO_DS_JIRA_PROD__EMAIL", "OTTO_DS_JIRA_PROD__TOKEN", "OTTO_DS_JIRA_PROD__URL" ]
```

**Pass criteria:**
- Returns the three env-var names sorted.
- No network request is made (check with `tcpdump` or `nettop` if paranoid).
- No new audit `inject` records — `test` is a metadata preview, not an injection.

---

## Scenario 16 — `/datasource remove` deletes the entry; bound kernels error on next exec (strict mode)

**Goal:** Removing an entry while a kernel is bound to it causes the NEXT cell exec to surface `BindingNotFound`.

**Phase coverage:** Task 10 (runDatasourceRemove), Task 7 (injector strict mode).

Setup: Scenario 4 ran (`rca-test` is bound to `jira:prod` and has a live kernel).

```typescript
await runDatasourceRemove(bundle, { ref: 'jira:prod' });
```

Then `/sp reset rca-test` (forces respawn) → next exec on `rca-test`:

**Expected:** Error mentions `BindingNotFound` or `Vault binding not resolvable: jira:prod`.

**Audit:**
```bash
grep '"action":"remove"' ~/.otto/audit.jsonl | tail -1 | jq
# producer:'vault', action:'remove', detail.{engine,name,scope}
```

**Pass criteria:**
- Entry file gone from `~/.otto/data_vault/`.
- Sidecar key dropped (`_last_modified.json` no longer has `jira:prod`).
- Strict-mode spawn errors clearly.

---

## Scenario 17 — Loose mode (`OTTO_VAULT_MISSING_OK=1`) skips missing bindings

**Goal:** Setting the env var lets a kernel spawn even when a binding is missing — useful on flaky networks or for partial vault states. Default is strict.

**Phase coverage:** Task 7 (injector loose mode).

```bash
OTTO_VAULT_MISSING_OK=1 otto
```

Then `/sp reset rca-test` (or attempt to spawn anything bound to `jira:prod` which was deleted in Scenario 16).

**Expected:** Spawn succeeds. Audit shows an `inject-skipped` record with `severity: 'warn'`. stderr emits a one-line warning about the skip.

**Pass criteria:**
- Kernel spawns without error.
- Audit has `producer:'vault', action:'inject-skipped', severity:'warn'`.
- Cell sees no `OTTO_DS_JIRA_PROD__*` env vars (they weren't injected).

---

## Scenario 18 — `/audit` reader with filters

**Goal:** Reading the shared audit log honors `since`, `producer`, `engine`, and `action` filters; defaults to last 50 newest-first.

**Phase coverage:** Task 11 (runAudit).

```typescript
// Recent activity
const recent = await runAudit(bundle, { since: '1h' });
console.log(`${recent.length} records in the last hour`);

// Only vault writes
const writes = await runAudit(bundle, { producer: 'vault', action: 'set' });
console.log(writes.map(r => r.detail));

// Only secret-scanner hits
const scans = await runAudit(bundle, { producer: 'secret-scanner' });
console.log(scans.map(r => ({ kind: r.detail.kind, when: r.ts })));

// Only jira-related
const jira = await runAudit(bundle, { engine: 'jira' });
console.log(jira.map(r => `${r.action}: jira:${(r.detail as any).name}`));
```

**Pass criteria:**
- Default limit is 50.
- Records returned newest-first.
- Each filter narrows correctly.
- No secret values appear in any record's `detail`.

---

## Scenario 19 — Audit log rotation at 10MB

**Goal:** When `audit.jsonl` reaches 10MB, it rotates to `audit.1.jsonl`; older tails shift; max 5 tails kept.

**Phase coverage:** Task 1 (AuditLog rotation).

For a quick test, use a small rotation threshold:

```typescript
import { AuditLog } from '@otto/coworker-utils';
const log = new AuditLog({ path: '/tmp/audit-rot.jsonl', maxBytes: 200, maxTails: 5 });
const pad = 'x'.repeat(40);
for (let i = 0; i < 50; i++) {
  log.append({
    _schema: 1, ts: `2026-06-02T00:00:${String(i).padStart(2, '0')}Z`,
    producer: 'vault', action: 'set', detail: { pad },
  });
}
```

```bash
ls -l /tmp/audit-rot*
# audit-rot.jsonl, audit-rot.1.jsonl … audit-rot.5.jsonl
# audit-rot.6.jsonl must NOT exist
```

**Pass criteria:**
- Five rotated tails exist.
- The sixth doesn't.
- `read` returns records from current + all tails, sorted descending by ts.

---

## Scenario 20 — User-global engine YAML overrides builtin

**Goal:** Drop a custom engine YAML at `~/.otto/engines/` and it gets picked up by the registry. Precedence: builtin < user-global < workspace.

**Phase coverage:** Task 4 (EngineRegistry precedence).

```bash
mkdir -p ~/.otto/engines
cat > ~/.otto/engines/jira.yaml <<'EOF'
schema_version: 1
id: jira
label: Jira (my override)
fields:
  - { name: url,   label: "Custom URL prompt",   secret: false, required: true }
  - { name: email, label: "Atlassian email",     secret: false, required: true }
  - { name: token, label: "Token",               secret: true,  required: true }
EOF
```

Restart Otto (registry is loaded at startup; no live reload). Then call `/connect jira test`. The URL prompt label should say `Custom URL prompt`.

**Pass criteria:**
- User-global YAML supersedes the builtin (label changes).
- Workspace YAML supersedes user-global if present.
- Removing the user YAML and restarting returns to the builtin label.

---

## Scenario 21 — Phase 1 regression smokes (selective)

**Goal:** Phase 2 didn't break Phase 1's scratchpad surface.

**Phase coverage:** Phase 1 surface, not Phase 2 — but worth quick checks since Phase 2 modified `scratchpad-manager.ts`, `child-process-runtime.ts`, and `kernel-bindings.ts`.

Quick sweep (each should behave identically to Phase 1 — see `2026-06-01-coworker-phase-1-human-tests.md` for full specs):

- `/sp new s21-pre` → no `--use` flag → works exactly as before.
- `/sp new s21-bound --use jira:prod` then a cell that does NOT touch `process.env` → returns its result unchanged. Vault bindings should not affect non-vault cell behavior.
- `/sp fork s21-bound s21-fork` → bindings copy (already in Scenario 9) AND kernel state copies as in Phase 1.
- `/sp tree`, `/sp view`, `/sp save`, `/sp detach` → unchanged.
- `/sp evict s21-bound` and `/sp evict --force s21-bound` → unchanged.

**Pass criterion:** None of the Phase 1 scenarios regress.

---

## Phase 2 coverage matrix

| Scenario | Task(s) | Pillar covered |
|---|---|---|
| 1 | 5, 9, 1 | LocalDataVault atomic write + chmod + audit set record |
| 2 | 3, 9 | VAULT_KEEP sentinel edit/create semantics |
| 3 | 9 | Required-field validation |
| 4 | 12, 13, 16 | meta.bindings persistence + spawn-time env injection + --use flag |
| 5 | full stack | End-to-end real Jira REST API call |
| 6 | 14 | SecretScanner journal redaction (live untouched) |
| 7 | 16 | /sp use, /sp unuse, idempotency, malformed ref reject |
| 8 | 16 | /sp list binding count column |
| 9 | 16 (manager.fork) | Fork copies bindings |
| 10 | 16 | /sp reset preserves bindings + clears banner state |
| 11 | 6, 15 | Staleness banner via sidecar lookup |
| 12 | 15 | resetForRespawn semantics |
| 13 | 6 | Workspace-first resolution + fallback |
| 14 | 10 | /datasource list secret masking |
| 15 | 10 | /datasource test env-var preview, no network |
| 16 | 10, 7 | /datasource remove + strict-mode BindingNotFound |
| 17 | 7 | OTTO_VAULT_MISSING_OK=1 loose mode |
| 18 | 11 | /audit filters + default limit + ordering |
| 19 | 1 | Audit rotation at maxBytes; max 5 tails |
| 20 | 4 | Engine YAML precedence (builtin < user < workspace) |
| 21 | regression | Phase 1 surface intact |

---

## Phase 2 sign-off checklist

Run before merging `feat/coworker-phase-2-vault`:

- [ ] **Scenario 1:** /connect creates entry with chmod 600, audit set, sidecar present
- [ ] **Scenario 2:** VAULT_KEEP edit preserves; explicit token replaces; sentinel in create rejected
- [ ] **Scenario 3:** required-field empty errors clearly
- [ ] **Scenario 4:** --use persists bindings; spawn injects OTTO_DS_*; parent env stays clean
- [ ] **Scenario 5:** real Jira /myself returns account JSON (requires Atlassian Cloud creds)
- [ ] **Scenario 6:** secret in stdout → redacted in cells.jsonl; live TUI shows raw; audit record carries no value
- [ ] **Scenario 7:** /sp use + /sp unuse idempotent; malformed ref rejected
- [ ] **Scenario 8:** /sp list reports binding count
- [ ] **Scenario 9:** /sp fork copies bindings
- [ ] **Scenario 10:** /sp reset preserves bindings; banner state cleared
- [ ] **Scenario 11:** staleness banner fires after rotation; one-shot per session+ref
- [ ] **Scenario 12:** banner suppressed after respawn (new spawnTime ahead of last_modified)
- [ ] **Scenario 13:** workspace entry shadows global; fallback works when workspace empty
- [ ] **Scenario 14:** /datasource list masks secret fields
- [ ] **Scenario 15:** /datasource test prints env-var names without network
- [ ] **Scenario 16:** /datasource remove deletes file + drops sidecar key; strict-mode error on next exec
- [ ] **Scenario 17:** OTTO_VAULT_MISSING_OK=1 lets spawn proceed; inject-skipped audit emitted
- [ ] **Scenario 18:** /audit filters work (since/producer/engine/action); newest-first, limit 50
- [ ] **Scenario 19:** rotation at maxBytes; max 5 tails; reads include all tails
- [ ] **Scenario 20:** user-global engine YAML override picked up after restart
- [ ] **Scenario 21:** Phase 1 surface unaffected

When all 21 boxes are checked, Phase 2 is verified end-to-end and ready for merge.

If any scenario fails, log the issue against the relevant Phase 2 task; if a scenario reveals a Phase 2.1 follow-up (e.g., need slash-command activator wiring, need bearer-token engine seed, need OAuth flow), capture it as a separate ticket so the merge isn't blocked.
