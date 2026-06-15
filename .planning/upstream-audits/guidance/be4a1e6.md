verdict: do-not-port

# be4a1e6 — fix: clean up remaining opengsd package references

## Target file(s)
- none (cleanup of `@gsd-build/*` → `@opengsd/*` in upstream-only docs and tooling)

## Divergence
The commit renames stale `@gsd-build/...` references to `@opengsd/...` across:
- `docs/dev/2026-05-03-long-running-refactor-plan-of-plans.md`
- `docs/dev/superpowers/specs/2026-03-17-cicd-pipeline-design.md`
- `vscode-extension/package-lock.json` (otto has no vscode-extension)
- `web/lib/gsd-workspace-store.tsx` (otto has no `web/` directory)
- `web/package-lock.json` (same)

None of these files exist in otto. Otto's analog content is its own `docs/` (the recent UPSTREAM-PIPELINE runbook adds related operational guidance) and its own package scope under `@otto/*` (or `@cmetech/*`). The `@gsd-build/*` and `@opengsd/*` names are not relevant to otto's published packages.

## Concrete edits
1. (none)

## Verdict
Do-not-port. The commit is a brand-cleanup chore inside gsd-pi's own ecosystem (vscode extension, web app, internal refactor docs) — none of those surfaces exist in otto. Caveat: if otto ever finds stale `@gsd-build/*` strings in vendored docs or in scripts copied from gsd-pi, a parallel cleanup commit can be filed; this one's changes have no destination here.
