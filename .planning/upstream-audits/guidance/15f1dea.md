verdict: manual-port

# 15f1dea — fix(coding-agent): disable managed extension peer resolution [CRITICAL]

## Target file(s)

- `packages/pi-coding-agent/src/core/package-manager.ts`
- `packages/pi-coding-agent/test/package-manager.test.ts`

## Divergence
Diverged. Upstream centralizes install args in a `getNpmInstallArgs(specs, installRoot)` helper with bun/pnpm/npm branches; otto-cli has NO such method and NO multi-package-manager branching. otto-cli's `installNpm` (line ~1203) issues a single inline `npm install <spec> --prefix <installRoot>` with no `--legacy-peer-deps`. The upstream patch context won't apply — port the intent by hand.

## Concrete edits
- In `installNpm` (line 1203), append `"--legacy-peer-deps"` to the npm args: `["install", source.spec, "--prefix", installRoot, "--legacy-peer-deps"]`. Add a brief comment explaining managed pi extensions resolve host pi APIs via loader aliases, so peer resolution must be disabled to avoid installing/solving `@earendil-works/pi-*` (or otto-equivalent) peers.
- If otto-cli ever adds bun/pnpm install paths, mirror upstream: bun → `--omit=peer`; pnpm → `--config.auto-install-peers=false --config.strict-peer-dependencies=false`. Currently npm-only, so just the `--legacy-peer-deps` flag is needed.
- Update package-manager.test.ts expectations for the npm install args to include `--legacy-peer-deps` (otto-cli test shape; ignore upstream's bun/pnpm assertions).

## Verdict
manual-port — CRITICAL fix is a one-flag change in otto-cli's npm-only installer; upstream's helper-based diff does not apply. Verify whether otto-cli renames the `@earendil-works/pi-*` scope before referencing it in comments.
