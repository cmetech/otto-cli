// packages/coworker-vault/src/engine-registry.ts
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type { EngineDefinition, EngineSource } from './types.js';
import { EngineNotFound } from './errors.js';

const ENGINE_FIELD_SCHEMA = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, 'name must match /^[a-z][a-z0-9_]*$/'),
  label: z.string().min(1),
  secret: z.boolean(),
  required: z.boolean(),
  default: z.string().optional(),
});

const ENGINE_SCHEMA = z
  .object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'id must match /^[a-z][a-z0-9-]*$/'),
    label: z.string().min(1),
    description: z.string().optional(),
    fields: z.array(ENGINE_FIELD_SCHEMA).min(1),
  })
  .passthrough(); // accept unknown top-level keys (forward compat for test: blocks etc.)

function builtinDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'engines');
}

export interface RegistryResolution {
  engine: EngineDefinition;
  source: EngineSource;
}

export interface LoadOptions {
  userDir?: string | undefined;
  workspaceDir?: string | undefined;
}

export class EngineRegistry {
  private constructor(private readonly resolutions: Map<string, RegistryResolution>) {}

  static async load(opts: LoadOptions = {}): Promise<EngineRegistry> {
    const map = new Map<string, RegistryResolution>();
    EngineRegistry.loadDir(builtinDir(), 'builtin', map);
    if (opts.userDir && existsSync(opts.userDir)) {
      EngineRegistry.loadDir(opts.userDir, 'user', map);
    }
    if (opts.workspaceDir && existsSync(opts.workspaceDir)) {
      EngineRegistry.loadDir(opts.workspaceDir, 'workspace', map);
    }
    return new EngineRegistry(map);
  }

  private static loadDir(dir: string, source: EngineSource, out: Map<string, RegistryResolution>): void {
    if (!existsSync(dir)) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    } catch {
      return;
    }
    for (const f of entries) {
      const path = join(dir, f);
      let parsed: unknown;
      try {
        parsed = parseYaml(readFileSync(path, 'utf8'));
      } catch (err) {
        process.stderr.write(
          `engine-registry: parse failed ${path}: ${(err as Error).message}\n`,
        );
        continue;
      }
      const result = ENGINE_SCHEMA.safeParse(parsed);
      if (!result.success) {
        const detail = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        process.stderr.write(`engine-registry: schema invalid ${path}: ${detail}\n`);
        continue;
      }
      out.set(result.data.id, { engine: result.data as EngineDefinition, source });
    }
  }

  get(id: string): EngineDefinition | undefined {
    return this.resolutions.get(id)?.engine;
  }

  require(id: string): EngineDefinition {
    const r = this.resolutions.get(id);
    if (!r) throw new EngineNotFound(id);
    return r.engine;
  }

  source(id: string): EngineSource | undefined {
    return this.resolutions.get(id)?.source;
  }

  all(): RegistryResolution[] {
    return [...this.resolutions.values()];
  }
}

export { ENGINE_SCHEMA };
