verdict: manual-port

# f696baf — fix: collapse interactive tool output by default

## Target file(s)
- packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts
- packages/pi-coding-agent/src/modes/interactive/interactive-mode-ordering.test.ts

## Divergence
Upstream lives in `packages/gsd-agent-modes/src/modes/interactive/interactive-mode-class-constants.ts` — a constants file that does not exist in otto. otto-cli inlines the same value as a class property `private toolOutputExpanded = true;` at `packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts:362`. The `getToolExpansionStartupHint` helper exists in otto at the same path (line 185) with the same signature. The test file `packages/pi-coding-agent/src/modes/interactive/interactive-mode-ordering.test.ts` exists in otto and asserts the default; need to confirm it imports the constant from a constants file or reads the class default.

## Concrete edits
1. In `packages/pi-coding-agent/src/modes/interactive/interactive-mode.ts` line 362, change `private toolOutputExpanded = true;` to `private toolOutputExpanded = false;`.
2. Open `packages/pi-coding-agent/src/modes/interactive/interactive-mode-ordering.test.ts` and update the "tool expansion startup hint reflects the default expansion state" test to assert `false` instead of `true` and expect `/ctrl\+o.*expand tools/` (matching the upstream change). If otto's test imports a `DEFAULT_TOOL_OUTPUT_EXPANDED` constant that does not exist, adapt the assertion to read the class property or the actual default value.
3. Verify there is no other site in otto's interactive-mode that re-asserts `true` (e.g., a "reset to defaults" code path).

## Verdict
Real UX/behavioural change: collapsed-by-default reduces noise in long sessions. Low risk — single boolean flip plus matching test. Otto users may have habituated to the previous (expanded) default, so document in the PR. Behaviour is reversible via the existing `ctrl+o` keybinding.
