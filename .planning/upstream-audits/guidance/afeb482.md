verdict: manual-port

# afeb482 — fix(bug-2): doctor-checks misses DB-present/filesystem-missing orphan state

## Target file(s)
- /Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli/src/resources/extensions/workflow/doctor-runtime-checks.ts
- /Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli/src/resources/extensions/workflow/doctor-types.ts
- /Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli/src/resources/extensions/workflow/tests/doctor-orphan-milestone-4996.test.ts

## Divergence
Otto-cli renames the GSD extension to `workflow` (`src/resources/extensions/gsd/` → `src/resources/extensions/workflow/`) and its db module from `gsd-db.ts` to `db.ts`. Otherwise the file shapes are aligned: otto already has `paths.ts` exporting `resolveMilestonePath`, `doctor-runtime-checks.ts` carrying the orphan_milestone_dir check at the same position, `doctor-types.ts` with the same `DoctorIssueCode` union (currently terminating at `"orphan_milestone_dir"` on line 90), and the existing `tests/doctor-orphan-milestone-4996.test.ts` covering the dir-orphan case. The upstream patch's new block (DB row + filesystem missing → `orphan_milestone_db`) uses `isDbAvailable` and `getAllMilestones`, which otto exports from `./db.js` (not `./gsd-db.js`). The new file path token in the issue (`.gsd/gsd.db`) also needs to become otto's equivalent (e.g. `.otto/workflow/otto.db` — verify against `gsdRoot`/`workflowRoot` and `dbPath` references in `doctor-runtime-checks.ts`).

## Concrete edits
1. In `doctor-runtime-checks.ts`:
   - Update the `./paths.js` import line to also import `resolveMilestonePath` (it already imports `milestonesDir`, `workflowRoot`, `resolveWorkflowRootFile`).
   - Add a new import: `import { isDbAvailable, getAllMilestones } from "./db.js";`.
   - After the existing orphan-directory check block in `checkRuntimeHealth(...)` (look for the `// ── Orphan milestone directory` section), append the upstream "Orphan milestone DB rows" `try { if (isDbAvailable()) { ... } } catch {}` block. Replace `code: "orphan_milestone_db"` and `file: ".gsd/gsd.db"` with otto's path convention — confirm the right relative path against how other issues in the same file build the `file:` field (likely `.otto/workflow/otto.db`).
2. In `doctor-types.ts`:
   - Extend the `DoctorIssueCode` union to include `| "orphan_milestone_db"` directly after `"orphan_milestone_dir"`.
3. In `tests/doctor-orphan-milestone-4996.test.ts`:
   - Port the new test case verbatim (paths/imports already align). Adjust any references to `gsd-db.ts` → `db.ts` and `.gsd/gsd.db` → otto's db path.
4. Run the workflow extension test suite focused on doctor checks.

## Verdict
Manual-port. The bug — runtime drift where a DB milestone row outlives its on-disk directory — applies equally to otto: nothing in otto's `doctor-runtime-checks.ts` reports the DB-present/disk-missing case today. The port is mechanical (rename `gsd-db` → `db`, `.gsd/gsd.db` → otto path) and small enough to land safely. Caveat: double-check `getAllMilestones()` in otto returns rows with a `status` field shaped like upstream (the new code skips `queued` status); if otto's accessor differs, the filter needs equivalent semantics.
