verdict: do-not-port

# ec6c5b9 — fix(installer): show GSD-Pi wordmark only once during guided install

## Target file(s)
- none

## Divergence
The fix targets the GSD-Pi npx installer (`scripts/install/banner.js`, `scripts/install/handoff.js`) plus the GSD-Pi wordmark/intro paths in `src/loader.ts` and `src/onboarding.ts`. otto-cli has no `scripts/install/` directory and its loader/onboarding flow uses OTTO branding (`OTTO_FIRST_RUN_BANNER`, otto brand colors), not GSD-Pi branding (`GSD_PI_BRAND`, `GSD_WEBSITE`, `renderGsdPiLogo`, `GSD_SUPPRESS_LOGO`). The installer-handoff wordmark-suppression coordination has no analog because otto-cli is not installed via the GSD-Pi handoff installer.

## Concrete edits
1. None.

## Verdict
GSD-Pi installer-specific UX fix. otto-cli has its own installer and brand surface, so the patch does not apply.
