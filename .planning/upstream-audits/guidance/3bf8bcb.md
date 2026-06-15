verdict: do-not-port

# 3bf8bcb — feat(gsd): scope skill catalog and trim duplicate prompt surfaces

## Target file(s)
- (none in otto-cli)

## Divergence
Large feature touching 15 gsd-extension files: `auto.ts`, `auto/run-unit.ts`, `bootstrap/register-hooks.ts`, `bootstrap/system-context.ts`, `guided-flow.ts`, `preferences.ts`, `prompts/system.md`, `skill-activation.ts`, `skill-discovery.ts` (removed), `skill-scope.ts` (new), three gsd tests, `docs/token-consumption-savings-evidence.md`, and `src/resources/extensions/create-skill/references/gsd-skill-ecosystem.md`. The feature wires manifest-based `setVisibleSkills` into gsd's auto-mode per-unit sessions. Otto-cli does not ship the gsd extension, has no `skill-activation/discovery/scope` modules, no `auto/run-unit.ts`, and uses a different skill surfacing pipeline (the otto `surface` skill).

## Concrete edits
1. No otto-cli files to edit.
2. The "trim duplicate prompt surfaces" intent could conceptually inform otto's own skill-surfacing if growth pressure ever hits, but the upstream code is too gsd-coupled to port directly.

## Verdict
Upstream-only feature. Otto-cli's skill management is a different design (e.g. the existing `surface` toggle skill) and would require redesign rather than a port to absorb this.
