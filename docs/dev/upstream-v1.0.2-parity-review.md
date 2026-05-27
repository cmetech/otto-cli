# Upstream v1.0.2 Parity Review

Date: 2026-05-26

Upstream release: `open-gsd/gsd-pi` `v1.0.2`
Compared range: `v1.0.1..v1.0.2`

OTTO is a hard fork. Upstream changes are not merged or cherry-picked; applicable fixes are reimplemented with OTTO names, paths, package scopes, `.otto/workflow`, and CLI-only constraints.

## Applicability Matrix

| Upstream item | Bug or behavior fixed | OTTO equivalent checked | Decision | Reason |
| --- | --- | --- | --- | --- |
| PR #44 / `28b86bc` ScheduleWakeup continuation | `ScheduleWakeup` was registered but auto-mode did not continue the same unit after the delayed wakeup. | `src/resources/extensions/workflow/auto/run-unit.ts`, `auto/schedule-wakeup.ts`, `bootstrap/schedule-wakeup-tool.ts`, `tests/auto-loop.test.ts` | Already present | OTTO already has the wakeup store, tool registration, run-unit continuation loop, and regression coverage with OTTO messaging. |
| PR #42 version-sync guard | Added package/version synchronization guardrails. | `package.json`, `scripts/sync-pkg-version.cjs`, `scripts/verify-version-sync.cjs`, `scripts/verify-piconfig-sync.mjs` | Already present | OTTO has its own version and piConfig sync checks in `prepublishOnly`; upstream package names do not apply directly. |
| PRs #46/#47/#48/#62/#63/#65/#66/#67/#68/#70 CI hardening | CI timeout/cache/artifact/native/web publish robustness. | `.github/workflows`, `scripts/verify-native-platform-packages.mjs`, native package scripts | Partial / reject web-specific | Native publish guardrails are present or adapted; web-host and VS Code artifact behavior is intentionally not restored. Remaining upstream CI references still use upstream package names and should be handled separately if OTTO publishes from this repo. |
| Remove legacy GSD-2 codename / leaked paths | Removed old branding, leaked developer paths, docs drift. | OTTO branding checks and docs residue | Reject as upstream-specific | OTTO intentionally retains fork attribution and some historical docs; broad branding cleanup is outside this parity fix set and should not reintroduce upstream naming. |
| PR #72 / `c52d1f9` estimate timeout unit type | Estimate-based timeout scaling looked for unit type `task` instead of real `execute-task`. | `src/resources/extensions/workflow/auto-timers.ts` | Adopt | OTTO has the same stale `unitType === "task"` check, so task estimates in DB are ignored for execute-task supervision. |
| PR #73 / `ce5210c` cross-session recovery attempts | Dispatch always reset `recoveryAttempts`, losing on-disk recovery budget across a fresh cross-session dispatch; only current-session recovery should reset. | `src/resources/extensions/workflow/auto/phases.ts`, `unit-runtime.ts`, recovery tests | Adapt | OTTO has the unconditional reset. Preserve old same-session reset behavior through a helper keyed by `unitRecoveryCount`. |
| PR #75 / `0b1917c` update no-op resource refresh | `gsd update` no-oped on a stale higher-versioned manifest and left resources stale. | `src/update-cmd.ts`, `src/resource-loader.ts`, `src/app-paths.ts` | Adapt | OTTO update no-op currently returns without refreshing bundled resources. Adapt with OTTO env/package names and optional test dirs. |
| PR #76 / `de5ac79` Windows ZIP extraction | Windows update/install failed because `extract-zip` was used in contexts where it may not resolve; PowerShell `Expand-Archive` is safer on Windows. | `scripts/install.js` | Adopt | OTTO installer has the same zip extraction path. Reimplement with OTTO installer names intact. |
| PR #77 / `46896cb` complete-slice milestone status | Final slice completion left a planned milestone as `planned`, causing lifecycle/validation desync. | `src/resources/extensions/workflow/tools/complete-slice.ts`, tests | Adopt | OTTO has the same omission. Promote planned milestones to active when all slices become closed. |
| PR #77 / `db76d8b` milestone lease re-entry and pause cleanup | Same-process worker could collide with its own previous lease; pause leaked held lease until TTL. | `src/resources/extensions/workflow/db/milestone-leases.ts`, `auto.ts` | Adopt | OTTO has the same lease takeover predicate and pause cleanup only marks worker stopping. |
| PR #79 / `4fad086` build-native target semver | Native engine packages can publish for a target semver. | `.github/workflows/build-native.yml` | Already partially present / defer CI | OTTO native package pinning exists. CI still has upstream package names; publish workflow parity needs a separate release-infrastructure pass. |
| PR #80 / `cbb3b69` exact native engine pins | Linux x64 native addon was unavailable after install because optional dependency ranges could resolve older/missing engine packages. | `package.json`, `native/scripts/sync-platform-versions.cjs`, `scripts/verify-native-platform-packages.mjs` | Already present | OTTO root optional dependencies are exact `@cmetech/otto-engine-*` `1.0.2` pins and sync script updates root pins. |
| PR #80 / `8c38b85` TUI visibleWidth fallback | TUI crashed when native `visibleWidth` threw or native text addon was unavailable. | `packages/pi-tui/src/utils.ts`, tests | Adopt | OTTO delegates directly to native `visibleWidth`; add JS fallback while preserving native-first behavior. |
| PR #80 / `68e1b46` upgrade docs uninstall old global package | Upgrade docs forgot to uninstall old global `gsd-pi`. | `docs/user-docs/troubleshooting.md` | Reject | OTTO package history and install names differ. No direct old `gsd-pi` global cleanup should be added as an OTTO fix. |
| PR #81 / `0bb223e` verification-gate `&&` split | Task-plan verify commands were split on `&&`, breaking commands such as `cd foo && npm test`. | `src/resources/extensions/workflow/verification-gate.ts`, tests | Adopt | OTTO has the same `split(/&&|\r?\n/)` logic. Split only on newlines. |

## Implementation Scope

Adopt/adapt only these OTTO fixes:

- `auto-timers.ts`: use `execute-task` for DB estimate lookup.
- `auto/phases.ts`: preserve cross-session recovery attempts unless current-session recovery has run.
- `update-cmd.ts`: refresh installed resources when already up to date.
- `scripts/install.js`: use PowerShell `Expand-Archive` for Windows zip extraction.
- `tools/complete-slice.ts`: promote planned milestone to active when all slices are closed.
- `db/milestone-leases.ts` and `auto.ts`: allow same-process lease re-entry and release held milestone lease on pause.
- `packages/pi-tui/src/utils.ts`: add JS visible-width fallback.
- `verification-gate.ts`: do not split task-plan verify commands on `&&`.

