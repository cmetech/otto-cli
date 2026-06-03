# Upstream audit — gsd-pi — 2026-05-30 — DRY RUN (no issues filed)

**Scope**: v1.0.1 (35319aa) → HEAD (03e229d)
**Commits scanned**: 117
**Issues that would be filed**: 49
**Not applicable to OTTO**: 12 (matched applicability rules)
**Skipped (mechanical)**: 37 (merge / chore / docs / already filed)
**Unclassified (manual triage)**: 19

## Critical — security (0)

(none)

## Critical — stability (3)

- [would file] — 🐛 [sha=58227e0] fix(bug-2): Crash logs use unbounded per-call filenames crash logs now append to one per-PID file instead of creating timestamped files per call. — `conflict-risk:none`
- [would file] — 🐛 [sha=066cee9] fix(bug-1): Recoverable EPIPE events write crash logs EPIPE is handled as recoverable without writing crash artifacts. — `conflict-risk:none`
- [would file] — 🐛 [sha=fc39cdc] fix(ollama): trust /api/show context, sync num_ctx, and fix KNOWN_MODELS drift — `conflict-risk:none`

## Nice-to-have fixes (42)

- [would file] — 🩹 [sha=5754851] fix(issue): [Bug]: Unusuable, unresponsive, fresh install — `conflict-risk:none`
- [would file] — 🩹 [sha=9814712] fix: repair descriptor roadmap renders — `conflict-risk:none`
- [would file] — 🩹 [sha=5a0af0a] fix: detect stale worktree roadmaps in projection — `conflict-risk:none`
- [would file] — 🩹 [sha=f5b1c7c] fix: resolve projected roadmap paths — `conflict-risk:none`
- [would file] — 🩹 [sha=91c18da] fix(issue): Artifact renderers use inconsistent gsdRoot vs gsdProjectionRoot when running inside a worktree causing stale-mirror verification failures — `conflict-risk:none`
- [would file] — 🩹 [sha=2c2b925] fix(issue): [Bug] execute-task re-dispatched after task is complete when verification gate fails with pre-existing errors — `conflict-risk:none`
- [would file] — 🩹 [sha=7b1ff8c] fix(issue): [Bug]: verification-gate treats 'bash: <cmd>' prefix as command name — exit 127 triggers 5× re-dispatch loop — `conflict-risk:none`
- [would file] — 🩹 [sha=639c926] fix(gsd): allow safe verify metacharacters — `conflict-risk:none`
- [would file] — 🩹 [sha=ad376fe] fix(gsd): preserve codebase cache timestamp — `conflict-risk:none`
- [would file] — 🩹 [sha=3b08787] fix: answer headless approval gates — `conflict-risk:none`
- [would file] — 🩹 [sha=29e71bd] fix: detect opengsd pnpm workspace scope — `conflict-risk:none`
- [would file] — 🩹 [sha=298a513] fix(issue): ModelPolicyDispatchBlockedError: cross_provider:false blocks explicit unit model configs when previous unit ran on different provider — `conflict-risk:none`
- [would file] — 🩹 [sha=1a12db8] fix(compaction): preserve history on empty summaries — `conflict-risk:low`
- [would file] — 🩹 [sha=be4a1e6] fix: clean up remaining opengsd package references — `conflict-risk:none`
- [would file] — 🩹 [sha=8e663d2] fix(bug-2): Generated files ignore .gitignore rules smart staging now honors `.gitignore` for `.gsd` even when files were already tracked. — `conflict-risk:none`
- [would file] — 🩹 [sha=b56c483] fix(bug-1): GitOps disabled still creates commits disabled GitOps now skips commit closeout paths instead of converting to commit mode. — `conflict-risk:none`
- [would file] — 🩹 [sha=814999d] fix: dereference symlinks in findWorkflowCliFromAncestorPath — `conflict-risk:none`
- [would file] — 🩹 [sha=2ff3dec] fix(pi-ai): normalize Claude tool schemas for Cloud Code Assist — `conflict-risk:low`
- [would file] — 🩹 [sha=78fb60d] fix(ollama): detect thinking capability from /api/show.capabilities — `conflict-risk:none`
- [would file] — 🩹 [sha=934515a] fix(bug-2): Command error reporting omits stack traces extension command errors now include stack traces when available. — `conflict-risk:medium`
- [would file] — 🩹 [sha=9477a62] fix(bug-1): fileFingerprint crashes on dirty files over 2 GiB oversized dirty tracked files now avoid Node's readFileSync Buffer limit. — `conflict-risk:none`
- [would file] — 🩹 [sha=7145ebb] fix(bug-3): Pre-dispatch break leaves ghost iterations open pre-dispatch break now finishes the open journal iteration. — `conflict-risk:none`
- [would file] — 🩹 [sha=77e8cee] fix(bug-2): Unhandled-phase warnings pause instead of retrying fresh state unhandled-phase warnings now retry dispatch once with freshly derived state before pausing. — `conflict-risk:none`
- [would file] — 🩹 [sha=f120a8b] fix(bug-1): pauseAuto aborts in-flight units after dispatch pre-dispatch health-gate pause is guarded against active units and covered by regression. — `conflict-risk:none`
- [would file] — 🩹 [sha=243147a] fix(test): stabilize CI coverage and implementation artifact detection (#84) — `conflict-risk:none`
- [would file] — 🩹 [sha=5ac9944] fix(release): keep package-lock in sync with engine optionalDependencies — `conflict-risk:none`
- [would file] — 🩹 [sha=0bb223e] fix(issue): [Bug]: verification-gate splits task-plan verify on && — cd loses cwd, causing false failure + 5× re-dispatch loop — `conflict-risk:none`
- [would file] — 🩹 [sha=68e1b46] fix(bug-3): Upgrade docs omit uninstalling old global gsd-pi package updated upgrade troubleshooting to uninstall the old global `gsd-pi` package before installing `@opengsd/gsd-pi`. — `conflict-risk:none`
- [would file] — 🩹 [sha=8c38b85] fix(bug-2): TUI crashes instead of handling missing native visibleWidth added a TUI-side JS visible-width fallback so render paths do not propagate native proxy throws. — `conflict-risk:low`
- [would file] — 🩹 [sha=cbb3b69] fix(bug-1): Linux x64 native addon is unavailable after npm install pinned native engine optional dependencies to the package version and made publish/prepublish require matching engine packages. — `conflict-risk:none`
- [would file] — 🩹 [sha=4fad086] fix(ci): allow build-native to publish engine packages at a target semver — `conflict-risk:none`
- [would file] — 🩹 [sha=db76d8b] fix(bug-2): Worker-lock self-collision / lock leak across orchestrator iterations milestone leases now tolerate same-process re-entry and pause cleanup releases the held lease. — `conflict-risk:none`
- [would file] — 🩹 [sha=46896cb] fix(bug-1): Milestone lifecycle desync: `status` stays `planned` after all slices complete final slice completion now promotes planned milestones to active before validation. — `conflict-risk:none`
- [would file] — 🩹 [sha=de5ac79] fix(issue): [Bug]: error on windows update from gsd-2 — `conflict-risk:none`
- [would file] — 🩹 [sha=0b1917c] fix(issue): gsd update no-ops on stale higher-versioned manifest → version-mismatch gate dead-locks (incomplete fix for #14) — `conflict-risk:none`
- [would file] — 🩹 [sha=c52d1f9] fix(bug-2): Wrong `unitType` string in estimate-based timeout scaling (`auto-timers.js`) changed estimate DB lookup to match the real `execute-task` unit type. — `conflict-risk:none`
- [would file] — 🩹 [sha=ce5210c] fix(bug-1): Cross-session recovery counter unconditionally reset at dispatch (`auto/phases.js`) preserved on-disk recovery attempts across fresh cross-session dispatches unless recovery ran in the current session. — `conflict-risk:none`
- [would file] — 🩹 [sha=c60b69c] fix(ci): harden native engine bootstrap and npm publish verification — `conflict-risk:none`
- [would file] — 🩹 [sha=749e051] fix(ci): native fallbacks for e2e and omit web from CI artifacts — `conflict-risk:none`
- [would file] — 🩹 [sha=32b3042] fix(ci): always build web host before validate-pack — `conflict-risk:none`
- [would file] — 🩹 [sha=2fbac97] fix: replace leaked absolute developer paths in docs and test fixtures — `conflict-risk:low`
- [would file] — 🩹 [sha=28b86bc] fix(auto): wire ScheduleWakeup continuation — `conflict-risk:none`

## Features (4)

- [would file] — ✨ [sha=941b208] feat(models): add dedicated uat model slot in preferences — `conflict-risk:none`
- [would file] — ✨ [sha=a6d253f] feat: add gsd-mcp runtime binary — `conflict-risk:none`
- [would file] — ✨ [sha=4db61b9] feat: persist cloud gateway auth state — `conflict-risk:none`
- [would file] — ✨ [sha=272f601] feat: add cloud MCP gateway local runtime — `conflict-risk:none`

## Unclassified — needs manual triage (19)

- `691789f` — Gate Codex review behind maintainer label (no rubric match; manual review)
- `4abf206` — Rename local @gsd-build packages to @opengsd (no rubric match; manual review)
- `7e40aa3` — Recover plan milestone schema confusion (no rubric match; manual review)
- `05c8d6c` — Make Discord changelog release-only (no rubric match; manual review)
- `cd23613` — Fix reactive execute terminal blocker recovery (no rubric match; manual review)
- `e952c8d` — Refactor test loop and update assertion message (no rubric match; manual review)
- `cccfad3` — Refactor model capabilities handling in tests (no rubric match; manual review)
- `0f57605` — Update discord-changelog.yml (no rubric match; manual review)
- `89df356` — Isolate bundled skills under GSD agent dir (no rubric match; manual review)
- `a5f2bc7` — release: v1.0.2 (no rubric match; manual review)
- `09a9b98` — cover native JS function fallbacks (no rubric match; manual review)
- `769c905` — harden native fallback and CI artifacts (no rubric match; manual review)
- `eb484e1` — allow coverage job to finish (no rubric match; manual review)
- `462fb0c` — stabilize lint diff base fetch (no rubric match; manual review)
- `ec7183f` — stabilize auto loop coverage tests (no rubric match; manual review)
- `5000f69` — preserve ANSI in native text fallback (no rubric match; manual review)
- `c49f412` — fix scoped npm pack Docker context (no rubric match; manual review)
- `5eb2b6b` — fix npm scope migration and native fallback (no rubric match; manual review)
- `dab71db` — Update README.md (no rubric match; manual review)

## Not applicable to OTTO (12)

These commits were reviewed against the applicability rules in `.planning/upstream-sync-config.json` and intentionally not filed as issues.

| Commit | Subject | Rule | Reason |
|---|---|---|---|
| `ca78473` | ci: extend integration test timeout | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `7abee80` | ci: add codex code review workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `8935c41` | Remove stale Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `10df570` | Remove stale Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `254f3d7` | Move Discord changelog to release-only workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `bac6a70` | Fix Discord changelog workflow script | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `6441898` | Refactor Discord changelog workflow to use GitHub Script | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `e9ddd90` | Add release_tag input to Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `4c55f5a` | Modify changelog workflow to use 'cat' command | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `6f20ca9` | Add Discord changelog workflow | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `a538c2a` | chore(ci): bump cache and artifact actions to v5 for Node 24 | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |
| `ae3690d` | ci: extend build job timeout | `upstream-ci-only` | Changes to upstream's GitHub Actions workflows that don't mirror OTTO's CI. OTTO's CI lives in cmetech/otto-cli/.github/workflows; upstream changes there are noise. |

## Skipped (37)

Mechanical filter — `chore:` / `docs:` / `test:` / `ci:` / `style:` / `refactor:` / `build:` prefixes plus merge commits and PatchDeck syncs. No applicability or severity judgment made; not filed.

<details>
<summary>Expand</summary>

- `cd74106` Apply PatchDeck fixes for PR #137 — `merge-commit`
- `c739bfb` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `156ed78` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `0c31996` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `ac00570` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `69a01b6` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `8bc5684` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `00ad924` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `5a43b08` docs: link web configurator in README — `prefix:docs:`
- `0e5a3d1` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `d5207e0` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `cfd261c` test: isolate mcp cli and secret-safe fixtures — `prefix:test:`
- `22b277f` test: isolate gsd mcp cli coverage — `prefix:test:`
- `4ec4465` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `9bf2def` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `acc716c` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `e14a484` Apply PatchDeck fixes for PR #125 — `merge-commit`
- `0181dda` test: avoid secret-shaped daemon fixture token — `prefix:test:`
- `7eafb02` Apply PatchDeck fixes for PR #102 — `merge-commit`
- `c6b0ce9` test(gsd): stabilize artifact history depth fixture — `prefix:test:`
- `07785e3` Apply PatchDeck fixes for PR #92 — `merge-commit`
- `06044d4` Apply PatchDeck fixes for PR #87 — `merge-commit`
- `3b0ba25` docs: update Discord community invite to Open GSD server — `prefix:docs:`
- `df060a8` docs: add npm, CI, Discord, and license badges to README — `prefix:docs:`
- `65f5c0b` test: accept exact engine version pins in npm package identity check — `prefix:test:`
- `1ee64d6` test: use distinct project roots for cross-worker lease contention — `prefix:test:`
- `14bdb71` refactor(ci): extract composite actions for artifact restore and Next.js cache — `prefix:refactor:`
- `cab6e38` ci: refactor pipeline and remove CodeRabbit — `prefix:ci:`
- `5ac60b4` docs(vision): use precise, verified dates for the project's history — `prefix:docs:`
- `d2636fe` docs(vision): explain briefly and honestly why the project moved — `prefix:docs:`
- `6a74301` docs: point Get Shit Done v1 references to get-shit-done-redux — `prefix:docs:`
- `9d55970` chore: remove legacy GSD-2 codename across the repo — `prefix:chore:`
- `13517a3` docs(vision): rewrite for gsd-pi and community direction — `prefix:docs:`
- `74c46a1` docs(contributing): update project name to gsd-pi — `prefix:docs:`
- `64a0606` ci: use github token for prerelease checkout — `prefix:ci:`
- `a4cd860` ci: restore docker builder stage — `prefix:ci:`
- `818bb88` Apply PatchDeck fixes for PR #44 — `merge-commit`

</details>

## Preflight results

- All 14 required checks passed
- Auto-created labels: 0

---

Dry run — state NOT advanced. A real run would set `lastAnalyzedCommit` → `03e229d` (gsd-pi HEAD as of 2026-05-30).
