verdict: do-not-port

# d67ac2c — fix(ci): keep workspace links during dev version stamping

## Target file(s)
- scripts/lib/version-sync.cjs (not applicable — otto has different package set)

## Divergence
Upstream adds `packages/cloud-mcp-gateway`, `packages/gsd-agent-core`, `packages/gsd-agent-modes` to `RELEASE_WORKSPACE_PACKAGE_DIRS` and their package names (`@gsd/agent-core`, `@gsd/agent-modes`, `@opengsd/cloud-mcp-gateway`) to `INTERNAL_PACKAGE_NAMES`. The bug being fixed (registry fetch for `@opengsd/mcp-server` during prerelease version stamp because gateway dep range didn't get re-pinned) is specific to packages otto-cli does not ship. Otto's `scripts/lib/version-sync.cjs` has its own otto-scoped lists (`@otto-build/contracts`, `@otto-build/daemon`, `@otto-build/mcp-server`, `@otto-build/rpc-client`, `@otto/native`, `@otto/pi-*`) and no cloud-mcp-gateway or gsd-agent-core/modes packages exist in otto.

## Concrete edits
1. None — none of the upstream package additions correspond to anything in otto-cli's workspace.
2. If otto-cli ever vendors gsd-agent-core/modes (it currently inlines compaction into pi-coding-agent), revisit then.

## Verdict
Skip. The bug-class (missing internal package leaks registry fetches at version-stamp time) is real but the specific packages don't exist in otto. Otto's own version-sync list should be audited independently — verify every entry in `packages/*/package.json` `dependencies` that references another otto workspace package is in `INTERNAL_PACKAGE_NAMES` — but that's a separate audit, not a port of this commit.
