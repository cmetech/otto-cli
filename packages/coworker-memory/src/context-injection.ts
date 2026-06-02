// packages/coworker-memory/src/context-injection.ts
import type { ScopeMode } from './types.js';
import type { LayerAStore } from './layer-a-store.js';

export interface ContextInjectionArgs {
  mode: ScopeMode;
  globalStore: LayerAStore;
  workspaceStore: LayerAStore;
  tokenLimit: number;     // approx 4 chars per token
}

const CHARS_PER_TOKEN = 4;

export async function buildLayerAContext(args: ContextInjectionArgs): Promise<string> {
  const charLimit = args.tokenLimit * CHARS_PER_TOKEN;

  const readScopes: Array<'workspace' | 'global'> = args.mode === 'global'
    ? ['global']
    : args.mode === 'per-project'
      ? ['workspace']
      : ['workspace', 'global'];

  type Section = { title: string; body: string; priority: number };
  const sections: Section[] = [];

  const PRIORITIES: Record<string, number> = { profile: 0, rules: 1, lessons: 2 };

  for (const scope of readScopes) {
    const store = scope === 'global' ? args.globalStore : args.workspaceStore;
    const profile = await store.read('profile');
    const rules = await store.read('rule');
    const lessons = await store.read('lesson');
    if (profile) sections.push({ title: `Profile (${scope})`, body: profile, priority: PRIORITIES.profile! });
    if (rules) sections.push({ title: `Rules (${scope})`, body: rules, priority: PRIORITIES.rules! });
    if (lessons) sections.push({ title: `Recent lessons (${scope})`, body: lessons, priority: PRIORITIES.lessons! });
  }

  if (sections.length === 0) return '';

  // workspace comes first because we iterated readScopes in that order; stable sort by priority.
  sections.sort((a, b) => a.priority - b.priority);

  let total = 0;
  const include: Section[] = [];
  for (const s of sections) {
    const cost = s.title.length + s.body.length + 10;
    if (total + cost > charLimit && include.length > 0) break;
    include.push(s);
    total += cost;
  }

  const lines = ['## Memory (Layer A)\n'];
  for (const s of include) {
    lines.push(`### ${s.title}\n${s.body}\n`);
  }
  return lines.join('\n');
}
