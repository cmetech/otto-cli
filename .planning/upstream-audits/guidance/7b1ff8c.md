verdict: cherry-pick

# 7b1ff8c — fix: verification-gate treats 'bash: <cmd>' prefix as command name — exit 127 triggers 5x re-dispatch loop

## Target file(s)
- src/resources/extensions/workflow/verification-gate.ts
- src/resources/extensions/workflow/tests/verification-gate.test.ts

## Divergence
Otto's `verification-gate.ts` still has the `PACKAGE_SCRIPT_KEYS` constant and the `discoverCommands` task-plan-verify codepath that the upstream patch modifies. No otto-side rewrite of this region; the patch hunk should apply cleanly. Same tests directory layout.

## Concrete edits
1. In `src/resources/extensions/workflow/verification-gate.ts`, add the `INTERPRETER_PREFIX_RE` regex near `PACKAGE_SCRIPT_KEYS` and strip it from each candidate before `validateVerificationCommand` in the task-plan-verify branch; push the normalized form into `commands`.
2. Add the new "strips interpreter prefixes from task plan verify commands" test case to `src/resources/extensions/workflow/tests/verification-gate.test.ts`.
3. Run `pnpm test verification-gate` to confirm.

## Verdict
Real bug fix — prevents a 5x re-dispatch loop on shells where task-plan verify lines are prefixed with `bash:` / `python3:` etc. Direct cherry-pick.
