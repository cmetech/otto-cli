// PersonaRegistry — install / list / activate / switch. Spec §2.5.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parsePersonaManifest, type PersonaManifest } from './manifest.js';

export interface RegistryOptions {
  ottoHome: string;            // typically ~/.otto
}

export interface ActiveRecord {
  active: string;
  activated_at: string;
  memory_seed_applied: boolean;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fs.copyFile(s, d);
    }
  }
}

export class PersonaRegistry {
  #personasDir: string;

  constructor(opts: RegistryOptions) {
    this.#personasDir = path.join(opts.ottoHome, 'personas');
  }

  async ensureDefaultInstalled(): Promise<void> {
    const target = path.join(this.#personasDir, 'default');
    if (await dirExists(target)) return;
    // Source: bundled defaults shipped with this package
    const here = path.dirname(new URL(import.meta.url).pathname);
    const source = path.join(here, 'defaults');
    await copyDir(source, target);
  }

  async list(): Promise<PersonaManifest[]> {
    if (!(await dirExists(this.#personasDir))) return [];
    const entries = await fs.readdir(this.#personasDir, { withFileTypes: true });
    const out: PersonaManifest[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifestPath = path.join(this.#personasDir, e.name, 'manifest.yaml');
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        out.push(parsePersonaManifest(raw));
      } catch {
        // skip malformed bundles
      }
    }
    return out;
  }

  async installFromPath(bundlePath: string): Promise<PersonaManifest> {
    const manifestPath = path.join(bundlePath, 'manifest.yaml');
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`bundle missing manifest.yaml at ${manifestPath}`);
      }
      throw err;
    }
    const manifest = parsePersonaManifest(raw);
    const target = path.join(this.#personasDir, manifest.name);
    await fs.rm(target, { recursive: true, force: true });
    await copyDir(bundlePath, target);
    return manifest;
  }

  async activateInWorkspace(workspaceRoot: string, name: string): Promise<void> {
    const persona = await this.get(name);
    if (!persona) throw new Error(`persona not installed: ${name}`);
    const wsOtto = path.join(workspaceRoot, '.otto');
    await fs.mkdir(wsOtto, { recursive: true });
    const record: ActiveRecord = {
      active: name,
      activated_at: new Date().toISOString(),
      memory_seed_applied: false,
    };
    await fs.writeFile(path.join(wsOtto, 'persona.json'), JSON.stringify(record, null, 2));
  }

  async activeInWorkspace(workspaceRoot: string): Promise<PersonaManifest> {
    const recordPath = path.join(workspaceRoot, '.otto', 'persona.json');
    try {
      const raw = await fs.readFile(recordPath, 'utf8');
      const record = JSON.parse(raw) as ActiveRecord;
      const m = await this.get(record.active);
      if (m) return m;
    } catch {
      // fall through to default
    }
    const def = await this.get('default');
    if (!def) throw new Error('default persona not installed');
    return def;
  }

  async get(name: string): Promise<PersonaManifest | null> {
    const manifestPath = path.join(this.#personasDir, name, 'manifest.yaml');
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      return parsePersonaManifest(raw);
    } catch {
      return null;
    }
  }

  async uninstall(name: string, opts: { trackedWorkspaces: string[] }): Promise<void> {
    if (name === 'default') {
      throw new Error('cannot uninstall the built-in default persona');
    }
    for (const ws of opts.trackedWorkspaces) {
      try {
        const raw = await fs.readFile(path.join(ws, '.otto', 'persona.json'), 'utf8');
        const record = JSON.parse(raw) as ActiveRecord;
        if (record.active === name) {
          throw new Error(`persona ${name} is active in workspace ${ws}; switch first`);
        }
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        if (err instanceof Error && err.message.startsWith('persona ')) throw err;
      }
    }
    await fs.rm(path.join(this.#personasDir, name), { recursive: true, force: true });
  }
}
