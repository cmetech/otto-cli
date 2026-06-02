// packages/coworker-memory/src/persona-seed.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LayerAStore } from './layer-a-store.js';
import type { LayerAKind } from './types.js';
import { LayerAWriteBlocked } from './errors.js';

const FILE_MAP: Array<{ name: string; kind: LayerAKind }> = [
  { name: 'profile.md', kind: 'profile' },
  { name: 'rules.md', kind: 'rule' },
  { name: 'lessons.md', kind: 'lesson' },
];

export interface SeedResult {
  copied: string[];
  blocked: string[];
}

export async function applyPersonaSeed(args: {
  personaId: string;
  personaDir: string;
  store: LayerAStore;
}): Promise<SeedResult> {
  const seedDir = join(args.personaDir, 'memory-seed');
  if (!existsSync(seedDir)) return { copied: [], blocked: [] };
  const ts = new Date().toISOString();
  const copied: string[] = [];
  const blocked: string[] = [];
  for (const entry of FILE_MAP) {
    const path = join(seedDir, entry.name);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8').trim();
    if (!text) continue;
    try {
      await args.store.append({ kind: entry.kind, text, source: 'persona-seed', ts });
      copied.push(entry.name);
    } catch (err) {
      if (err instanceof LayerAWriteBlocked) {
        blocked.push(entry.name);
      } else {
        throw err;
      }
    }
  }
  return { copied, blocked };
}
