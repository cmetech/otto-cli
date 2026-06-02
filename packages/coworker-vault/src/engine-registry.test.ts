import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EngineRegistry } from './engine-registry.js';
import { EngineNotFound } from './errors.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'engines-'));
}

describe('EngineRegistry', () => {
  it('loads the bundled JIRA seed by id', async () => {
    const reg = await EngineRegistry.load({ userDir: tmp(), workspaceDir: undefined });
    const jira = reg.get('jira');
    assert.ok(jira, 'expected bundled jira engine to be loaded');
    assert.equal(jira!.id, 'jira');
    assert.deepEqual(jira!.fields.map((f) => f.name), ['url', 'email', 'token']);
    const token = jira!.fields.find((f) => f.name === 'token');
    assert.ok(token);
    assert.equal(token!.secret, true);
  });

  it('throws EngineNotFound on unknown id', async () => {
    const reg = await EngineRegistry.load({ userDir: tmp(), workspaceDir: undefined });
    assert.throws(
      () => reg.require('servicenow'),
      (err: Error) => err.name === 'EngineNotFound' && err instanceof EngineNotFound,
    );
  });

  it('workspace YAML overrides user YAML overrides builtin', async () => {
    const userDir = tmp();
    const wsDir = tmp();
    writeFileSync(
      join(userDir, 'jira.yaml'),
      `schema_version: 1
id: jira
label: "Jira (user)"
fields:
  - name: url
    label: URL
    secret: false
    required: true
`,
    );
    writeFileSync(
      join(wsDir, 'jira.yaml'),
      `schema_version: 1
id: jira
label: "Jira (workspace)"
fields:
  - name: url
    label: URL
    secret: false
    required: true
`,
    );
    const reg = await EngineRegistry.load({ userDir, workspaceDir: wsDir });
    assert.equal(reg.get('jira')!.label, 'Jira (workspace)');
  });

  it('accepts unknown top-level keys (forward compat with test: block)', async () => {
    const userDir = tmp();
    writeFileSync(
      join(userDir, 'future.yaml'),
      `schema_version: 1
id: future
label: Future Engine
fields:
  - name: token
    label: Token
    secret: true
    required: true
test:
  endpoint: /api/v1/ping
  expected_status: 200
`,
    );
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    const engine = reg.get('future');
    assert.ok(engine);
    assert.equal(engine!.id, 'future');
  });

  it('skips engines with malformed YAML and continues loading others', async () => {
    const userDir = tmp();
    // Missing id, empty fields — schema invalid
    writeFileSync(
      join(userDir, 'broken.yaml'),
      `schema_version: 1
label: Broken
fields: []
`,
    );
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    assert.equal(reg.get('broken'), undefined);
    // Builtin jira should still load
    assert.ok(reg.get('jira'), 'builtin jira should still load despite broken user file');
  });

  it('field name must match /^[a-z][a-z0-9_]*$/', async () => {
    const userDir = tmp();
    writeFileSync(
      join(userDir, 'bad.yaml'),
      `schema_version: 1
id: bad
label: Bad
fields:
  - name: Bad-Name
    label: Bad Name
    secret: false
    required: true
`,
    );
    const reg = await EngineRegistry.load({ userDir, workspaceDir: undefined });
    assert.equal(reg.get('bad'), undefined);
  });
});
