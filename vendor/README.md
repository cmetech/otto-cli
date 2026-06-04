# Vendored dependencies

This directory holds vendored npm package tarballs that are bundled inside the
published `@cmetech/otto` package. They are referenced from root `package.json`
via `"file:vendor/<name>.tgz"` deps. End users never reach the upstream CDN
during `npm i -g @cmetech/otto` — the tarball ships inside the OTTO tarball.

## Files

| File | Purpose |
|---|---|
| `xlsx-0.20.3.tgz` | SheetJS Community Edition 0.20.3 (binding name `XLSX` in scratchpad cells). Source: <https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz>. |
| `xlsx-0.20.3.tgz.sha256` | Recorded SHA-256 of the file above. Verified at `prepublishOnly` and by `src/tests/vendor-xlsx.test.ts`. |
| `README.md` | This file. |

## Refresh procedure (new CE version)

1. Download the new tarball:
   ```bash
   curl -sL "https://cdn.sheetjs.com/xlsx-X.Y.Z/xlsx-X.Y.Z.tgz" -o vendor/xlsx-X.Y.Z.tgz
   ```
2. Compute and record the SHA-256:
   ```bash
   shasum -a 256 vendor/xlsx-X.Y.Z.tgz | awk '{print $1 "  xlsx-X.Y.Z.tgz"}' > vendor/xlsx-X.Y.Z.tgz.sha256
   ```
3. Update root `package.json`:
   - `dependencies.xlsx` → `"file:vendor/xlsx-X.Y.Z.tgz"`.
4. Update `scripts/verify-vendored-xlsx.mjs`: change the `TARBALL_BASENAME` constant to `xlsx-X.Y.Z.tgz`.
5. Update `src/tests/vendor-xlsx.test.ts`: change the `TARBALL_BASENAME` constant.
6. Regenerate the lockfile:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
7. Run the verification:
   ```bash
   npm run verify:vendored-xlsx
   ```
8. Remove the previous tarball + SHA file from `vendor/`.
9. Commit.

## CE → Pro upgrade procedure

SheetJS Pro is distributed as a separate tarball (`xlsxPro-X.Y.Z.tgz`) and
requires a license token at download time. The runtime API is identical to CE —
no code change is needed; only the vendored file and its references move.

1. Obtain the Pro tarball from SheetJS (purchase + tarball URL with embedded
   license token). Download to `vendor/xlsxPro-X.Y.Z.tgz`.
2. Compute and record the SHA-256:
   ```bash
   shasum -a 256 vendor/xlsxPro-X.Y.Z.tgz | awk '{print $1 "  xlsxPro-X.Y.Z.tgz"}' > vendor/xlsxPro-X.Y.Z.tgz.sha256
   ```
3. Update root `package.json`:
   - `dependencies.xlsx` → `"file:vendor/xlsxPro-X.Y.Z.tgz"`.
4. Update `scripts/verify-vendored-xlsx.mjs`: change `TARBALL_BASENAME` to
   `xlsxPro-X.Y.Z.tgz`.
5. Update `src/tests/vendor-xlsx.test.ts`: change `TARBALL_BASENAME`.
6. Regenerate the lockfile:
   ```bash
   npm install --package-lock-only --ignore-scripts
   ```
7. Optionally remove `vendor/xlsx-*.tgz` (the previous CE tarball) once confident
   in the swap.
8. Commit. Tag a release. Publish.

The `XLSX` binding name does **not** change. No edits to `kernel-bindings.ts`,
`kernel-entry.ts`, the cell sandbox, prompts, or tests other than the basename
constants.
