verdict: do-not-port

# 51fce9b — fix(ci): use GitHub-hosted runners for build-native npm publish

## Target file(s)
- .github/workflows/build-native.yml
- scripts/__tests__/build-native-workflow.test.mjs (does not exist in otto-cli)

## Divergence
Not applicable. The bug is that upstream's workflow was running the npm publish job on Blacksmith self-hosted runners, which npm sigstore verification rejects for trusted publishing. The fix moves the publish job to `ubuntu-latest`. Otto-cli already uses `ubuntu-latest` for every job in `build-native.yml` (verified: lines 49, 52, 60, 121 all reference `ubuntu-latest`, no `blacksmith` references anywhere). Otto never adopted the Blacksmith runner pattern, so the bug never existed here. Otto also has no `scripts/__tests__/build-native-workflow.test.mjs`.

## Concrete edits
None.

## Verdict
Do-not-port. Otto already satisfies the postcondition this fix establishes (publish on GitHub-hosted runners). Confirming: per memory `Otto release + publish flow`, trusted publishing via OIDC works for otto today because publishing happens from `ubuntu-latest`.
