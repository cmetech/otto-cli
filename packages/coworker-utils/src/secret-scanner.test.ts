import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SecretScanner } from './secret-scanner.js';

describe('SecretScanner', () => {
  const scanner = new SecretScanner();

  it('detects an Anthropic key pattern', () => {
    const text = 'My key is sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'anthropic_api_key');
  });

  it('detects an OpenAI sk- key', () => {
    const text = 'openai key: sk-proj-AAAAaaaaBBBBccccDDDDeeeeFFFFggggHHHHiiiiJJJJkkkkLLLL';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'openai_api_key');
  });

  it('detects an AWS access key id', () => {
    const text = 'AKIAIOSFODNN7EXAMPLE was leaked';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'aws_access_key_id');
  });

  it('detects a GitHub PAT', () => {
    const text = 'token: ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].kind, 'github_pat');
  });

  it('does not flag generic English text', () => {
    const text = 'The server had multiple alerts and we restarted it twice.';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 0);
  });

  it('redact replaces detected secrets with [REDACTED:<kind>]', () => {
    const text = 'My key is sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC and a note.';
    const redacted = scanner.redact(text);
    assert.match(redacted, /\[REDACTED:anthropic_api_key\]/);
    assert.match(redacted, /and a note\.$/);
  });

  it('returns multiple hits when multiple secrets present', () => {
    const text = 'sk-ant-api03-aaaabbbbccccddddeeeeffffgggghhhh111122223333AAA-BBBBCCCC AKIAIOSFODNN7EXAMPLE';
    const hits = scanner.scan(text);
    assert.equal(hits.length, 2);
  });

  it('records hit positions (start, end) in the original text', () => {
    const text = '----AKIAIOSFODNN7EXAMPLE----';
    const hits = scanner.scan(text);
    assert.equal(hits[0].start, 4);
    assert.equal(hits[0].end, 24);
  });
});
