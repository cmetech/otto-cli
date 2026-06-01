# Phase 0 — Deferred / Out-of-Scope Items

- `npm install` postinstall (`scripts/install.js` -> `copyBundledTools`) fails with
  `EACCES: permission denied, copyfile .../otto-engine-darwin-arm64/rg -> ~/.otto/agent/bin/rg`.
  Pre-existing environment/permission issue, unrelated to coworker packages.
  Workspace resolution itself succeeds ("Workspace packages up to date" + all six
  `node_modules/@otto/coworker-*` symlinks present) before the hook errors.
