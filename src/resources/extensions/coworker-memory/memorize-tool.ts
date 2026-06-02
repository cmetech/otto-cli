// src/resources/extensions/coworker-memory/memorize-tool.ts
import type { MemoryBundle } from './memory-singleton.js';
import type { LayerAKind } from '@otto/coworker-memory';

export interface MemorizeArgs {
  text: string;
  kind: LayerAKind;
  scope?: 'global' | 'workspace';
}

export async function runMemorize(bundle: MemoryBundle, args: MemorizeArgs): Promise<{ stored: true; layer_a_file: string }> {
  const scope = args.scope ?? 'workspace';
  const store = scope === 'global' ? bundle.globalLayerA : bundle.workspaceLayerA;
  const ts = new Date().toISOString();
  await store.append({ kind: args.kind, text: args.text, source: 'user', ts });
  return {
    stored: true,
    layer_a_file: args.kind === 'lesson' ? 'lessons.md' : args.kind === 'rule' ? 'rules.md' : 'profile.md',
  };
}
