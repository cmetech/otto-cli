import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM (`module: NodeNext`) — derive __dirname from import.meta.url.
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const TARBALL_BASENAME = 'xlsx-0.20.3.tgz';
const TARBALL = resolve(ROOT, 'vendor', TARBALL_BASENAME);
const SHA_FILE = resolve(ROOT, 'vendor', `${TARBALL_BASENAME}.sha256`);
const EXPECTED_DEP_SPEC = `file:vendor/${TARBALL_BASENAME}`;

test('vendor/xlsx tarball exists', () => {
  assert.ok(existsSync(TARBALL), `missing: ${TARBALL}`);
});

test('vendor/xlsx tarball SHA-256 matches recorded value', () => {
  const recorded = readFileSync(SHA_FILE, 'utf-8').trim().split(/\s+/)[0];
  const actual = createHash('sha256').update(readFileSync(TARBALL)).digest('hex');
  assert.equal(actual, recorded, 'tarball SHA does not match vendor/xlsx-0.20.3.tgz.sha256');
});

test('root package.json xlsx dep points at the vendored tarball', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  assert.equal(
    pkg.dependencies?.xlsx,
    EXPECTED_DEP_SPEC,
    `package.json dependencies.xlsx must equal "${EXPECTED_DEP_SPEC}"`,
  );
});

test('root package.json "files" includes vendor/', () => {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
  const files: string[] = Array.isArray(pkg.files) ? pkg.files : [];
  assert.ok(
    files.includes('vendor') || files.includes('vendor/'),
    'package.json "files" array must include "vendor" so the tarball ships in the published package',
  );
});
