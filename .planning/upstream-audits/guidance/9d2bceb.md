verdict: manual-port

# 9d2bceb — fix(tui): forward OSC 8 hyperlinks under tmux when the client supports them

## Target file(s)
`packages/pi-tui/src/terminal-image.ts` (test: `packages/pi-tui/test/terminal-image.test.ts` if present)

## Divergence
The function exists but otto-cli's `detectCapabilities()` (line 40) has been COMPLETELY rewritten and DIVERGED — a clean cherry-pick will NOT apply:
- otto-cli's version has NO tmux/screen handling at all. There is no `inTmuxOrScreen` branch, no `TMUX` check, no `process.env.TMUX`. It returns `hyperlinks: true` unconditionally in every branch (kitty/cmux/ghostty/wezterm/iterm/vscode/alacritty and the final fallback at line 75).
- It already has an otto-specific `isCmux` branch (line 44/50) not present upstream.
- There is no `node:child_process` import / `execSync` usage.
So otto-cli currently emits OSC 8 even under tmux unconditionally — which is the exact bug both the old upstream code AND this fix care about, just landing on the permissive side. The upstream patch transforms an existing "force off under tmux" branch into a "probe tmux client_termfeatures" branch; otto-cli has neither branch.

## Concrete edits
Port the intent by hand:
1. Add `import { execSync } from "node:child_process";` at top.
2. Add the `probeTmuxHyperlinks()` helper verbatim from upstream (tmux `display-message -p '#{client_termfeatures}'`, 250ms timeout, fail-closed to false, check for `"hyperlinks"` in the comma-split feature list).
3. Change signature to `detectCapabilities(tmuxForwardsHyperlink: () => boolean = probeTmuxHyperlinks)`.
4. Add, BEFORE the existing emulator-specific branches (or at least before the final fallback), tmux/screen handling:
   `if (process.env.TMUX || term.startsWith("tmux")) return { images: null, trueColor: hasTrueColorHint, hyperlinks: tmuxForwardsHyperlink() };`
   `if (term.startsWith("screen")) return { images: null, trueColor: hasTrueColorHint, hyperlinks: false };`
   NOTE: otto-cli computes `trueColor` only at the end (line 74) and has no `hasTrueColorHint` variable — introduce `const hasTrueColorHint = colorTerm === "truecolor" || colorTerm === "24bit";` early (otto already computes the same expression at line 74) and reuse it.
   Decide ordering vs. otto's kitty/ghostty/cmux branches: upstream intent is that tmux gating should win when inside tmux. Place the tmux/screen checks appropriately and preserve otto's `isCmux` special-case.

## Verdict
manual-port — function fully diverged (no tmux branch exists in otto-cli, returns hyperlinks:true everywhere). Hand-port the probe helper + tmux/screen branches, integrating with otto's existing emulator branches and trueColor computation. Adapt tests if the test file exists.
