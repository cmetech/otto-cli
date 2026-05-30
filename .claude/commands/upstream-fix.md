---
description: Implement filed upstream-cherry-pick issues (file-disjoint lanes, four confidence gates, one PR).
argument-hint: "<filter> e.g. --severity critical-stability | --issues 62,63 | --all [--dry-run] [--resume]"
---

Invoke the `upstream-fix` skill to implement filed `cmetech/otto-cli` issues.

Arguments: $ARGUMENTS

Follow `.claude/skills/upstream-fix/SKILL.md` exactly. Honor every locked
invariant (≤3 lanes, four mandatory gates, never force-push, never commit to
main directly, low-confidence ⇒ comment + unresolved). Keep the controller
context flat: drive the `.mjs` scripts, dispatch subagents for the heavy work,
and never read diffs/guidance/logs into your own context.
