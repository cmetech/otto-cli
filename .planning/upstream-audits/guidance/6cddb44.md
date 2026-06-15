verdict: do-not-port

# 6cddb44 — fix: wait for npm release tarball propagation

## Target file(s)
- none (otto's npm-publish workflow already does install-based verification)

## Divergence
Upstream replaces a `npm view` polling loop with an `npm install -g --ignore-scripts --prefer-online` polling loop (12 attempts, exponential backoff capped at 60s) in both the prerelease and the prod-release verification steps of `.github/workflows/npm-publish.yml`, plus a `GSD_VERSION` build-arg pass into the docker step. Otto's `.github/workflows/npm-publish.yml` already implements a smoke-test that actually `npm install`s the published package and runs `otto --version` against it (lines 129–171), which catches tarball-propagation gaps the same way. The exact retry/backoff structure differs but the failure mode the upstream patch targets is already handled.

## Concrete edits
None. (Optional cleanup: if otto's smoke test ever flakes on registry propagation, you could borrow the exponential backoff pattern, but currently the loop is sufficient.)

## Verdict
do-not-port — otto's publish workflow already verifies via `npm install` (the same signal that catches packument-vs-tarball drift), and the upstream patch doesn't add any new capability otto lacks. Importing it would just churn the YAML to match a different convention.
