verdict: do-not-port

# 3fadba9 — fix: preserve hook preference file precedence

## Target file(s)
- src/resources/extensions/workflow/worktree-post-create-hook.ts (does not exist in otto)
- src/resources/extensions/workflow/auto-worktree.ts (otto's actual hook home)

## Divergence
gsd-pi keeps a standalone `worktree-post-create-hook.ts` whose `resolveConfiguredHookPath` builds its own ordered list of preference file candidates (`gsdHome()/PREFERENCES.md`, `gsdHome()/preferences.md`, `homedir/.pi/agent/gsd-preferences.md`, `gsdRoot/PREFERENCES.md`, `gsdRoot/preferences.md`). That bespoke list is what this commit reorders. Otto deleted the standalone module and inlined hook resolution into `auto-worktree.ts`'s `runWorktreePostCreateHook`, which reads the hook path via `loadEffectiveGSDPreferences()?.preferences?.git?.worktree_post_create`. Otto's `preferences.ts` already orders candidates as canonical `PREFERENCES.md` first, then legacy lowercase `preferences.md` via `loadPreferencesFile(globalPreferencesPath(), "global") ?? loadPreferencesFile(legacyGlobalPreferencesPathLowercase(), "global") ?? loadPreferencesFile(legacyGlobalPreferencesPath(), "global")`. The same canonical-first ordering applies at project scope.

## Concrete edits
1. None — otto's `loadEffectiveGSDPreferences` already returns the canonical preference, so the worktree hook resolved through it inherits the correct precedence.

## Verdict
Skip. Architecturally moot in otto: the bug existed in gsd-pi's hard-coded path list inside `worktree-post-create-hook.ts`, but that file no longer exists in otto and the consolidated loader otto uses is already correct. The companion test additions can also be skipped since they re-assert behavior otto already has via `preferences.ts`-level tests.
