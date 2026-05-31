import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersonaRegistry } from '@otto/coworker-persona';
import { handleList, handleCurrent, handleSwitch } from './persona-commands.js';

let tmpHome: string;
let tmpWs: string;
let registry: PersonaRegistry;

describe('persona slash commands', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-home-'));
    tmpWs = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-ws-'));
    await fs.mkdir(path.join(tmpHome, 'personas'), { recursive: true });
    registry = new PersonaRegistry({ ottoHome: tmpHome });
    await registry.ensureDefaultInstalled();
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
    await fs.rm(tmpWs, { recursive: true, force: true });
  });

  it('list returns lines including the default persona with active marker', async () => {
    const lines = await handleList(registry, tmpWs);
    const text = lines.join('\n');
    assert.match(text, /default/);
    assert.match(text, /\*/); // active marker on the active persona
  });

  it('current shows active persona name + display_name', async () => {
    const lines = await handleCurrent(registry, tmpWs);
    const text = lines.join('\n');
    assert.match(text, /default/);
    assert.match(text, /Default Co-Worker/);
  });

  it('switch updates the workspace record to the requested persona', async () => {
    await handleSwitch(registry, tmpWs, 'default');
    const raw = await fs.readFile(path.join(tmpWs, '.otto', 'persona.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.active, 'default');
  });

  it('switch to an unknown persona returns an error line', async () => {
    const result = await handleSwitch(registry, tmpWs, 'nonexistent').catch((e) => e.message);
    assert.match(result as string, /not installed|not found/i);
  });
});
