verdict: do-not-port

# 36e6fcb — fix: handle empty read args only for read tool

## Target file(s)
- (none in otto-cli — file does not exist)

## Divergence
The behavioral fix is in `packages/pi-ai/src/utils/normalize-tool-arguments.ts` (`isEmptyPathToolArguments` now bails to `false` for non-read tools before the `isRecord` check). Otto-cli's `packages/pi-ai/src/utils/` directory does NOT contain `normalize-tool-arguments.ts` — its utilities list is `event-stream.ts`, `hash.ts`, `json-parse.ts`, `overflow.ts`, `remote-tool.ts`, `repair-tool-json.ts`, `sanitize-unicode.ts`, `typebox-helpers.ts`, `validation.ts`, plus an `oauth/` subdir. The other hunk targets `src/modes/interactive/controllers/chat-controller.ts`, which also does not exist in otto-cli.

## Concrete edits
1. No edits — the helper function being fixed simply isn't present in otto-cli's pi-ai.
2. If otto ever adopts a similar tool-argument normalizer, mine this guard pattern.

## Verdict
Upstream-only because the affected utility module and interactive chat controller don't exist in this fork. Otto's tool argument handling lives elsewhere (repair-tool-json, remote-tool) without the same canonical-name + empty-path guard.
