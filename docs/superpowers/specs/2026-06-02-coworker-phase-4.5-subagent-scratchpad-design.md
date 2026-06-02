# Phase 4.5 — Subagent-scratchpad scoping design

**Status:** Approved 2026-06-02 (brainstorming complete; spec written for plan input).
**Phase name:** Phase 4.5 — Subagent-scratchpad scoping.
**Branch:** `feat/coworker-phase-4.5-subagent-scratchpad` (created from `main` at `eb95f88` — Phase 4 + v1.2.4 bump).
**Parent specs:**
- `docs/superpowers/specs/2026-05-30-otto-coworker-design.md` §2.4 (scratchpad pillar).
- `docs/superpowers/specs/2026-06-02-coworker-phase-3.1-activators-design.md` (activator + cross-pillar wiring pattern).
- Existing subagent extension at `src/resources/extensions/subagent/` (upstream pi-coding-agent feature).

---

## 1 Goal

When the existing `subagent` extension (`src/resources/extensions/subagent/index.ts`) spawns a separate `pi` child process for a delegated task, the child should attach to its **own dedicated scratchpad** — auto-minted as `subagent-<agent-name>-<6-hex>` — instead of falling back to the parent's `default` or running unattached. This prevents subagent cell executions from colliding with the parent's investigation state, while letting subagent-produced artifacts and memory drawers flow naturally up to the workspace level where the parent can inspect them via `/artifacts list` and `/memory recall`.

The bar is concrete: dispatch a subagent that calls `otto.artifact.create()` from a cell. The scratchpad at `~/.otto/scratchpads/subagent-<id>/` exists with its own kernel state. The artifact lands at workspace `.otto/artifacts/<slug>/` with a `kind:'artifact'` drawer in memory tagged `room=subagent-<id>`. After the subagent exits, the parent's session can `/sp attach subagent-<id>` and inspect the kernel — loaded data, cell history, namespace globals all preserved.

## 2 Non-goals

- **TTL-based auto-cleanup** of subagent scratchpads. They persist until manual `/sp remove`. Add a sweeper when filesystem cruft becomes a real problem.
- **Subagent-level cleanup UI** (`/subagent prune-scratchpads`). v2 if asked.
- **Caller-specified scratchpad name override.** Locked to auto-mint per brainstorming §3.1.
- **Cross-subagent scratchpad reuse coordination.** Chain-mode subagents each get their own scratchpad; if the user wants shared state they manually plumb it.
- **Worktree-isolated scratchpads.** The subagent extension's `IsolationMode` (`none | worktree | fuse-overlay`) affects filesystem layout; scratchpad attachment is process-session-scoped and orthogonal to worktree isolation. Both can coexist; no new coupling.
- **New CLI flag `--scratchpad <name>`** on `pi`. Locked to env-var discovery per brainstorming §3.3.
- **Explicit return-value augmentation** (e.g., `artifacts_created: [...]` in subagent JSON output). Workspace-level state IS the handoff per brainstorming §3.4.

## 3 Locked decisions

| # | Decision | Rationale |
|---|---|---|
| 3.1 | **Auto-mint scratchpad name `subagent-<sanitized-agent>-<6-hex>`.** No caller override. | Zero ceremony for the LLM caller; no chance of collision with parent or sibling subagents. Reuses the `crypto.randomBytes(3).toString('hex')` entropy budget Phase 3 uses for workspace-id. |
| 3.2 | **Persistent scratchpad — survives subagent exit.** | Matches scratchpad philosophy (state outlives sessions). Parent can `/sp attach` post-hoc to inspect. Manual cleanup via `/sp remove`. |
| 3.3 | **Discovery via env var `OTTO_SUBAGENT_SCRATCHPAD`.** | Matches existing `OTTO_SUBAGENT_CHILD=1` pattern at `launch.ts:8`. Symmetric with the established subagent env convention. No CLI surface change. |
| 3.4 | **No additional result handoff.** Subagent's JSON `--mode json` output is unchanged. Artifacts + memory drawers flow up at workspace level. | Workspace state IS the handoff. Parent's `/artifacts list` + `/memory recall` see everything the subagent produced. |
| 3.5 | **Slug sanitization matches Phase 4 artifact slug rules.** Lowercase ASCII kebab, max 64 chars, fallback `subagent-<hex>` for empty input. | Reuses validated logic. Same `deriveSlug` helper from `@otto/coworker-artifacts`. |
| 3.6 | **Force-attach bypasses sidecar/pointer restore.** When env var is set, scratchpad activator's `session_start` skips `tryRestoreCurrentName()` and goes straight to attach-or-create. | Subagent process must NOT inherit parent's last-attached scratchpad via workspace pointer. |
| 3.7 | **Idempotent re-attach.** If env var matches an existing scratchpad name (e.g., chain-mode reuse or retry), activator attaches to existing. | Phase 1 cross-process lock + meta.json handles this already; no new logic needed beyond the if/else. |
| 3.8 | **Subagent run record gains `scratchpad_name?` field.** Persisted in `run-store.ts` for debugging + future `/subagent runs` UX. | Tiny addition; lets ops trace which subagent produced which kernel state. |

## 4 Architecture

```
Parent Otto session                          Child pi process (subagent)
┌─────────────────────────────┐              ┌─────────────────────────────┐
│ subagent ext tool execute() │              │ pi --mode json -p ...       │
│                             │              │ env: OTTO_SUBAGENT_CHILD=1  │
│ For each task in            │              │      OTTO_SUBAGENT_         │
│ {single, parallel, chain}:  │              │      SCRATCHPAD=<name>      │
│                             │              │                             │
│ 1. mintSubagentScratchpad   │              │ Extensions load:            │
│    Name(agent.name)         │              │   coworker-scratchpad       │
│    → 'subagent-<a>-<6hex>'  │              │     ↓ session_start         │
│                             │              │     reads env var           │
│ 2. buildSubagentProcessEnv  │  spawn       │     ↓                       │
│    (parentEnv, name)        │  ─────►      │   forceSubagentAttach(name) │
│    injects env var          │              │     - validate slug         │
│                             │              │     - if scratchpad         │
│ 3. spawn pi child           │              │       missing → create      │
│                             │              │     - setCurrentName(name)  │
│ 4. update run record:       │              │     - persist sidecar       │
│    {scratchpad_name: name}  │              │                             │
└─────────────────────────────┘              │ Cells run via /sp tool:     │
                                             │   otto.collectors.open()    │
                                             │   otto.artifact.create()    │
                                             │                             │
                                             │ Workspace-level writes:     │
                                             │   .otto/artifacts/...       │
                                             │   .otto/memory/layer-b.db   │
                                             │     (room=subagent-<id>)    │
                                             │                             │
                                             │ Process exits.              │
                                             │ Scratchpad persists.        │
                                             │ Sidecar persists.           │
                                             └─────────────────────────────┘

Parent later (same or future session):
  /sp list                                   → sees subagent-<id> in the list
  /sp attach subagent-<id>                   → inspects kernel state, cells
  /artifacts list                            → artifacts subagent produced
  /memory recall <query>                     → finds kind:'artifact' drawers,
                                              room=subagent-<id>
```

**Activation order:** subagent extension calls `spawn` synchronously after minting the name. Child's `session_start` runs the modified scratchpad activator which reads the env var BEFORE any restore logic. By the time the agent loop starts in the child, the scratchpad is attached.

**Failure isolation:** if force-attach fails (invalid slug, disk error), activator logs warning + falls through to normal restore (which usually means no attachment). Subagent process continues; cell execution fails with the standard "no scratchpad attached" message. Subagent dispatcher in parent gets a normal subagent-exit return.

## 5 Module responsibilities

### 5.1 `src/resources/extensions/subagent/launch.ts` (MODIFY)

| Surface | Change |
|---|---|
| `SUBAGENT_CHILD_ENV_VAR = 'OTTO_SUBAGENT_CHILD'` (existing) | unchanged |
| NEW `SUBAGENT_SCRATCHPAD_ENV_VAR = 'OTTO_SUBAGENT_SCRATCHPAD'` | env-var constant |
| `buildSubagentProcessEnv(parentEnv?)` (existing) | extend signature to optionally take a `scratchpadName: string` param; when supplied, inject `OTTO_SUBAGENT_SCRATCHPAD=<name>` into the returned env. Backward-compatible (param optional). |
| `buildShellEnvAssignments(parentEnv?)` (existing) | parallel update — include the scratchpad var in shell-form when present. |
| NEW `mintSubagentScratchpadName(agentName: string): string` | pure helper. Sanitizes `agentName` (lowercase ASCII kebab, max 32 chars to leave room for prefix + suffix); produces `subagent-<sanitized>-<6-hex>`. Empty input → `subagent-<6-hex>`. Reuses `deriveSlug`-style logic; uses `crypto.randomBytes(3).toString('hex')`. |

### 5.2 `src/resources/extensions/subagent/index.ts` (MODIFY)

In each subagent-dispatch path (single, parallel, chain), at the point just before `spawn(...)`:

```typescript
const scratchpadName = mintSubagentScratchpadName(task.agent);
const env = buildSubagentProcessEnv(process.env, scratchpadName);
const child = spawn('pi', args, { env, ... });
// ... existing tracking + run record update:
updateRunRecord(runId, (r) => ({ ...r, scratchpad_name: scratchpadName }));
```

The `task.agent` field already exists in the schema. No tool-schema change.

### 5.3 `src/resources/extensions/subagent/run-store.ts` (MODIFY)

Add `scratchpad_name?: string` to `SubagentRunRecord`. Read-back during `/subagent list` shows it (existing render code adapts trivially).

### 5.4 `src/resources/extensions/coworker-scratchpad/index.ts` (MODIFY)

Inside `session_start` handler, BEFORE `tryRestoreCurrentName`:

```typescript
const subagentName = process.env.OTTO_SUBAGENT_SCRATCHPAD;
if (subagentName) {
  try {
    await forceSubagentAttach(subagentName, root, ctx);
    currentName = subagentName;
    ctx.ui.notify(`attached to ${subagentName} (subagent dispatch)`, 'info');
    return;  // skip restore + sweep paths
  } catch (err) {
    ctx.ui.notify(`subagent scratchpad attach failed: ${(err as Error).message}; continuing without`, 'warning');
    // fall through to normal restore
  }
}
// existing tryRestoreCurrentName + sweep path
```

NEW helper `forceSubagentAttach(name, scratchpadsRoot, ctx)`:
- Validate `name` against the slug regex `^subagent-[a-z0-9-]+$` (max 80 chars).
- If `<root>/<name>/meta.json` exists → attach (just write sidecar pointing at it).
- Else → mkdir `<root>/<name>` with mode 0o700, write `meta.json` (the Phase 1 schema), persist sidecar.

The function uses the existing `ScratchpadManager` or its underlying Phase 1 helpers — no new persistence surface.

### 5.5 Tests

**`src/resources/extensions/subagent/launch.test.ts` (CREATE or extend):**
- `mintSubagentScratchpadName('rca-analyst')` → matches `^subagent-rca-analyst-[0-9a-f]{6}$`.
- `mintSubagentScratchpadName('')` → matches `^subagent-[0-9a-f]{6}$`.
- `mintSubagentScratchpadName('UPPER & weird!! chars')` → matches `^subagent-upper-weird-chars-[0-9a-f]{6}$`.
- `buildSubagentProcessEnv(parentEnv, 'subagent-foo-abc123')` includes `OTTO_SUBAGENT_SCRATCHPAD=subagent-foo-abc123` AND `OTTO_SUBAGENT_CHILD=1`.
- `buildSubagentProcessEnv(parentEnv)` (no name) does NOT include the scratchpad var.

**`src/resources/extensions/coworker-scratchpad/index.test.ts` (EXTEND):**
- `OTTO_SUBAGENT_SCRATCHPAD=subagent-foo-abc123` set + scratchpad doesn't exist → creates it + attaches.
- Env var set + scratchpad EXISTS (re-run, chain reuse) → attaches without recreating.
- Env var unset → existing restore logic untouched (regression).
- Env var set to invalid name → warning notify + falls through to restore.

### 5.6 Smoke checklist

`docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md` covering:

1. Launch Otto in fresh workspace.
2. Dispatch subagent: `/subagent rca-analyst "investigate the load-balancer 503s"`.
3. Verify `~/.otto/scratchpads/subagent-rca-analyst-<6hex>/` exists with `meta.json`.
4. Subagent runs cells producing an artifact.
5. After subagent exits: `/sp list` shows the subagent scratchpad.
6. `/sp attach subagent-rca-analyst-<6hex>` succeeds; kernel state visible.
7. `/artifacts list` shows artifacts produced by subagent.
8. `/memory recall <query> --room subagent-rca-analyst-<6hex>` returns drawer.

PENDING placeholder for live-verified date.

### 5.7 Roadmap update

`docs/superpowers/notes/2026-06-01-coworker-roadmap.md`:

```markdown
### Phase 4.5 — Subagent-scratchpad scoping — COMPLETE

Subagent dispatcher auto-mints a dedicated scratchpad per child process
(`subagent-<agent>-<6-hex>`); child `pi` reads `OTTO_SUBAGENT_SCRATCHPAD`
env var at `session_start` and force-attaches before any sidecar/pointer
restore. Scratchpads persist after subagent exit; parent inspects via
`/sp attach <name>`. Run records track `scratchpad_name`. Artifacts + memory
drawers flow up to workspace level as before; subagent drawers tagged
`room=subagent-<id>` for filtering.
```

## 6 Error policy

| Failure | Policy | User-visible |
|---|---|---|
| Env var set to invalid slug | Warning notify + fall through to normal restore | `subagent scratchpad attach failed: invalid name; continuing without` |
| mkdir scratchpad fails (perms) | Same — warning + fall through | Same shape |
| meta.json write fails | Same | Same |
| Existing scratchpad meta.json malformed | Treat as missing → re-create (Phase 1 already does this for restore path) | `attached to <name> (recovered)` |
| Subagent extension fails to mint name | Subagent dispatch fails entirely (this would mean `crypto.randomBytes` failed — never happens in practice) | Subagent tool returns error to parent |

## 7 Edge cases

- **Same agent dispatched twice in parallel** — Each gets its own 6-hex suffix; collisions astronomically unlikely. If collision somehow happens, `forceSubagentAttach` is idempotent — both attach to the same scratchpad. Cells from both interleave; not the intent, but won't corrupt state (Phase 1 cross-process lock serializes cell execution).
- **Chain mode** — Each step's subagent invocation mints a fresh name; chain steps DO NOT share scratchpad by default. If a chain step wants to read its predecessor's artifact, it reads via `artifact://<slug>` URL passed in the prompt.
- **Subagent calls `/sp new <other-name>`** — Subagent's own session can run any `/sp` commands. The initial force-attach is the starting state; subagent can switch. Behavior is identical to a normal session calling `/sp new`.
- **Parent session attaches to a subagent scratchpad while subagent is still running** — Phase 1's cross-process lock prevents concurrent cell execution; the second attacher gets the staleness banner. Standard Phase 1 behavior.
- **Sidecar collision between parent + subagent** — Subagent has its own sessionId (fresh child process), so its sidecar at `<root>/<subagent-name>/sessions/<subagent-session-id>.json` is distinct from the parent's. No collision.

## 8 Testing strategy

- **Unit:** `launch.test.ts` (mint + env helpers), `coworker-scratchpad/index.test.ts` (force-attach branch). 4 + 4 = 8 new tests minimum.
- **Integration:** Optional integration test that spawns a real `pi` child via the subagent dispatcher and asserts the scratchpad exists post-exit. May be expensive (real subprocess spawn); plan-phase implementer can decide whether to ship it. If not, smoke checklist covers it.
- **Regression:** Existing subagent tests (`src/resources/extensions/subagent/tests/`) must continue to pass. Existing coworker-scratchpad tests must continue to pass.

## 9 Milestone

When this phase merges:

1. A `/subagent rca-analyst "..."` dispatch produces a dedicated scratchpad at `~/.otto/scratchpads/subagent-rca-analyst-<6hex>/`.
2. Subagent's `otto.artifact.create()` calls produce artifacts at workspace level.
3. Subagent's user-turn auto-retain drawers are tagged `room=subagent-<id>`.
4. After subagent exit, `/sp attach subagent-<id>` from the parent session succeeds; loaded data + cell history accessible.
5. `/memory recall <q> --room subagent-<id>` filters to subagent drawers.
6. Run record at `~/.otto/agent.db` (or wherever `run-store.ts` writes) has `scratchpad_name` field populated.
7. Strict `tsc` (`npm run build`) clean.

## 10 Out-of-scope (recap)

- TTL-based auto-cleanup; `/subagent prune-scratchpads` UX. Add when filesystem cruft becomes a problem.
- Caller-specified scratchpad name override.
- Cross-subagent scratchpad reuse coordination.
- Worktree-isolated scratchpads (orthogonal — both work; no new coupling).
- `--scratchpad <name>` CLI flag.
- Explicit return-value augmentation in subagent JSON.

## Appendix A — file change summary

| Path | Action | LOC est |
|---|---|---|
| `src/resources/extensions/subagent/launch.ts` | Modify (constant + `mintSubagentScratchpadName` + `buildSubagentProcessEnv` extend) | +40 |
| `src/resources/extensions/subagent/launch.test.ts` | Create (or extend if exists) | +60 |
| `src/resources/extensions/subagent/index.ts` | Modify (3 call sites — single/parallel/chain — mint + env injection + run record update) | +15 |
| `src/resources/extensions/subagent/run-store.ts` | Modify (add `scratchpad_name?` field) | +3 |
| `src/resources/extensions/coworker-scratchpad/index.ts` | Modify (forceSubagentAttach helper + session_start branch) | +60 |
| `src/resources/extensions/coworker-scratchpad/index.test.ts` | Extend (+4 tests) | +80 |
| `docs/superpowers/notes/2026-06-02-phase-4.5-subagent-scratchpad-smoke.md` | Create | +50 |
| `docs/superpowers/notes/2026-06-01-coworker-roadmap.md` | Append Phase 4.5 entry | +10 |

Total: ~320 LOC delta (smaller than Phase 3.1; much smaller than Phase 4).

## Appendix B — task ordering (informs the plan)

Bottom-up, ~5 atomic commits:

1. `launch.ts` mint helper + env-var extension + unit tests.
2. `coworker-scratchpad` force-attach branch + unit tests.
3. `subagent/index.ts` integration — wire mint + env injection at the 3 spawn sites; run-store field.
4. Smoke checklist + roadmap update.
5. Branch-level build + final review.

Smaller plan; ~5 tasks vs Phase 4's 16.

---

## Self-review

**Placeholder scan:** No `TBD`/`TODO`/`???`. Every locked decision has a rationale. Every module change has a defined surface.

**Internal consistency check:**
- `OTTO_SUBAGENT_SCRATCHPAD` env var name consistent across §3.3, §4, §5.1, §5.4, §6, §7.
- Slug shape `subagent-<agent>-<6-hex>` consistent across §3.1, §3.5, §5.1, §5.4 (regex), §5.5 tests.
- Force-attach bypasses restore: explicit in §3.6, §5.4 code shape, §7 sidecar-collision case.
- Persistent lifecycle: explicit in §3.2, §5.6 step 5, §9 milestone item 4.

**Scope check:** Single small phase. ~320 LOC delta. 5 tasks. Single implementation plan.

**Ambiguity check:**
- "Force-attach idempotent" — §3.7 + §7 same-agent-parallel case make this concrete.
- "Scratchpad persists" — §3.2 + §9 + §5.6 all consistent.
- "Validate slug" — §5.4 specifies the regex (`^subagent-[a-z0-9-]+$`, max 80).

No drift.

---

## Execution Handoff

Spec complete. Next step: invoke `superpowers:writing-plans` skill to produce the executable Phase 4.5 plan from this spec.
