verdict: do-not-port

# e69cf7d — fix(agent-core): preserve compaction truncation tails

## Target file(s)
- none

## Divergence
The compaction/utils.ts hunk introduces head+tail truncation (head=ceil(max/2), tail=floor(max/2)) in `packages/gsd-agent-core/src/compaction/utils.ts`. otto-cli's analogous file `packages/pi-coding-agent/src/core/compaction/utils.ts` already implements head+tail truncation via `truncateForSummary` (uses `HEAD_TAIL_HALF = Math.floor(TOOL_RESULT_MAX_CHARS / 2)` and an imported `TOOL_RESULT_MAX_CHARS` from `../constants.js`). The agent-session.ts hunk (preserve queued messages on retry, drop trailing error message) is in `gsd-agent-core/src/agent-session.ts` which has no otto equivalent — otto's `packages/pi-coding-agent/src/core/agent-session.ts` has a different abort/retry shape and does not expose the same `willRetry`/`hasQueuedMessages` surface at the patched site.

## Concrete edits
1. None.

## Verdict
The truncation-tail fix is already present in otto's pi-coding-agent compaction utils, and the agent-session retry-queue fix is gsd-agent-core-specific with no clean otto analog.
