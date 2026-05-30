verdict: do-not-port

### Verdict: `do-not-port` — SUPERSEDED upstream. Port `ce0e801` instead.

> ⚠️ **Do not cherry-pick this commit.** Upstream reverted it and shipped a
> different implementation. Porting `d0d1d8e` would reintroduce the exact change
> upstream decided was wrong.

### The revert chain (earendil-works/pi)

```
d0d1d8e  fix(rpc): respect stdout backpressure          (closes #4897)  ← THIS commit
9600ded  revert: fix rpc stdout backpressure            ("This reverts commit d0d1d8e…")
ce0e801  fix(coding-agent): retry RPC stdout backpressure              ← the real fix to port
```

Upstream's first attempt (`d0d1d8e`) made `_emit`/`writeRawStdout` async to await
the stdout `drain` event. It was reverted in `9600ded` (presumably it caused
ordering/regression issues), then re-done more carefully in `ce0e801`. The
correct upstream change to track is **`ce0e801`**, which is already flagged in
this audit's *Critical — stability* bucket and gets its own issue.

### otto-cli divergence (why even `ce0e801` is a manual port, not a cherry-pick)

otto's RPC/output stack has diverged substantially from upstream — the
backpressure refactor has no clean landing spot:

- otto's RPC `output()` writes **synchronously**:
  `process.stdout.write(serializeJsonLine(obj))`
  (`packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts:53–54`). There is no
  `output()/outputDetached()` async split.
- otto has **no** `packages/pi-coding-agent/src/core/output-guard.ts` and no
  `writeRawStdout()` / `isStdoutTakenOver()` helpers (upstream's backpressure
  fix is centred on `output-guard.ts`).
- otto's `AgentSession._emit` is still **synchronous** (`private _emit(event):
  void` at `packages/pi-coding-agent/src/core/agent-session.ts:395`); upstream's
  fix turns the whole `_emit` chain async.

So the ENOBUFS-on-slow-stdout-drain problem (upstream #4897) likely still exists
in otto, but fixing it requires porting `ce0e801`'s approach onto otto's
different output path, not a mechanical apply.

### Recommended action

1. **Close this issue as `do-not-port` / superseded** (link to the `ce0e801`
   issue).
2. Do the real work under the `ce0e801` issue: introduce a backpressure-aware
   write path in otto's RPC output (await `drain` when `process.stdout.write`
   returns `false`), keeping otto's synchronous-emit architecture in mind.
