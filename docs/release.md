# OTTO Release

This repo publishes the npm CLI package `@cmetech/otto` and the platform
native engine packages `@cmetech/otto-engine-*`.

## How publishing is authenticated

We use **npm Trusted Publishing** (OIDC). The GitHub Actions workflow exchanges
its `id-token` for a short-lived npm credential at publish time — there is no
long-lived `NPM_TOKEN` to manage or rotate.

Each package has a trusted publisher record configured on npmjs.com pointing at
this repo's workflow filename:

| Package | Workflow filename |
|---|---|
| `@cmetech/otto` | `npm-publish.yml` |
| `@cmetech/otto-engine-darwin-arm64` | `build-native.yml` |
| `@cmetech/otto-engine-darwin-x64` | `build-native.yml` |
| `@cmetech/otto-engine-linux-x64-gnu` | `build-native.yml` |
| `@cmetech/otto-engine-linux-arm64-gnu` | `build-native.yml` |
| `@cmetech/otto-engine-win32-x64-msvc` | `build-native.yml` |

To inspect or modify a record: visit
`https://www.npmjs.com/package/<package-name>/access` while signed in as a
`cmetech` org member and scroll to **Trusted Publisher**.

## Publishing a release

From a clean, pushed `main` branch:

```bash
npm run release:publish
```

This triggers the `Build Native Binaries` workflow, which:

1. Builds native binaries on macOS, Linux, and Windows runners.
2. Publishes `@cmetech/otto-engine-*` packages via trusted publishing.
3. Verifies the native packages are visible on npm.
4. Builds the production `dist/` output.
5. Validates the packed `@cmetech/otto` package installs in a temp project.
6. Publishes `@cmetech/otto` via trusted publishing.
7. Installs the published package globally and checks `otto --version`.

Equivalent manual workflow inputs:

```text
Workflow: Build Native Binaries
publish: true
publish_auth: trusted
```

The `publish_auth=token` option still exists in the workflow as an escape
hatch but should not be needed in normal operation. Use it only if trusted
publishing breaks (e.g. npm OIDC outage) and you need to fall back to a
short-lived granular access token.

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
packages and the token was revoked.
