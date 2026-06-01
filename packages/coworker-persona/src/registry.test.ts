import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PersonaRegistry } from './registry.js';

let tmpHome: string;

describe('PersonaRegistry', () => {
  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), 'persona-test-'));
    await fs.mkdir(path.join(tmpHome, 'personas'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it('list returns built-in default persona on a fresh registry', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const installed = await r.list();
    assert.ok(installed.find(p => p.name === 'default'), 'default persona should be installed');
  });

  it('install copies a bundle directory into ~/.otto/personas/<name>', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    // Stage a fake persona bundle
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-bundle-'));
    await fs.mkdir(path.join(bundle, 'steering'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'manifest.yaml'),
      'name: noc-ops\ndisplay_name: NOC\nversion: 1.0.0\ndescription: x\nauthor: x\notto_version_required: ">=2.0.0"\nsteering: [steering/identity.md]\nstatus_line: { label: NOC, color: "#FAD22D", icon: "🛡" }\n');
    await fs.writeFile(path.join(bundle, 'steering', 'identity.md'), 'noc identity');

    await r.installFromPath(bundle);
    const installed = await r.list();
    assert.ok(installed.find(p => p.name === 'noc-ops'));
    await fs.rm(bundle, { recursive: true, force: true });
  });

  it('install rejects a bundle missing manifest.yaml', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    const bad = await fs.mkdtemp(path.join(os.tmpdir(), 'bad-bundle-'));
    await assert.rejects(() => r.installFromPath(bad), /manifest\.yaml/);
    await fs.rm(bad, { recursive: true, force: true });
  });

  it('activateInWorkspace writes <workspace>/.otto/persona.json', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    await r.activateInWorkspace(ws, 'default');
    const raw = await fs.readFile(path.join(ws, '.otto', 'persona.json'), 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.active, 'default');
    assert.equal(typeof data.activated_at, 'string');
    assert.equal(data.memory_seed_applied, false);
    await fs.rm(ws, { recursive: true, force: true });
  });

  it('activeInWorkspace returns "default" when no persona.json exists', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    const active = await r.activeInWorkspace(ws);
    assert.equal(active.name, 'default');
    await fs.rm(ws, { recursive: true, force: true });
  });

  it('uninstall refuses if persona is currently active in any tracked workspace', async () => {
    const r = new PersonaRegistry({ ottoHome: tmpHome });
    await r.ensureDefaultInstalled();
    // Stage + install a second persona, then activate it
    const bundle = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-bundle-'));
    await fs.mkdir(path.join(bundle, 'steering'), { recursive: true });
    await fs.writeFile(path.join(bundle, 'manifest.yaml'),
      'name: noc-ops\ndisplay_name: NOC\nversion: 1.0.0\ndescription: x\nauthor: x\notto_version_required: ">=2.0.0"\nsteering: [steering/identity.md]\nstatus_line: { label: NOC, color: "#FAD22D", icon: "🛡" }\n');
    await fs.writeFile(path.join(bundle, 'steering', 'identity.md'), 'noc');
    await r.installFromPath(bundle);

    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-'));
    await r.activateInWorkspace(ws, 'noc-ops');
    await assert.rejects(() => r.uninstall('noc-ops', { trackedWorkspaces: [ws] }), /active/);

    await fs.rm(bundle, { recursive: true, force: true });
    await fs.rm(ws, { recursive: true, force: true });
  });
});
