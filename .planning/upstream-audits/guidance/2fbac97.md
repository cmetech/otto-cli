verdict: do-not-port

# 2fbac97 — fix: replace leaked absolute developer paths in docs and test fixtures

## Target file(s)
- (none in otto-cli)

## Divergence
All touched paths are upstream-only artifacts: `docs/dev/ADR-008/009-IMPLEMENTATION-PLAN.md`, `docs/dev/ADR-009-orchestration-kernel-refactor.md`, `docs/dev/tui-recommended-design.html`, `docs/dev/tui-render-options.html`, `src/modes/interactive/components/__tests__/tool-execution.test.ts`, and gsd-extension tests. Otto-cli does not maintain these ADR planning docs, the TUI design HTML mockups, or the `src/modes/interactive` test fixture, and does not contain the `~/Github/gsd-2` strings that the patch was scrubbing.

## Concrete edits
1. No otto-cli files to edit.
2. Skip — fixes documentation artifacts and fixtures that don't exist in otto-cli.

## Verdict
Doc/fixture hygiene specific to a gsd-pi contributor's tree. Nothing portable to otto-cli.
