# OTTO Release

This repo publishes the npm CLI package `@cmetech/otto` and the platform
native engine packages `@cmetech/otto-engine-*`.

## How publishing is authenticated

We use **npm Trusted Publishing** (OIDC). The GitHub Actions workflows
exchange their `id-token` for short-lived npm credentials at publish time —
no long-lived `NPM_TOKEN` is needed for routine releases.

npm enforces that the OIDC token's workflow filename match the trusted
publisher record configured for each package. Because of that constraint,
publishing is split across two workflows:

| Package | Workflow filename |
|---|---|
| `@cmetech/otto-engine-darwin-arm64` | `build-native.yml` |
| `@cmetech/otto-engine-darwin-x64` | `build-native.yml` |
| `@cmetech/otto-engine-linux-x64-gnu` | `build-native.yml` |
| `@cmetech/otto-engine-linux-arm64-gnu` | `build-native.yml` |
| `@cmetech/otto-engine-win32-x64-msvc` | `build-native.yml` |
| `@cmetech/otto` | `npm-publish.yml` |

To inspect or modify a record: visit
`https://www.npmjs.com/package/<package-name>/access` while signed in as a
`cmetech` org member and scroll to **Trusted Publisher**.

## Publishing a release

From a clean, pushed `main` branch:

```bash
npm run release:publish
```

This triggers `build-native.yml`, which runs in two stages:

**Stage 1 — natives (`build-native.yml`):**
1. Builds 5 native binaries on macOS, Linux, and Windows runners.
2. Publishes `@cmetech/otto-engine-*` packages via trusted publishing.
3. Verifies the native packages are visible on npm.
4. **Chains to `npm-publish.yml`** with the detected channel
   (`dev`/`next`/`latest`, inferred from `package.json` version).

**Stage 2 — main package (`npm-publish.yml`):**
1. Checks out the same ref.
2. Refreshes `package-lock.json` to pick up the natives that just went
   live in stage 1 (resolves the chicken-and-egg between
   `optionalDependencies` and a stale lockfile).
3. Installs deps, builds `dist/`, validates the packed tarball.
4. Publishes `@cmetech/otto` via trusted publishing.
5. Installs the published package globally and verifies `otto --version`.
6. Confirms the dist-tag points at the new version.

### Channel selection

The channel (npm dist-tag) is inferred from `package.json#version`:

| Version pattern | Channel |
|---|---|
| `1.0.4-dev.N` | `dev` |
| `1.0.4-next.N` | `next` |
| `1.0.4` | `latest` |

Bump versions locally with `node scripts/bump-version.mjs X.Y.Z`, commit,
push, then run `release:publish`.

### Manual main-only publish

If the natives are already live at the current version and you only need
to re-publish or test the main package:

```bash
gh workflow run npm-publish.yml -f channel=dev    # or next, or latest
```

## Bootstrap escape hatch

Both workflows accept `publish_auth=token` as a manual input. This falls
back to a granular `NPM_TOKEN` secret for the npm publish step. Use only
when trusted publishing is broken (e.g. npm OIDC outage, or initial
bootstrap of a brand-new package that hasn't been published yet).

```bash
gh workflow run build-native.yml -f publish=true -f publish_auth=token
gh workflow run npm-publish.yml  -f channel=dev   -f publish_auth=token
```

## Local Verification

Before publishing, run:

```bash
npm run build
npm test
npm pack --dry-run
```

If `npm pack` fails with root-owned files in `~/.npm`, fix the local cache:

```bash
sudo chown -R $(id -u):$(id -g) ~/.npm
```

The `otto` command on PATH runs `dist/loader.js`, so always finish runtime
changes with `npm run build`.

## Bootstrap history

The first publish of each `@cmetech/*` package on May 28, 2026 used a
short-lived granular access token (`NPM_TOKEN`) because npm requires a
package to exist before a trusted publisher record can be configured.
After 1.0.3 was live, trusted publisher records were added for all 6
packages, the workflow was split to satisfy npm's per-package filename
rule, and the token was revoked.
