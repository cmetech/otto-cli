# Phase 2 vault — manual smoke checklist

**Branch:** `feat/coworker-phase-2-vault`. **Spec:** `docs/superpowers/specs/2026-06-01-coworker-phase-2-vault-design.md`. **Plan:** `docs/superpowers/plans/2026-06-01-coworker-phase-2-vault.md`.

Run these end-to-end before merging.

## Prereq

- Atlassian account with API token (id.atlassian.com → Account → Security).
- Clean Otto checkout; no existing `~/.otto/data_vault/`.

## Steps

1. `/connect jira prod` → wizard prompts URL, email, token → entry stored.
   - Verify: `ls -l ~/.otto/data_vault/jira-prod.json` shows mode `-rw-------` (0600).
   - Verify: `/audit --producer vault` shows the `set` record.

2. `/sp new rca-test --use jira:prod` → kernel spawns with bindings.
   - Verify: kernel can `console.log(process.env.OTTO_DS_JIRA_PROD__URL)` — prints URL.

3. Cell:
   ```js
   const url = process.env.OTTO_DS_JIRA_PROD__URL;
   const email = process.env.OTTO_DS_JIRA_PROD__EMAIL;
   const token = process.env.OTTO_DS_JIRA_PROD__TOKEN;
   const auth = Buffer.from(`${email}:${token}`).toString('base64');
   const r = await axios.get(`${url}/rest/api/3/myself`, {
     headers: { Authorization: `Basic ${auth}` }
   });
   return r.data;
   ```
   - Verify: returns Jira account JSON.
   - Verify: `/audit --producer vault` shows `inject` records.

4. Cell: `console.log("AKIAABCDEFGHIJKLMNOP")` (fake AWS-key-shaped value).
   - Verify: live TUI shows the string verbatim.
   - Verify: `/sp view rca-test` shows `[REDACTED:aws_access_key_id]` in journal.
   - Verify: `/audit --producer secret-scanner` shows the redact record (no value, no preview).

5. `/connect jira prod` (edit) — press Enter on token prompt (default placeholder is `[VAULT_KEEP]`) → token preserved.
   - Verify: next cell exec on `rca-test` shows the staleness banner mentioning `jira:prod` and `/sp reset`.

6. `/sp reset rca-test` → banner does not re-fire on next exec (new spawnTime is now ahead of last_modified).

7. `/sp new rca-clone --use jira:prod` → spawn succeeds.
8. `/sp fork rca-clone rca-clone-alt` → `meta.bindings` in `rca-clone-alt` equals `['jira:prod']`.

9. `/datasource list` shows one vault row for `jira:prod` (scope: global) with token rendered as `••••••`.

10. `/datasource test jira:prod` prints the OTTO_DS_* env var names that would inject (no network).

11. `/datasource remove jira:prod` → entry file deleted.
    - Verify: `/audit --producer vault --action remove` shows the record.
    - Verify: next exec on `rca-test` errors with `BindingNotFound` (strict mode default).

## Expected misses (NOT failures)

- `/audit --tail` (follow mode) — deferred to Phase 3.
- Engine YAML `test:` block / smoke runner — deferred.
- ServiceNow / Datadog / IMAP / SolarWinds / generic-REST seeds — deferred to Phase 2.5 / Phase 6.
- `/connect`, `/datasource`, `/audit` command-level wiring (the extension activator) — Task 16 noted the cross-extension wiring is deferred to a follow-up; programmatic APIs (`runConnect`, `runDatasourceList`, etc.) are complete and tested; only the slash-command surface registration on Otto's command bus may need a small wiring task before users can type these in the TUI. Smoke steps that depend on slash commands assume that wiring has been completed; if it hasn't, exercise the programmatic API via tests instead.
- Staleness banner emission inside `/sp`'s cell-exec path requires the vault dep wired into the scratchpad extension activator. Step 5's verification covers the seam; the integration test (Task 17) verifies the helper directly.
