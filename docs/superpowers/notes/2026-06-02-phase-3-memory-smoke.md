# Phase 3 memory — manual smoke checklist

**Branch:** `feat/coworker-phase-3-memory`. **Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`. **Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3-memory.md`.

Run these end-to-end before merging.

> **Activator gap (READ FIRST).** Until Phase 3.1 wires the production activator, steps that require live LLM interaction with the memory tools must be tested via the integration test (`node --test dist-test/packages/coworker-memory/src/memory-integration.test.js`) rather than through the live Otto chat. Mark those steps `[BLOCKED on 3.1]` in this file. The recorder, Layer A store, Layer B backend, recall pipeline, SecretScanner split policy, and slash-command handlers are all complete at the API level and unit-tested; only the production hop into `pi-coding-agent`'s `before_agent_start` + `agent_start` events is missing. The substitute verification path is the Task 21 integration test.

## Prereq

- Clean Otto checkout; no existing `~/.otto/memory/`, no `<workspace>/.otto/memory/`.
- Phase 3 branch built: `cd packages/coworker-memory && npm run build && cd ../..`.
- `npm run test:compile` already executed at least once so `dist-test/` exists.

## Steps

1. Launch Otto in a fresh workspace.
   - Verify: `cat <workspace>/.otto/memory/workspace.json | jq` shows `_schema: 1`, `id: <slug>-<6 hex>`, `memory_seed_applied: false`.

2. Run `/memory status`.
   - Verify: prints `scope_mode: per-project-tagged`, `workspace_wing: <slug>`, `drawer_count: 0`, `layer_b_db_path`, `schema_version: 1`.

3. Type a multi-line paste (≥ 500 chars or with triple-backticks) into the chat.
   - Verify: `<workspace>/.otto/memory/layer-b.db` exists; query inspector: `sqlite3 <path> "SELECT kind, room, length(content) FROM drawers"` shows a `paste` row.
   - Verify: `/audit --producer memory --action write-drawer` shows the record with `redacted: false`.
   - **[BLOCKED on 3.1]** — depends on Task 20 user-turn wiring through the production activator. Substitute: the `auto-retain on long paste → kind=paste` case in `memory-integration.test.js`.

4. Ask Otto: "recall {one of the words from your paste}".
   - Verify: Otto's response includes a memory recall block citing the drawer URI.
   - **[BLOCKED on 3.1]** — requires the LLM tool registration to be live through the extension activator. Substitute: the `recall happy path` case in `memory-integration.test.js`.

5. `/memory note "MTTR is 30m for P1"`.
   - Verify: `<workspace>/.otto/memory/lessons.md` exists with frontmatter and a bullet.
   - **[BLOCKED on 3.1]** — slash-command bus registration is part of the activator hop. Substitute: invoke `runMemoryCommand({ subcommand: 'note', args: ['MTTR is 30m for P1'] }, bundle)` from a script, or rely on the Layer A write paths exercised by `layer-a-store.test.ts` and `memory-integration.test.js`.

6. Restart Otto (close, reopen) in the same workspace.
   - Verify: system prompt now includes "Memory (Layer A)" section with the MTTR lesson.
   - **[BLOCKED on 3.1]** — context-injection on `session_start` is wired in the activator hop. Substitute: `onSessionStart` is unit-tested directly (`session-start.test.ts`); the `Layer A memorize + read-back + session_start injection` case in `memory-integration.test.js` confirms the full path at the API level.

7. Type a string containing `AKIAABCDEFGHIJKLMNOP` into the chat.
   - Verify: drawer is written with `redacted=1` (check sqlite); the journal value contains `[REDACTED:aws_access_key_id]`.
   - Verify: `/audit --producer memory --action redact` shows the record (no value, no preview).
   - **[BLOCKED on 3.1]** — auto-retain user-turn wiring required to exercise the chat-path scanner. Substitute: the `SecretScanner redact on paste` case in `memory-integration.test.js`.

8. Try `/memory note "token AKIAABCDEFGHIJKLMNOP"`.
   - Verify: command errors with `Refused to store ... aws_access_key_id`.
   - Verify: `lessons.md` was NOT modified.
   - **[BLOCKED on 3.1]** — slash-command bus registration. Substitute: `runMemoryCommand` is unit-tested directly (`memory-command.test.ts`) and exercised through `memory-integration.test.js`.

9. `/memory clear --wing <workspace_wing> --confirm`.
   - Verify: response shows `deleted: N`; subsequent recall returns 0 results.
   - **[BLOCKED on 3.1]** — slash-command bus registration. Substitute: `runMemoryCommand` clear path is unit-tested directly.

## Expected misses (NOT failures)

- Layer C entity tools (`entity_query`, `entity_assert`) — Phase 5.
- ACC / Cerebellum auto-write paths — Phase 5.
- Weekly digest UX — Phase 5.
- Consolidator `MEMORY.md` / `skills/` output — Phase 5.
- Vector embeddings / semantic recall — out-of-scope per spec §9.
- Cross-workspace global Layer B — v2.
- `HostedBackend` — Phase 5.

If `/memory wing <name>` or `/memory room <name>` overrides don't persist across messages (session-state holder not yet wired), capture as a Phase 3.1 follow-up.

## Steps blocked on Phase 3.1

Steps 3, 4, 5, 6, 7, 8, 9 (7 of 9). The integration test is the substitute verification.

```bash
npm run test:compile
node --test dist-test/packages/coworker-memory/src/memory-integration.test.js
```

Expected: all integration cases pass.

## Steps runnable today (no activator required)

Steps 1, 2 — these only require the workspace bundle initialization and the read-only `/memory status` path, both of which can be invoked from scripts using `createMemoryBundle` directly.
