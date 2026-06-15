verdict: manual-port

# b3cdecc — fix: prevent false-positive approval gate re-trigger after depth verification

## Target file(s)
- /Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli/src/resources/extensions/workflow/bootstrap/register-hooks.ts
- /Users/coreyellis/code/github.com/cmetech/otto_app/otto-cli/src/resources/extensions/workflow/guided-flow.ts

## Divergence
The commit lives entirely in the GSD extension at upstream `src/resources/extensions/gsd/`, which in otto is `src/resources/extensions/workflow/`. Otto already has all the prerequisite helpers: `bootstrap/write-gate.ts` exports `isMilestoneDepthVerified` and `extractDepthVerificationMilestoneId` (lines 254 and 323), `bootstrap/register-hooks.ts` carries `approvalGateIdForUnit` and `deferApprovalGate` at the same call site (line 749), and `guided-flow.ts` has the R3b belt-and-suspenders branch at line 683. The path renames (`gsd-db` → `db`, `gsd-extension-api` → otto equivalent) and the user-facing log strings (`"R3b: getMilestone(...) returned null but manifest has the row"`) match upstream verbatim. The patch is two narrow guarded-branch additions: (Fix A) inside the `deferApprovalGate(gateId, ...)` call in register-hooks, short-circuit the defer when the milestone is already depth-verified; (Fix B) in guided-flow.ts's R3b region, when `getMilestone(milestoneId)` returns null and the manifest does not have the row but CONTEXT.md exists on disk, auto-recover by inserting a placeholder `queued` milestone row.

## Concrete edits
1. In `workflow/bootstrap/register-hooks.ts`:
   - Add `isMilestoneDepthVerified` to the existing destructured import from `./write-gate.js`.
   - At the call site around line 749–750, replace `if (gateId) deferApprovalGate(gateId, contextBasePath(ctx));` with the upstream guarded form: extract `gateMilestoneId` via `extractDepthVerificationMilestoneId(gateId)`; if it's truthy and `isMilestoneDepthVerified(gateMilestoneId, contextBasePath(ctx))` is true, `return` without deferring. Otherwise defer as today. Keep the existing structure (the `shouldPauseForUserApprovalQuestion` check, `approvalQuestionAbortInFlight = true`, `ctx.ui.notify(...)` call) intact.
2. In `workflow/guided-flow.ts`:
   - Update the import from `./db.js` (otto's renamed gsd-db) to also pull in `insertMilestone` alongside `isDbAvailable`, `getMilestone`, `getMilestoneSlices`.
   - In the R3b branch (around line 683–698), in the existing `else if (manifestHasMilestone)` chain, add a new sibling `else if (contextFile)` branch: log the warning `R3b: ${milestoneId} has CONTEXT.md but no DB row — inserting placeholder "queued" row for Gate 1b recovery` and call `insertMilestone({ id: milestoneId, title: milestoneId, status: "queued" })` inside a try/catch that logs failures.
3. Run the workflow extension test suite, in particular any tests around `gsd_plan_milestone` / discuss-flow gates.

## Verdict
Manual-port. The bug class — text-based approval gate matching post-verification prose and corrupting subsequent `gsd_plan_milestone` flow — applies to otto: the gating helpers and the R3b branch exist there too, but neither short-circuit is present. The port is small (one guarded early-return, one new else-if branch) and the helpers it needs already exist. Caveat: confirm otto's `insertMilestone` signature matches `{ id, title, status }`; if otto's accessor differs, adapt to the equivalent insert helper.
