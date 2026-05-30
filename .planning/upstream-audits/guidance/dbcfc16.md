verdict: manual-port

# dbcfc16 — feat(coding-agent): Export CLI argument parser

## Target file(s)
`packages/pi-coding-agent/src/index.ts` (source of `parseArgs`/`Args`: `packages/pi-coding-agent/src/cli/args.ts`)

## Divergence
The exported symbols already exist in otto-cli: `packages/pi-coding-agent/src/cli/args.ts` exports both `export interface Args` (line 12) and `export function parseArgs(...)` (line 68). They are simply NOT re-exported from the package barrel `src/index.ts` (confirmed: `grep parseArgs src/index.ts` returns nothing). A literal cherry-pick will FAIL to apply because the upstream patch anchors on `export { getAgentDir, VERSION } from "./config.ts";` plus `.ts` import specifiers, whereas otto-cli's index.ts uses `.js` specifiers and a different surrounding export list (e.g. `export { getAgentDir, getDeliverablesDir, VERSION, COMMAND_NAMESPACE, ... } from "./config.js";`).

## Concrete edits
Add one line to `packages/pi-coding-agent/src/index.ts` near the other top-level exports:
`export { type Args, parseArgs } from "./cli/args.js";`
(Use `.js` extension to match otto-cli's module specifier convention, NOT upstream's `.ts`.) Optionally add a matching CHANGELOG entry.

## Verdict
manual-port — trivial: the symbols exist; just add the re-export line with otto-cli's `.js` import style. Cherry-pick won't apply due to barrel-file context divergence.
