verdict: do-not-port

# ddf34c0 — fix: align pnpm execpath detection

## Target file(s)
- none (no otto equivalent)

## Divergence
One-line fix in `src/resources/shared/package-manager-detection.ts`: extend pnpm detection to also check `env.npm_execpath` (not just `argv1`). Otto-cli has no `src/resources/shared/package-manager-detection.ts` and no `isPnpmInstall` helper — `grep -rn 'isPnpmInstall\|pnpmBinDirs' src packages` in otto returns nothing. The closest analog is `detectPackageManager` inside `src/resources/extensions/workflow/detection.ts`, but that's a different function with a different shape (it returns a string like "npm"/"pnpm"/"bun" based on lockfile presence under a `basePath`, not based on argv/env at runtime).

## Concrete edits
1. None unless otto adds an upstream-style `isPnpmInstall` runtime detector in the future. If it does, replicate the `npm_execpath` fallback then.

## Verdict
Skip. No matching code path in otto. The bug only manifests where you're doing an argv1-based detection of how the running CLI was invoked, which otto does not do.
