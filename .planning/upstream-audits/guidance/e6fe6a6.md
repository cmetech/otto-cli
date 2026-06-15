verdict: do-not-port

# e6fe6a6 — fix(gsd): reserve dialog frame rows in overlays

## Target file(s)
- none

## Divergence
Touches `src/resources/extensions/gsd/config-overlay.ts`, `context-overlay.ts`, and `parallel-monitor-overlay.ts`. otto-cli does not ship a `gsd` extension; the overlay surface here belongs to the GSD pipeline UI and has no otto analog.

## Concrete edits
1. None.

## Verdict
GSD-extension-only overlay layout fix.
