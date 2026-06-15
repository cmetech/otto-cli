verdict: do-not-port

# e5af6d9 — fix(issue): worktree isolation: agent writes code to project root instead of worktree

## Target file(s)
- none

## Divergence
All eight changed files live under `src/resources/extensions/gsd/prompts/` (complete-slice.md, execute-task.md, plan-milestone.md, plan-slice.md, reassess-roadmap.md, replan-slice.md, research-milestone.md, run-uat.md). otto-cli has no `src/resources/extensions/gsd/` directory — its extensions live under `src/resources/extensions/otto/`, `ollama/`, `claude-code-cli/`, `coworker-*`, etc. The worktree-isolation prompt-rewriting instruction is a property of the GSD slash-command playbook surface and does not have an analog in otto-cli.

## Concrete edits
1. None.

## Verdict
GSD-extension-only prompt fix. otto-cli does not ship the GSD slash-command extension, so there is no surface to receive the change.
