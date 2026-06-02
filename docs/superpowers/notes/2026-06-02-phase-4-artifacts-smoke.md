# Phase 4 artifacts — manual smoke checklist

**Branch:** `feat/coworker-phase-4-artifacts`.
**Spec:** `docs/superpowers/specs/2026-06-02-coworker-phase-4-artifacts-design.md`.
**Plan:** `docs/superpowers/plans/2026-06-02-coworker-phase-4-artifacts.md`.

Run these end-to-end before tagging the merge live-verified.

## Prereq

- Build current: `npm run build`.
- Fresh workspace, no existing `<workspace>/.otto/artifacts/`.
- Phase 4 branch built: `(cd packages/coworker-artifacts && npm run build) && (cd packages/coworker-memory && npm run build) && (cd packages/coworker-scratchpad && npm run build) && npm run build`.
- `npm run test:compile` already executed at least once so `dist-test/` exists (Step 2 below is scriptable; the rest require the real `otto` binary in the TUI).

## Steps

1. Launch Otto in the fresh workspace. `/artifacts list` returns "### Artifacts (0)". *(real binary)*
2. `/artifacts<Tab>` — completion shows `list`, `show`, `remove` with descriptions. *(real binary)*
3. `/sp new test`. `/sp attach test`. Run cell: *(real binary)*
   ```js
   const a = await otto.artifact.create('report', 'test artifact');
   await a.update([{path: 'report.md', content: '# hello\n'}]);
   return a.uri;
   ```
   Cell returns `artifact://test-artifact`.
4. `/artifacts list` — row shows `test-artifact | report | 0 | <ts> | artifact://test-artifact`. *(real binary)*
   (`turn_count` may be 0 if the cell binding skipped `recordTurn`; auto-record is on the integration roadmap.)
5. `cat <workspace>/.otto/artifacts/test-artifact/{metadata.json,provenance.json,README.md}`. metadata + readme present; provenance may be `[]` if recordTurn not yet auto-fired by cell binding. *(real binary)*
6. `/artifacts show test-artifact` — content prints with `# hello`. *(real binary)*
7. `/memory recall hello --kind artifact` — returns a drawer pointing at `artifact://test-artifact`. *(real binary)*
8. Restart Otto in same workspace. `/artifacts list` still shows the artifact (persistence). *(real binary)*
9. `/artifacts remove test-artifact --confirm` deletes the dir. *(real binary)*
10. Spill test — cell: *(real binary)*
    ```js
    const big = 'x'.repeat(11000);
    const h = await otto.artifact.spillIfLarge(big, {thresholdBytes: 10240});
    return h?.uri ?? 'no spill';
    ```
    Returns `artifact://cell-output-...`. Same with `x.repeat(1000)` returns `'no spill'`.

## Expected misses

- Workbook (xlsx) artifacts — Phase 4.5+.
- Auto-`recordTurn` on cell-binding `create`/`update` — relies on the activator passing `pendingPrompt` through the manager (deferred to a small follow-up).
- TUI artifact panel — Phase 5+.
- Vector embeddings / semantic recall over artifacts — out-of-scope per Phase 3 spec §9.
- Cross-workspace global artifacts (`~/.otto/artifacts/`) — v2.
- Persona-bundled artifact templates (`artifact-templates/`) — Phase 6.

## Sign-off

**Live TUI walkthrough:** PENDING. Run steps 1–10 above in the built Otto binary against a fresh workspace and replace this line with: `Verified live on YYYY-MM-DD by <name> at commit <short-sha>.`

---

## Activator wiring landed in Phase 4

Branch `feat/coworker-phase-4-artifacts` shipped the artifacts production activator (default-export `coworkerArtifactsExtension`), wiring `/artifacts list|show|remove`, `list_artifacts` + `open_artifact` LLM tools, the kernel-side `otto.artifact.create()` + `spillIfLarge()` bindings (RPC over NDJSON stdio), and the scratchpad manager `onArtifactCreate` fan-out into the memory `recordArtifact` drawer.

**Automated verification (passing as of this commit):**
- `packages/coworker-artifacts/src/*.test.ts` — module-level coverage for slug, dir-snapshot, resolve-uri, readme-renderer, ArtifactStore (atomic writes + collision + README rerender), and the public barrel.
- `packages/coworker-artifacts/src/artifacts-integration.test.ts` — cross-extension end-to-end: cell-binding RPC → manager fan-out → memory drawer with `kind:'artifact'`.
- `src/resources/extensions/coworker-artifacts/*.test.ts` — bundle lifecycle, list/open/remove tools + `/artifacts` slash dispatcher.
- `packages/coworker-memory/src/migrations/002-artifact-kind.sql` — migration applied conditionally on `PRAGMA user_version`; tested in memory's local-sqlite-backend suite.
