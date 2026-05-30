verdict: do-not-port

# 7dad27e — fix(coding-agent): avoid duplicate bash truncation path

## Target file(s)
- Upstream touches packages/coding-agent/src/core/tools/bash.ts `rebuildBashResultRenderComponent` and test/tool-execution-component.test.ts.
- otto-cli equivalent: NO equivalent function. `rebuildBashResultRenderComponent` does not exist in packages/pi-coding-agent/src; `tool-execution-component.test.ts` does not exist.

## Divergence
Fundamentally diverged. The fix dedups a "Full output:" footer that upstream's `rebuildBashResultRenderComponent` re-appends during final render. otto-cli renders bash results via a different `ToolExecutionComponent` path and builds the truncation footer once, inline in bash.ts's execute() (lines ~419-438: `[Showing lines X-Y of Z. Full output: ...]`). There is no second render-time append to dedup, so the upstream bug/fix has no corresponding code site.

## Concrete edits
None applicable. Before finalizing, sanity-check otto's `ToolExecutionComponent` render of a truncated bash result to confirm it does not double-emit the "Full output:" / "[Showing lines ...]" footer. If a duplicate IS observed there, that would be a separate otto-native fix, not a port of this commit.

## Verdict
do-not-port — target function/test absent and otto's render architecture differs; the specific duplicate-path bug does not exist here. Recommend a quick manual confirmation that otto's tool-execution render shows the footer only once.
