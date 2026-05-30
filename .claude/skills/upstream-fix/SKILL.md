---
name: upstream-fix
description: >
  Implement filed upstream-cherry-pick issues on cmetech/otto-cli. Selects
  issues by grouping (severity, type, label, numbers, or all), fixes each on
  a file-disjoint git-worktree lane via parallel subagents (cap 3), gates
  every fix on a regression test, build, targeted+full suite, and an
  independent reviewer subagent, integrates accepted fixes into one PR, and
  closes the issues. Use when asked to "implement the critical upstream
  fixes", "port the cherry-pick candidates", or "fix the filed upstream
  issues". Highest-stakes skill — it changes otto-cli source.
---

# Upstream-Fix

(Body written in Task 12; this is the registry stub.)
