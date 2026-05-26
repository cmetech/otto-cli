# Full Project Workflow

<template_meta>
name: full-project
version: 1
mode: auto-milestone
requires_project: true
artifact_dir: .otto/workflow/
</template_meta>

<purpose>
The complete OTTO workflow with full ceremony: roadmap, milestones, slices, tasks,
research, planning, execution, and verification. Use for greenfield projects or
major features that need the full planning apparatus.

This template wraps the existing OTTO workflow for registry completeness.
When selected, it routes to the standard /otto init → /otto auto pipeline.
</purpose>

<phases>
1. init    — Initialize project, detect stack, create .otto/workflow/
2. discuss — Define requirements, decisions, and architecture
3. plan    — Create roadmap with milestones and slices
4. execute — Execute slices: research → plan → implement → verify per slice
5. verify  — Milestone-level verification and completion
</phases>

<process>

## Routing to Standard OTTO

This template is a convenience entry point. When selected via `/otto start full-project`,
it should route to the standard OTTO workflow:

1. If `.otto/workflow/` doesn't exist: Run `/otto init` to bootstrap the project
2. If `.otto/workflow/` exists but no milestones: Start the discuss phase via `/otto discuss`
3. If milestones exist: Resume via `/otto auto` or `/otto next`

The full OTTO workflow protocol is defined in `WORKFLOW.md` and handles all
phases, state tracking, and agent orchestration.

</process>
