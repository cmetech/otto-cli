verdict: do-not-port

# 80fcfb5 — fix: enforce CLI readiness for external providers

## Target file(s)
- src/resources/extensions/google-cli/stream-adapter.ts (does not exist in otto)
- src/tests/integration/web-onboarding-contract.test.ts (does not exist)
- src/tests/windows-portability.test.ts (exists)
- src/web/onboarding-service.ts (does not exist in otto)

## Divergence
The bulk of the patch targets the `google-cli` extension and the `web/onboarding-service`, neither of which exists in otto. Otto has `src/resources/extensions/claude-code-cli/stream-adapter.ts` but no google-cli extension and no `src/web/` directory at all — onboarding lives in `src/onboarding.ts` with a different architecture. The lone surviving file (`windows-portability.test.ts`) only carries a regression test that depends on the onboarding-service changes.

## Concrete edits
1. None — the feature surface (google-cli extension + web onboarding service) doesn't exist in otto.

## Verdict
Not applicable: otto has neither the google-cli extension nor the web onboarding service the patch hardens. Skip.
