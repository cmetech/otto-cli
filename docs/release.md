# OTTO Release

This repo publishes the npm CLI package `@cmetech/otto` and the platform native
engine packages `@cmetech/otto-engine-*`.

## One-Time Setup

1. Create an npm automation token for the `cmetech` npm account.
2. Add it to this GitHub repository as the secret `NPM_TOKEN`.
3. Confirm GitHub Actions can access the repository and npm registry.

Interactive `npm login` is only for local checks. GitHub Actions uses
`NPM_TOKEN` when `publish_auth=token` is selected.

## Release 1.0.3+

Publishing is handled by the `Build Native Binaries` workflow. It:

1. Builds native binaries on macOS, Linux, and Windows runners.
2. Publishes `@cmetech/otto-engine-*` packages first.
3. Verifies the native packages are visible on npm.
4. Builds the production `dist/` output.
5. Validates the packed `@cmetech/otto` package installs in a temp project.
6. Publishes `@cmetech/otto`.
7. Installs the published package and checks `otto --version`.

From a clean, pushed `main` branch:

```bash
npm run release:publish
```

Equivalent manual workflow inputs:

```text
Workflow: Build Native Binaries
publish: true
publish_auth: token
```

For first publish of a scoped package, every scoped package must be public.
The root and native package manifests set `publishConfig.access=public`, and
the workflow also passes `--access public`.

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
