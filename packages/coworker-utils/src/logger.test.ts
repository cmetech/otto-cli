import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, LogLevel } from './logger.js';

describe('logger', () => {
  it('createLogger returns an object with debug/info/warn/error', () => {
    const log = createLogger('test.namespace');
    assert.equal(typeof log.debug, 'function');
    assert.equal(typeof log.info, 'function');
    assert.equal(typeof log.warn, 'function');
    assert.equal(typeof log.error, 'function');
  });

  it('logs at or above the configured threshold', () => {
    const sink: string[] = [];
    const log = createLogger('test.threshold', {
      level: 'info' as LogLevel,
      sink: (line) => sink.push(line),
    });
    log.debug('hidden');
    log.info('visible-info');
    log.warn('visible-warn');
    assert.equal(sink.length, 2);
    assert.match(sink[0], /info.*visible-info/);
    assert.match(sink[1], /warn.*visible-warn/);
  });

  it('namespace prefix appears in each line', () => {
    const sink: string[] = [];
    const log = createLogger('coworker.memory', { level: 'debug', sink: (l) => sink.push(l) });
    log.info('hello');
    assert.match(sink[0], /coworker\.memory/);
  });

  it('child namespace appends to parent', () => {
    const sink: string[] = [];
    const log = createLogger('coworker', { level: 'debug', sink: (l) => sink.push(l) });
    const child = log.child('memory');
    child.info('hello');
    assert.match(sink[0], /coworker\.memory/);
  });

  it('serializes context object as appended JSON', () => {
    const sink: string[] = [];
    const log = createLogger('test.ctx', { level: 'debug', sink: (l) => sink.push(l) });
    log.info('msg', { user_id: 'u1', count: 3 });
    assert.match(sink[0], /"user_id":"u1"/);
    assert.match(sink[0], /"count":3/);
  });
});
