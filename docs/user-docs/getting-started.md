<!-- OTTO Pi - Getting started guide -->

# Getting Started With OTTO2

OTTO2, published from this repository as OTTO Pi, is a local-first coding agent for planning, implementing, and verifying project work from your terminal.

This guide gets you from a clean machine to your first OTTO session.

## Prerequisites

Install these first:

| Requirement | Minimum | Recommended |
| --- | --- | --- |
| Node.js | 22.0.0 | 24 LTS |
| npm | Bundled with Node.js | Latest bundled LTS version |
| Git | 2.20 | Latest stable |
| Model provider credentials | One supported provider | The provider your team already uses |

Verify the basics:

```bash
node --version
npm --version
git --version
```

## Install OTTO Pi

Install the CLI globally from the scoped npm package:

```bash
npm install -g @cmetech/otto@latest
```

Confirm the command is available:

```bash
otto
```

If `otto` is not found, your npm global bin directory is probably not on `PATH`.

```bash
npm prefix -g
```

Add that directory's `bin` folder to your shell profile, then open a new terminal.

## Upgrade OTTO Pi

After the first install, upgrade to the latest release from your shell:

```bash
otto upgrade
```

`otto update` is an alias for the same command. Inside a OTTO session, use `/otto update` instead.

If `otto` reports a version mismatch with synced resources, or you previously installed the unscoped `otto-pi` package, see [Upgrade from older OTTO installs](./troubleshooting.md#upgrade-from-older-otto-2-installs) in Troubleshooting.

## Configure OTTO

Start OTTO:

```bash
otto
```

Then run the setup wizard inside the OTTO session:

```text
/otto config
```

The wizard walks through:

- model provider setup
- optional tool credentials
- default model and reasoning preferences
- local project/runtime settings

You can rerun it any time from inside OTTO:

```text
/otto config
```

## Start In A Project

Move into the repository you want OTTO to work on:

```bash
cd path/to/your-project
```

Start OTTO:

```bash
otto
```

On first run for a project, OTTO creates local project state under `.otto/workflow/`. This state tracks plans, milestones, tasks, decisions, session history, and runtime metadata.

## Create Your First Task

For a small change, start OTTO and use a quick task command:

```bash
otto
```

```text
/otto quick "Update the README with local setup instructions"
```

For planned work, start an interactive session:

```bash
otto
```

Inside the session, describe what you want to build. OTTO can help shape the request into milestones, slices, and tasks before implementing.

## Run Auto Mode

Auto mode lets OTTO continue through planning, implementation, verification, and handoff until it needs input or finishes the current unit of work.

```bash
otto
```

```text
/otto auto
```

Use auto mode when:

- the task is clearly described
- the project has a clean Git state
- you are comfortable letting OTTO create isolated worktrees and commits

Pause or stop auto mode from the session controls or with the relevant `/otto` command in the interactive UI.

## Check Status

Use status commands inside OTTO when you want to inspect progress before continuing:

```text
/otto status
```

In an interactive session, common commands include:

```text
/otto status
/otto auto
/otto next
/otto stop
/otto help
```

## Recommended First Workflow

1. Open a clean project checkout.
2. Run `otto`.
3. Run `/otto config`.
4. Ask OTTO to inspect the project and suggest the next small improvement.
5. Approve one focused task.
6. Let OTTO implement and verify it.
7. Review the Git diff and generated planning notes.

## Working With Git

OTTO expects Git to be the source of truth for code changes.

Before starting meaningful work:

```bash
git status
```

Start from a clean worktree when possible. OTTO can create task worktrees for isolated implementation, but your base checkout should still be understandable before you begin.

## Local Project State

OTTO stores project state in `.otto/workflow/`. Depending on your workflow, some generated markdown files may be useful to commit and review, while runtime/cache files should stay local.

When in doubt:

```bash
git status --short
```

Review generated files before committing them.

## Troubleshooting

If setup fails:

```bash
otto
```

```text
/otto doctor
```

If the CLI cannot find your provider credentials, rerun:

```text
/otto config
```

If a session gets stuck, check status first:

```text
/otto status
```

Then inspect logs or use the debugging tools documented in [Troubleshooting](./troubleshooting.md).

## Next Steps

- [Commands Reference](./commands.md) - learn the available `/otto` commands.
- [Configuration](./configuration.md) - tune model, reasoning, Git, and token settings.
- [Provider Setup](./providers.md) - connect the model provider your team uses.
- [Git Strategy](./git-strategy.md) - understand worktrees, branches, and merge behavior.
- [Auto Mode](./auto-mode.md) - run longer autonomous workflows safely.
- [Working in Teams](./working-in-teams.md) - configure shared-project workflows.
- [Skills](./skills.md) - discover and use bundled or custom skills.
- [Subagents](./subagents.md) - delegate isolated work when a task can split cleanly.
- [Parallel Orchestration](./parallel-orchestration.md) - run multiple milestones with worker isolation.
- [Cost Management](./cost-management.md) - set budgets and review usage.
- [Web Interface](./web-interface.md) - use the browser-based project surface.
- [Troubleshooting](./troubleshooting.md) - diagnose setup, provider, Git, and runtime issues.
