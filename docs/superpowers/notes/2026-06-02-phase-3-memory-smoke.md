# Phase 3 memory — manual smoke checklist

**Branch:** `feat/coworker-phase-3-memory`. **Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-3-memory-design.md`. **Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-3-memory.md`.

Run these end-to-end before merging.

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

4. Ask Otto: "recall {one of the words from your paste}".
   - Verify: Otto's response includes a memory recall block citing the drawer URI.

5. `/memory note "MTTR is 30m for P1"`.
   - Verify: `<workspace>/.otto/memory/lessons.md` exists with frontmatter and a bullet.

6. Restart Otto (close, reopen) in the same workspace.
   - Verify: system prompt now includes "Memory (Layer A)" section with the MTTR lesson.

7. Type a string containing `AKIAABCDEFGHIJKLMNOP` into the chat.
   - Verify: drawer is written with `redacted=1` (check sqlite); the journal value contains `[REDACTED:aws_access_key_id]`.
   - Verify: `/audit --producer memory --action redact` shows the record (no value, no preview).

8. Try `/memory note "token AKIAABCDEFGHIJKLMNOP"`.
   - Verify: command errors with `Refused to store ... aws_access_key_id`.
   - Verify: `lessons.md` was NOT modified.

9. `/memory clear --wing <workspace_wing> --confirm`.
   - Verify: response shows `deleted: N`; subsequent recall returns 0 results.

## Expected misses (NOT failures)

- Layer C entity tools (`entity_query`, `entity_assert`) — Phase 5.
- ACC / Cerebellum auto-write paths — Phase 5.
- Weekly digest UX — Phase 5.
- Consolidator `MEMORY.md` / `skills/` output — Phase 5.
- Vector embeddings / semantic recall — out-of-scope per spec §9.
- Cross-workspace global Layer B — v2.
- `HostedBackend` — Phase 5.

If `/memory wing <name>` or `/memory room <name>` overrides don't persist across messages (session-state holder not yet wired), capture as a Phase 3.1 follow-up.

---

## Activator wiring landed in Phase 3.1

Branch `feat/coworker-phase-3.1-activators` shipped the memory production activator (default-export `coworkerMemoryExtension`), wiring auto-retain user turns (Phase 3 Task 20 closure) and the scratchpad `onDataLoad → recordFileLoad` production hop (Phase 3 Task 19 closure).

**Automated verification (passing as of this commit):**
- `src/resources/extensions/coworker-memory/index.test.ts` — 7 tests covering bundle lifecycle, `before_agent_start` + `agent_start` round-trip recording a turn drawer, Layer A inject, init failure.
- `src/resources/extensions/coworker-scratchpad/index.test.ts` — 4 closure-shape tests covering `onDataLoad` with null recorder, with recorder, and silent rejection swallow.
- `packages/coworker-memory/src/activator-integration.test.ts` — 3 cross-extension tests covering the full Day-3 milestone (turn drawer + file_load drawer + isolation).

**Live TUI walkthrough:** PENDING. Run steps 1–9 above in the built Otto binary against a fresh workspace and replace this line with: `Verified live on YYYY-MM-DD by <name> at commit <short-sha>.`
