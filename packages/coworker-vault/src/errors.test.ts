import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EngineNotFound,
  EngineValidationError,
  VaultEntryNotFound,
  VaultEntryMalformed,
  BindingRefMalformed,
  BindingNotFound,
} from './errors.js';

describe('vault errors', () => {
  it('EngineNotFound carries id and is named', () => {
    const e = new EngineNotFound('servicenow');
    assert.equal(e.id, 'servicenow');
    assert.equal(e.name, 'EngineNotFound');
    assert.ok(e.message.includes('servicenow'));
  });

  it('VaultEntryNotFound carries engine, entryName, and searched paths', () => {
    const searched = ['/ws/.otto/vault/jira', '/home/u/.otto/vault/jira'];
    const e = new VaultEntryNotFound('jira', 'prod', searched);
    assert.equal(e.name, 'VaultEntryNotFound');
    assert.equal(e.engine, 'jira');
    assert.equal(e.entryName, 'prod');
    assert.deepEqual(e.searched, searched);
  });

  it('BindingRefMalformed carries input and hints at jira:prod', () => {
    const e = new BindingRefMalformed('jira-prod');
    assert.equal(e.name, 'BindingRefMalformed');
    assert.equal(e.input, 'jira-prod');
    assert.ok(e.message.includes('jira:prod'));
  });

  it('BindingNotFound carries ref', () => {
    const e = new BindingNotFound('jira:prod');
    assert.equal(e.name, 'BindingNotFound');
    assert.equal(e.ref, 'jira:prod');
    assert.ok(e.message.includes('jira:prod'));
  });

  it('EngineValidationError carries yamlPath and issue', () => {
    const e = new EngineValidationError('/engines/jira.yaml', 'missing field "label"');
    assert.equal(e.name, 'EngineValidationError');
    assert.equal(e.yamlPath, '/engines/jira.yaml');
    assert.equal(e.issue, 'missing field "label"');
    assert.ok(e.message.includes('/engines/jira.yaml'));
    assert.ok(e.message.includes('missing field "label"'));
  });

  it('VaultEntryMalformed carries path', () => {
    const e = new VaultEntryMalformed('/ws/.otto/vault/jira/prod.yaml', 'invalid YAML');
    assert.equal(e.name, 'VaultEntryMalformed');
    assert.equal(e.path, '/ws/.otto/vault/jira/prod.yaml');
    assert.ok(e.message.includes('/ws/.otto/vault/jira/prod.yaml'));
  });
});
