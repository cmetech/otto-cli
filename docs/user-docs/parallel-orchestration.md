# Parallel Milestone Orchestration

Run multiple milestones simultaneously in isolated git worktrees. Each milestone gets its own worker process, its own branch, and its own context window, while the shared project-root SQLite runtime tracks worker liveness, milestone ownership, dispatch status, retry windows, and control commands.

> **Status:** Behind `parallel.enabled: false` by default. Opt-in only — zero impact to existing users.
>
> **Single-host only:** Parallel workers must run on the same machine against a local project checkout. The coordination layer depends on SQLite WAL semantics on local disk and is not supported across machines or network-mounted filesystems.

## Quick Start

1. Enable parallel mode in your preferences:

```yaml
---
parallel:
  enabled: true
  max_workers: 2
---
```

2. Start parallel execution:

```
/otto parallel start
```

OTTO scans your milestones, checks dependencies and file overlap, shows an eligibility report, and spawns workers for eligible milestones.

3. Monitor progress:

```
/otto parallel status
```

4. Stop when done:

```
/otto parallel stop
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Coordinator (your OTTO session)                         │
│                                                         │
│  Responsibilities:                                      │
│  - Eligibility analysis (deps + file overlap)           │
│  - Worker spawning and lifecycle                        │
│  - Budget tracking across all workers                   │
│  - Command dispatch (pause/resume/stop)                 │
│  - Session status monitoring                            │
│  - Merge reconciliation                                 │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  ...          │
│  │ M001     │  │ M003     │  │ M005     │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│       │              │              │                   │
│       ▼              ▼              ▼                   │
│  .otto/workflow/worktrees/ .otto/workflow/worktrees/ .otto/workflow/worktrees/       │
│  M001/           M003/           M005/                  │
│  (milestone/     (milestone/     (milestone/            │
│   M001 branch)    M003 branch)    M005 branch)          │
└─────────────────────────────────────────────────────────┘
```

### Worker Isolation

Each worker is a separate `otto` process with complete isolation:

| Resource | Isolation Method |
|----------|-----------------|
| **Filesystem** | Git worktree — each worker has its own checkout |
| **Git branch** | `milestone/<MID>` — one branch per milestone |
| **State derivation** | `OTTO_MILESTONE_LOCK` env var — `deriveState()` only sees the assigned milestone |
| **Context window** | Separate process — each worker has its own agent sessions |
| **Metrics** | Project-root `.otto/workflow/metrics.json` remains the durable ledger; worktree diagnostics may be mirrored back there |
| **Crash recovery** | Coordination state stays anchored at the project root; per-worker locks and diagnostics are implementation details, not the source of truth |

### Coordination

Workers and the coordinator communicate through DB-backed coordination tables in `.otto/workflow/otto.db`:

- **`workers`** — registry of active auto-mode workers with heartbeat TTL and shutdown/crash status
- **`milestone_leases`** — one-worker-at-a-time milestone ownership with fencing tokens for safe takeover after expiry or release
- **`unit_dispatches`** — dispatch ledger that records claim, running, completed, failed, stuck, canceled, and retry timing state per unit
- **`command_queue`** — targeted or broadcast control commands claimed atomically by workers

If a worker stops heartbeating, its lease can expire and another worker can safely take over the milestone. Retry-aware stuck detection also consults the dispatch ledger so a unit waiting for `next_run_at` is not misclassified as stuck.

This model assumes local-disk locking semantics. Do not place the project on NFS/SMB/FUSE-style mounts or try to share `.otto/workflow/otto.db*` across hosts.

## Eligibility Analysis

Before starting parallel execution, OTTO checks which milestones can safely run concurrently.

### Rules

1. **Not complete** — Finished milestones are skipped
2. **Dependencies satisfied** — All `dependsOn` entries must have status `complete`
3. **File overlap check** — Milestones touching the same files get a warning (but are still eligible)

### Example Report

```
# Parallel Eligibility Report

## Eligible for Parallel Execution (2)

- **M002** — Auth System
  All dependencies satisfied.
- **M003** — Dashboard UI
  All dependencies satisfied.

## Ineligible (2)

- **M001** — Core Types
  Already complete.
- **M004** — API Integration
  Blocked by incomplete dependencies: M002.

## File Overlap Warnings (1)

- **M002** <-> **M003** — 2 shared file(s):
  - `src/types.ts`
  - `src/middleware.ts`
```

File overlaps are warnings, not blockers. Both milestones work in separate worktrees, so they won't interfere at the filesystem level. Conflicts are still possible at merge time, and the coordination guarantees only apply when all workers share the same local SQLite/WAL runtime on one host.

## Configuration

Add to `~/.otto/PREFERENCES.md` or `.otto/workflow/PREFERENCES.md`:

```yaml
---
parallel:
  enabled: false # Master toggle (default: false)
  max_workers: 2 # Concurrent workers (1-4, default: 2)
  budget_ceiling: 50.00 # Aggregate cost limit in dollars (optional)
  merge_strategy: "per-milestone" # When to merge: "per-slice" or "per-milestone"
  auto_merge: "confirm" # "auto", "confirm", or "manual"
---
```

### Configuration Reference

| Key              | Type                               | Default           | Description                                                                                                    |
| ---------------- | ---------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `enabled`        | boolean                            | `false`           | Master toggle. Must be `true` for `/otto parallel` commands to work.                                            |
| `max_workers`    | number (1-4)                       | `2`               | Maximum concurrent worker processes. Higher values use more memory and API budget.                             |
| `budget_ceiling` | number                             | none              | Aggregate cost ceiling in USD across all workers. When reached, no new units are dispatched.                   |
| `merge_strategy` | `"per-slice"` or `"per-milestone"` | `"per-milestone"` | When worktree changes merge back to main. Per-milestone waits for the full milestone to complete.              |
| `auto_merge`     | `"auto"`, `"confirm"`, `"manual"`  | `"confirm"`       | How merge-back is handled. `confirm` prompts before merging. `manual` requires explicit `/otto parallel merge`. |

## Commands

| Command | Description |
|---------|-------------|
| `/otto parallel start` | Analyze eligibility, confirm, and start workers |
| `/otto parallel status` | Show all workers with state, units completed, and cost |
| `/otto parallel stop` | Stop all workers (enqueues stop + sends SIGTERM) |
| `/otto parallel stop M002` | Stop a specific milestone's worker |
| `/otto parallel pause` | Pause all workers (finish current unit, then wait) |
| `/otto parallel pause M002` | Pause a specific worker |
| `/otto parallel resume` | Resume all paused workers |
| `/otto parallel resume M002` | Resume a specific worker |
| `/otto parallel merge` | Merge all completed milestones back to main |
| `/otto parallel merge M002` | Merge a specific milestone back to main |

## Command Lifecycle

The coordinator communicates with workers through persisted runtime commands:

```text
Coordinator                    Worker
    │                            │
    ├── enqueue("pause") ─────→  │
    │                            ├── claimNextCommand()
    │                            ├── pauseAuto()
    │                            │   (finish current unit, wait)
    │                            │
    ├── enqueue("resume") ────→  │
    │                            ├── claimNextCommand()
    │                            ├── resume dispatch loop
    │                            │
    ├── enqueue("stop") ──────→  │
    │   + SIGTERM ────────────→  │
    │                            ├── claimNextCommand() or SIGTERM handler
    │                            ├── stopAuto()
    │                            └── process exits
```

Workers poll the command queue between units and the coordinator also sends `SIGTERM` for immediate response on stop. Heartbeats and lease refreshes happen continuously during the loop, so `parallel status` reflects DB state rather than sidecar JSON files.

## Merge Reconciliation

When milestones complete, their worktree changes need to merge back to main.

### Merge Order

- **Sequential** (default): Milestones merge in ID order (M001 before M002)
- **By-completion**: Milestones merge in the order they finish

### Conflict Handling

1. Runtime coordination state (worker registry, leases, dispatches, cancellation requests, command queue) lives in the project-root SQLite runtime and is not merge-driven.
2. Code conflicts — **stop and report**. The merge halts, showing which files conflict. Resolve manually and retry with `/otto parallel merge <MID>`.

### Example

```text
/otto parallel merge

# Merge Results

- **M002** — merged successfully (pushed)
- **M003** — CONFLICT (2 file(s)):
  - `src/types.ts`
  - `src/middleware.ts`
  Resolve conflicts manually and run `/otto parallel merge M003` to retry.
```

## Budget Management

When `budget_ceiling` is set, the coordinator tracks aggregate cost across all workers:

- Cost is summed from each worker's session status
- When the ceiling is reached, the coordinator enqueues stop commands for workers
- Each worker also respects the project-level `budget_ceiling` preference independently

## Health Monitoring

### Doctor Integration

`/otto doctor` detects parallel session issues:

- **Stale workers or leases** — Worker process died without cleanup. Doctor inspects worker heartbeats and expired milestone leases in the database, then clears the stale coordination state.

Run `/otto doctor --fix` to clean up automatically.

### Stale Detection

Sessions are considered stale when:
- The worker PID is no longer running
- The last heartbeat is older than the worker TTL
- A milestone lease is released or expires without a matching active heartbeat

The coordinator runs stale detection during status refresh and either marks the worker crashed or allows the lease to be taken over on the next claim.

## Safety Model

| Safety Layer | Protection |
|-------------|------------|
| **Feature flag** | `parallel.enabled: false` by default — existing users unaffected |
| **Eligibility analysis** | Dependency and file overlap checks before starting |
| **Worker isolation** | Separate processes, worktrees, branches, context windows |
| **`OTTO_MILESTONE_LOCK`** | Each worker only sees its milestone in state derivation |
| **`OTTO_PARALLEL_WORKER`** | Workers cannot spawn nested parallel sessions |
| **Budget ceiling** | Aggregate cost enforcement across all workers |
| **Command queue + SIGTERM** | Graceful stop/pause/resume via DB-backed commands plus process signals |
| **Doctor integration** | Detects and cleans up orphaned sessions |
| **Conflict-aware merge** | Stops on code conflicts while runtime coordination state stays anchored in the shared DB |

## File Layout

```text
.otto/workflow/
├── otto.db                       # Shared runtime database
├── otto.db-wal / otto.db-shm      # SQLite WAL sidecars while workers are active
├── parallel/                    # Per-milestone runtime lock / isolation dirs
│   ├── M002/
│   └── M003/
├── worktrees/                   # Git worktrees (one per milestone)
│   ├── M002/                    # M002's isolated checkout
│   │   └── src/                 # M002's working copy
│   └── M003/
│       └── ...
└── ...
```

`.otto/workflow/otto.db*`, `.otto/workflow/parallel/`, and `.otto/workflow/worktrees/` are all local runtime artifacts and should remain gitignored.

## Troubleshooting

### "Parallel mode is not enabled"

Set `parallel.enabled: true` in your preferences file.

### "No milestones are eligible for parallel execution"

All milestones are either complete or blocked by dependencies. Check `/otto queue` to see milestone status and dependency chains.

### Worker crashed — how to recover

Workers now persist coordination state in the shared runtime DB. If a worker process dies, the coordinator detects heartbeat expiry, marks the worker as crashed, and releases stale coordination state so a replacement worker can resume safely.

1. Run `/otto doctor --fix` to clean up stale sessions
2. Run `/otto parallel status` to see current state
3. Re-run `/otto parallel start` to spawn new workers for remaining milestones

### Merge conflicts after parallel completion

1. Run `/otto parallel merge` to see which milestones have conflicts
2. Resolve conflicts in the worktree at `.otto/workflow/worktrees/<MID>/`
3. Retry with `/otto parallel merge <MID>`

### Workers seem stuck

Check if budget ceiling was reached: `/otto parallel status` shows per-worker costs. Increase `parallel.budget_ceiling` or remove it to continue.
