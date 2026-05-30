verdict: manual-port

## Target file(s)

- `packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts`

## Divergence

otto-cli renamed the package; logic diverged. Manual port required.

## Concrete edits

Add backpressure retry around the rpc write loop.
