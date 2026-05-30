verdict: manual-port

# e007fcd — fix(rpc): reject pending requests on child process exit

## Target file(s)
packages/pi-coding-agent/src/modes/rpc/rpc-client.ts (test: add packages/pi-coding-agent/test/rpc-client-process-exit.test.ts)

## Divergence
Diverged. otto-cli already has a partial fix: an inline `process.on("exit", ...)` handler (lines 105-114) that rejects pending requests, but it lacks everything else from the upstream patch. There is no `exitError` field, no `"error"` listener, no `stdin "error"` listener, no `createProcessExitError`/`rejectPendingRequests` helpers, and no pre-send guards. The `send()` method also differs structurally (30000ms timeout, `pendingRequests.set` placed after the timeout setup, no write try/catch). Upstream's diff context (which assigns `spawn` to a local `childProcess`, and the `this.pendingRequests.set(id, ...)` line it removes) does not match — a raw cherry-pick will conflict. Port by hand.

## Concrete edits
- Add `private exitError: Error | null = null;` field.
- In `start()`: reset `this.exitError = null;` at top; capture `const childProcess = this.process` and add `childProcess.once("error", ...)` and `childProcess.stdin?.on("error", ...)` handlers that set `this.exitError` and reject pending requests; convert the existing `process.on("exit")` block to set `this.exitError` and call a shared `rejectPendingRequests(error)`. Guard each handler with `if (this.process !== childProcess) return;`.
- In the immediate-exit check, throw `this.exitError ?? createProcessExitError(...)` instead of the plain string error.
- Add private `createProcessExitError(code, signal)` and `rejectPendingRequests(error)` helpers.
- In `send()`: before sending, throw if `this.exitError`, if `childProcess.exitCode !== null`, or if `stdin.destroyed || !stdin.writable`; wrap the `stdin.write(...)` in try/catch that rejects the just-registered pending request. Preserve otto-cli's existing 30000ms timeout and pending-request registration order.
- Optionally add the upstream process-exit test (adjust import path/extension to otto-cli conventions).

## Verdict
manual-port — diverged send()/start() structure means upstream context won't apply; reimplement the exit/error/stdin-error rejection and pre-send guards on top of the existing partial exit handler.
