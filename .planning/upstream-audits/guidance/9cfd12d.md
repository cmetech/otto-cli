verdict: manual-port

# 9cfd12d — fix: retry MCP smoke install failures

## Target file(s)
- .github/workflows/build-native.yml

## Divergence
Otto has `.github/workflows/build-native.yml`. Upstream's one-line fix adds `set -o pipefail` to the "Post-publish MCP server smoke test" run step so a broken pipe in the middle of the smoke install actually fails the step rather than being masked. Otto's `build-native.yml` exists but the upstream patch hunk is anchored at a step named "Post-publish MCP server smoke test" gated by `github.event.inputs.platform_packages_only != 'true'` — need to confirm otto has the same step.

## Concrete edits
1. Locate any post-publish MCP smoke step in `.github/workflows/build-native.yml`. If present, add `set -o pipefail` as the first line of the `run:` block.
2. If otto has no such smoke step (otto may not ship MCP smoke validation in build-native), do not port.

## Verdict
Manual-port pending verification — the change is one shell flag, but its target depends on whether otto's `build-native.yml` includes the MCP server smoke step. Inspect the workflow before applying. The patch is harmless even if the step shape differs slightly (adjust the run-block anchor).
