verdict: manual-port

# 7faba93 — fix: make validate-pack pass with pnpm workspace protocol

## Target file(s)
- scripts/validate-pack.js
- scripts/prepack-resolve-workspace.cjs (new)
- scripts/postpack-restore-workspace.cjs (new)
- scripts/lib/version-sync.cjs
- package.json
- .gitignore

## Divergence
Otto already uses pnpm and has `scripts/validate-pack.js` and `scripts/lib/version-sync.cjs`. Otto does NOT currently have `prepack-resolve-workspace.cjs` / `postpack-restore-workspace.cjs`, so this introduces a new packaging pre/post step. Otto's `package.json` has its own scripts and optionalDependencies (per memory: version-sync.test pins them); the prepack hook addition must be merged carefully and the resolve script needs to handle otto's actual workspace dependency graph.

## Concrete edits
1. Add `scripts/prepack-resolve-workspace.cjs` and `scripts/postpack-restore-workspace.cjs` from upstream verbatim; review the package list against `pnpm-workspace.yaml` to ensure otto's workspace packages are covered.
2. Apply the `scripts/validate-pack.js` hardening hunks (bundled transitive deps + tarball handling).
3. Add the version-sync.cjs addition (one line) and the .gitignore additions.
4. Merge the `package.json` script additions (`prepack` / `postpack` wiring + bundledDependencies) into otto's package.json without clobbering otto-specific entries. Re-run `pnpm install` to refresh `pnpm-lock.yaml`.
5. Run `node scripts/validate-pack.js` and `pnpm pack` end-to-end to confirm.

## Verdict
Real packaging fix relevant since otto already migrated to pnpm. Manual-port because the package.json edit and lockfile drift require human merge; the new scripts are standalone and copy clean.
