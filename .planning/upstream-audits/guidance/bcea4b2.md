verdict: manual-port

# bcea4b2 — feat(coding-agent): expose streamingBehavior on InputEvent

## Target file(s)
packages/pi-coding-agent/src/core/extensions/types.ts (InputEvent interface ~line 953)
packages/pi-coding-agent/src/core/extensions/runner.ts (emitInput ~line 1097)
packages/pi-coding-agent/src/core/agent-session.ts (emitInput call site ~line 1145)
(new test/example) test/extensions-input-event.test.ts, examples/extensions/input-transform-streaming.ts

## Divergence
Lightly diverged, clean conceptual port. The data already exists in otto-cli: `PromptOptions` already has `streamingBehavior?: "steer" | "followUp"` (agent-session.ts ~line 193) and uses it for steer/followUp delivery (~line 1169). What's missing is exposing it to extension `input` handlers. The runner diverges from upstream: otto-cli's `emitInput` builds the event via an `invokeHandlers("input", () => ({...}))` factory rather than upstream's inline for-loop, so a raw cherry-pick will conflict — but the change is mechanically identical.

## Concrete edits
1. extensions/types.ts: add `streamingBehavior?: "steer" | "followUp";` to the `InputEvent` interface (after `source`), with the upstream doc comment.
2. runner.ts: add a 4th param `streamingBehavior?: "steer" | "followUp"` to `emitInput(...)` and include `streamingBehavior` in the event object returned by the `invokeHandlers("input", () => ({...}))` factory.
3. agent-session.ts: at the `emitInput(currentText, currentImages, options?.source ?? "interactive")` call (~line 1145), pass `options?.streamingBehavior` as the new 4th argument.
4. Port the input-event test and optionally the input-transform-streaming example, adapting to otto-cli's runner API.

## Verdict
manual-port — small and clean; otto-cli already carries the streamingBehavior value, just needs threading to the InputEvent. Not a raw cherry-pick only because runner.ts uses the diverged invokeHandlers factory shape.
