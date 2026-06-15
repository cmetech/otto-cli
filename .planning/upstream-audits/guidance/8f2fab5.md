verdict: manual-port

# 8f2fab5 — fix(bootstrap): exit on EPIPE storm instead of swallowing in a tight loop

## Target file(s)
- src/resources/extensions/workflow/bootstrap/register-extension.ts

## Divergence
Otto's `handleRecoverableExtensionProcessError` is structurally older than upstream's: it only special-cases `errno === "EPIPE"` directly (line 32), has no `isPipeClosedError` abstraction, no `EPIPE_STORM_*` window counters, and no `safeStderr` re-entrancy guard. Otto also already calls `writeCrashLog(err, "EPIPE")` for every EPIPE (line 33), which means the storm condition is even worse on otto (every EPIPE writes a crash file). All log/branding strings use `[otto]` and reference `~/.otto/workflow/crash/`. The Windows `write EOF` / `read EOF` variant is NOT recognized in otto's current code, so otto has the same Windows-bug surface upstream fixes.

## Concrete edits
1. Add module-level constants `const EPIPE_STORM_THRESHOLD = 100; const EPIPE_STORM_WINDOW_MS = 10_000; let epipeCount = 0; let epipeWindowStart = 0;`.
2. Add `function safeStderr(msg: string): void { try { process.stderr.write(msg); } catch {} }`.
3. Add `function isPipeClosedError(err: Error): boolean` that matches: `EPIPE`, plus Windows EOF: `err.message.includes("write EOF")` or `err.message.includes("read EOF")`. Do NOT include `ECONNRESET` (upstream notes #182).
4. Refactor the body of `handleRecoverableExtensionProcessError`:
   - Replace `if (errno === "EPIPE")` with `if (isPipeClosedError(err))`.
   - Inside that branch: check `process.stdout.destroyed || process.stdout.writableEnded` → `process.exit(0)`. Otherwise increment counter in rolling window, exit(0) on storm, else `safeStderr(...)`.
   - Keep otto's existing `writeCrashLog(err, "EPIPE")` call — but only call it BEFORE the storm-counter increments so we don't write 100 crash files. (Upstream does not call writeCrashLog at all here; deliberate divergence — preserve otto's diagnostic behavior but rate-limit it to once per window.)
5. Replace every `process.stderr.write(...)` inside this handler with `safeStderr(...)`. Keep all otto-branded `[otto]` strings and `~/.otto/workflow/crash/` paths.
6. Also handle "ProcessTransport is not ready for writing" branch (upstream adds it, otto does not — see 97c2043 for the related guard fix; coordinate with that port).
7. Skip the test file — upstream did not add one; the existing crash-log/register-extension tests still pass.

## Verdict
Real CPU-spin bug, applies to otto with the same shape. Significant rewrite required because otto already has its own EPIPE branch with crash-log integration that must be preserved. Manual port; consider co-landing with 97c2043 (ProcessTransport guard) since both touch the same handler.
