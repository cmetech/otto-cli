verdict: do-not-port

# af9d27b — feat(pi): ADR-010 clean seam and vendor earendil-works/pi v0.75.5 (Phase 0–2)

## Target file(s)
- none (foundational sweep already absorbed in otto under a different rebrand)

## Divergence
This commit is the entire ADR-010 foundational refactor in gsd-pi: it creates `packages/gsd-agent-core` and `packages/gsd-agent-modes`, vendors `earendil-works/pi` v0.75.5 into `packages/pi-*` under the `@gsd/*` scope, adds `scripts/pi-upstream.json` pin metadata, rewrites build/verify orchestration, and migrates dozens of session/mode tests across the monorepo. Otto-cli already has the parallel result of this work: `packages/pi-coding-agent`, `packages/pi-tui`, `packages/pi-ai`, and `packages/pi-agent-core` exist under the `@otto/*` scope, and otto's agent session/mode code lives in `pi-coding-agent/` plus root `src/` rather than in `gsd-agent-core` / `gsd-agent-modes` packages. The `@gsd/` ↔ `@otto/` scope rebrand alone touches package.json files, tsconfig paths, every internal import, and every test fixture; the package layout is also genuinely different (no `gsd-agent-core` / `gsd-agent-modes` in otto). Cherry-picking would either explode in conflicts on every file or, if forced, replace otto's branded scope and layout with gsd-pi's.

## Concrete edits
1. (none — see below)

## Verdict
Do-not-port as a single commit. The work the commit represents is already structurally present in otto, just under a different package layout and `@otto/*` scope. Any actually-missing pieces from later upstream Phases should be ported as discrete narrow commits (the smaller `af968b9`, `b202c4e`, `b77bc3a` fixes in this same slice are exactly that). Re-applying the foundational commit would be destructive. Caveat: if anyone later finds an explicit boundary check (e.g. `verify:pi-boundary` script logic) that otto is missing, treat that as its own targeted port — not via this commit.
