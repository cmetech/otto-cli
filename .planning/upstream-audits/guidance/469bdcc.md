verdict: do-not-port

# 469bdcc — fix: add scrolling to GSD dialogs

## Target file(s)
- src/resources/extensions/workflow/commands-usage.ts (does not exist in otto)
- src/resources/extensions/workflow/queue-reorder-ui.ts
- src/resources/extensions/workflow/tui/render-kit.ts
- tests/commands-usage.test.ts, tests/queue-reorder-ui.test.ts

## Divergence
The bulk of this fix lives in `commands-usage.ts`, which otto removed entirely; otto's context-usage rendering went through a session-report refactor (`commands-session-report*`, `commands-maintenance.ts`, etc.) that doesn't share the dialog-render plumbing the commit patches. otto's `queue-reorder-ui.ts` already implements its own scrolling model (`scrollOffset`, `cachedLines`, dedicated `render(width)` with offset clamping) at a different layer than the gsd-pi version — the queue-reorder portion of the patch (adding 12 lines for scroll behaviour) is largely already present or expressed differently. `tui/render-kit.ts` exists in otto but the diff is small (12-line change adding `scroll` option to `renderDialogFrame`); it could be ported, but without a consumer it serves no purpose.

## Concrete edits
1. None.

## Verdict
Skip. The primary consumer (`commands-usage.ts` dialog) doesn't exist in otto, so 90% of the patch has no target. The `render-kit.ts` and `queue-reorder-ui.ts` changes would be orphaned absent that consumer. Re-evaluate if otto ports the gsd context-usage dialog wholesale — at that point bring this commit along with it.
