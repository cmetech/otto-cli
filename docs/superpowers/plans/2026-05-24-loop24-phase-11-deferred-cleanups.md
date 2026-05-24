# LOOP24 Phase 11 — Deferred cleanups from Cleanups A/B/C + earlier phases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

> **NEVER `git add -A` in this repo.** Always stage explicit file paths. `docs/branding/` is the user's active working area — keep hands off.

**Goal:** Close out the remaining items in `LOOP24-PATCHES.md` → `Known Deferred Cleanups` that descend from Cleanups A/B/C, Phase 0.5, and other early-phase work. These are pre-Phase-8 deferrals that aren't structural rebrands — they're sweep-and-tidy items.

## Tasks

### Task 1: Delete dead code `registerLazyGSDCommand`

**Source of deferral:** Cleanup C / Phase 0 — item #1 in deferred-cleanups.

- File: `src/resources/extensions/workflow/commands-bootstrap.ts:272`
- Has no callers anywhere in the codebase
- The actual registration site is `commands/index.ts:5`

**Steps:**
1. Confirm zero callers: `grep -rn "registerLazyGSDCommand\|registerLazyWorkflowCommand" src/ packages/ scripts/`
   - (Phase 6 Task 6 renamed `registerGSDCommand` → `registerWorkflowCommand`; the lazy variant may have been swept too. Verify the exact remaining name.)
2. Delete the function declaration + any related imports.
3. Build + standing 74-test regression.
4. Commit.

### Task 2: Remove orphan Rust build scripts from root `package.json`

**Source of deferral:** item #2.

Three scripts reference the deleted `native/` Rust directory:
- `build:native` → `node native/scripts/build.js`
- `build:native:dev` → `node native/scripts/build.js --dev`
- `sync-platform-versions` → `node native/scripts/sync-platform-versions.cjs`

**Steps:**
1. Confirm none of the three are invoked by any other npm script or CI yaml: `grep -rn "build:native\|sync-platform-versions" .github/ scripts/ package.json packages/`
2. Remove the three entries from root `package.json` scripts block.
3. Build + standing regression.
4. Commit.

### Task 3: piConfig triplication — collapse or guard

**Source of deferral:** Cleanup A residue, item #3.

Three `package.json` files carry a `piConfig` block:
- Root `package.json`
- `packages/pi-coding-agent/package.json`
- `pkg/package.json`

The load-bearing one at runtime is `pkg/package.json` (via `src/loader.ts:84-88` setting `PI_PACKAGE_DIR=pkg/`).

**Two options for the executor — pick one:**

**Option A — CI parity check** (lower-risk, faster): add a `scripts/verify-piconfig-parity.cjs` script that fails when the three blocks diverge. Wire it into the existing `prebuild` or `prepublishOnly` hook.

**Option B — collapse to one source of truth** (higher-risk): generate the workspace + root blocks from the canonical `pkg/package.json` at `npm run sync-piconfig` time. Requires an emit script and a contract that hand-edits go to `pkg/` only.

**Recommended:** Option A. The triplication has been stable since Phase 2c; preventing drift is the actual problem to solve.

**Steps:**
1. Write `scripts/verify-piconfig-parity.cjs` that reads all three and `assert.deepEqual`s the `piConfig` blocks. Fail with a clear message listing which fields diverged.
2. Add to `package.json` scripts: `"verify:piconfig": "node scripts/verify-piconfig-parity.cjs"`.
3. Wire into `prebuild` (run before every build).
4. Run it once locally to confirm pass on current state.
5. Build + standing regression.
6. Commit.

### Task 4: Loop24 Signal Theme JSON↔TS duplication

**Source of deferral:** Cleanup B residue, item #4.

- Canonical JSON: `src/resources/extensions/loop24/theme/loop24.json`
- Runtime const: `packages/pi-coding-agent/src/modes/interactive/theme/themes.ts`

Root cause: `pi-coding-agent`'s tsconfig has `rootDir: ./src` which prevents importing JSON from outside the package boundary.

**Two options:**

**Option A — Generate the TS const from the JSON at build time.** Add a `scripts/generate-theme-const.mjs` that reads `loop24.json` and emits `themes.ts` (or a sibling typed constant file). Wire into `prebuild`.

**Option B — Drift-detector** (analog to Task 3): compare values; fail on mismatch.

**Recommended:** Option A. The values are stable but JSON is the actual canonical source; emitting from it eliminates the manual-sync risk.

**Steps:**
1. Write `scripts/generate-theme-const.mjs` that reads `loop24.json` and writes `packages/pi-coding-agent/src/modes/interactive/theme/loop24-theme.generated.ts`.
2. Update `themes.ts` to import from the generated file rather than inline the values.
3. Wire `prebuild` to regen before tsc.
4. Add `*.generated.ts` to lint ignore (if applicable).
5. Build + standing regression.
6. Commit.

### Task 5: Remove legacy `GSD_FIRST_RUN_BANNER` env var

**Source of deferral:** item #5.

- `src/loader.ts` sets both `LOOP24_FIRST_RUN_BANNER` and `GSD_FIRST_RUN_BANNER`
- One test reads the legacy var: `src/resources/extensions/workflow/tests/session-start-footer.test.ts`

**Steps:**
1. Update `session-start-footer.test.ts` to read `LOOP24_FIRST_RUN_BANNER`.
2. Remove `process.env.GSD_FIRST_RUN_BANNER = '1'` from `src/loader.ts`.
3. Build + standing regression.
4. Commit.

### Task 6: Documentation files still reference old `extensions/gsd/` path

**Source of deferral:** item #11.

**Scope:** `docs/**`, repo-root `*.md` (excluding `LOOP24-PATCHES.md`, `LICENSE`, `README.md`'s fork-attribution block).

**Steps:**
1. Inventory: `grep -rn "extensions/gsd\|/gsd/\|@gsd/" docs/ *.md 2>/dev/null | grep -v "docs/branding/" | grep -v "docs/superpowers/plans/" | grep -v "LOOP24-PATCHES.md" | grep -v "LICENSE"`
2. Per-file judgment: most should be sweep-replaced to `extensions/workflow/` and `@loop24/...`. Some may be historical and stay (e.g., notes about the Phase 0 rename itself).
3. Build (no impact since this is docs only). Run standing regression as sanity.
4. Commit.

### Task 7: LOOP24-PATCHES.md update + tag

- Update Known Deferred Cleanups items 1-5 + 11 to mark RESOLVED.
- Add Phase 11 section to LOOP24-PATCHES.md.
- Tag `phase-11-deferred-cleanups`.

## Success criteria

- `npm run build` clean (exit 0) at every task boundary
- Standing 74-test regression pass throughout
- `docs/branding/` untouched
- No `git add -A`

## Out of scope

- `.gsd/` runtime directory references (session compat per Phase 10 decision)
- customType protocol strings (session compat per Phase 10 decision)
- `process.env.GSD_X` compat-shim fallback (intentional)
- `@opengsd/engine-*` native binaries (intentional upstream reuse)
- LICENSE / README "Fork attribution" block / LOOP24-PATCHES.md fork-history doc
- Commit history rewrites
- `docs/branding/` (user-owned working area)
- OTTER brand rollout (separate concern; see README "Status" — gradual introduction)

## Expected diff scale

- Task 1: 1 file, ~30 line deletion
- Task 2: 1 file, 3-line deletion
- Task 3: 2 files (new script + package.json scripts entry), ~50 lines
- Task 4: 3 files (new generate script + updated themes.ts + package.json scripts entry), ~80 lines
- Task 5: 2 files, ~5 line changes
- Task 6: ~10-30 docs files, mostly 1-line edits

**Total: ~20-40 files, ~200 lines.** Small phase; one focused work session.

## Order

Run tasks **1, 2, 5 first** (trivial wins, no logic change). Then **6** (docs sweep, no logic change). Then **3** and **4** (each adds infra — a verify script or a build-time generator). Then **7** (document + tag).
