// src/resources/extensions/coworker-memory/memory-command.ts
import type { MemoryBundle } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';
import { runRecall } from './recall-tool.js';

export interface MemoryCommandResult {
  message: string;
}

export async function runMemoryCommand(bundle: MemoryBundle, argv: string[]): Promise<MemoryCommandResult> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'note': {
      const text = rest.join(' ').trim();
      if (!text) throw new Error('Usage: /memory note <text>');
      await runMemorize(bundle, { text, kind: 'lesson', scope: 'workspace' });
      return { message: `lesson stored in workspace.` };
    }
    case 'status': {
      const status = await bundle.backend.status();
      return {
        message: [
          `scope_mode: ${bundle.scopeMode}`,
          `workspace_wing: ${bundle.workspaceWing}`,
          `drawer_count: ${status.drawer_count}`,
          `layer_b_db_path: ${status.layer_b_db_path}`,
          `schema_version: ${status.schema_version}`,
        ].join('\n'),
      };
    }
    case 'clear': {
      let wing: string | undefined;
      let confirm = false;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--wing' && rest[i+1]) { wing = rest[++i]; }
        else if (rest[i] === '--confirm') { confirm = true; }
      }
      if (!confirm) throw new Error('Usage: /memory clear --wing <wing> --confirm');
      const out = await bundle.backend.clear({ wing, confirm: true });
      return { message: `deleted: ${out.deleted}` };
    }
    case 'wing':
    case 'room': {
      // Session overrides — caller manages state; this is a placeholder return acknowledging.
      const target = rest.join(' ').trim();
      if (!target) throw new Error(`Usage: /memory ${sub} <name>`);
      return { message: `${sub} override: ${target}` };
    }
    case 'seed': {
      // Caller wires this to applyPersonaSeed via session-hooks; here we just acknowledge the request.
      return { message: 're-seed will run on next session_start; flip workspace.json.memory_seed_applied=false and reattach.' };
    }
    case 'show': {
      let target: 'all' | 'profile' | 'rule' | 'lesson' = 'all';
      let scopeOverride: 'workspace' | 'global' | null = null;
      for (let i = 0; i < rest.length; i++) {
        const t = rest[i];
        if (t === '--scope' && rest[i + 1]) {
          const s = rest[++i];
          if (s !== 'workspace' && s !== 'global') throw new Error(`Usage: /memory show [profile|rules|lessons] [--scope workspace|global]`);
          scopeOverride = s;
        } else if (t === 'profile') { target = 'profile'; }
        else if (t === 'rule' || t === 'rules') { target = 'rule'; }
        else if (t === 'lesson' || t === 'lessons') { target = 'lesson'; }
        else if (t === 'all') { target = 'all'; }
        else { throw new Error(`Usage: /memory show [profile|rules|lessons] [--scope workspace|global]`); }
      }
      const kinds: Array<'profile' | 'rule' | 'lesson'> =
        target === 'all' ? ['profile', 'rule', 'lesson'] : [target];
      // Determine scopes: --scope override wins; otherwise derive from bundle.scopeMode.
      const scopes: Array<{ name: 'workspace' | 'global'; store: typeof bundle.workspaceLayerA }> = [];
      if (scopeOverride === 'workspace') {
        scopes.push({ name: 'workspace', store: bundle.workspaceLayerA });
      } else if (scopeOverride === 'global') {
        scopes.push({ name: 'global', store: bundle.globalLayerA });
      } else if (bundle.scopeMode === 'global') {
        scopes.push({ name: 'global', store: bundle.globalLayerA });
      } else if (bundle.scopeMode === 'per-project') {
        scopes.push({ name: 'workspace', store: bundle.workspaceLayerA });
      } else {
        // per-project-tagged: workspace first, then global
        scopes.push({ name: 'workspace', store: bundle.workspaceLayerA });
        scopes.push({ name: 'global', store: bundle.globalLayerA });
      }
      const TITLE_FOR = { profile: 'Profile', rule: 'Rules', lesson: 'Lessons' } as const;
      const sections: string[] = [];
      for (const k of kinds) {
        for (const scope of scopes) {
          const body = await scope.store.read(k);
          sections.push(`## ${TITLE_FOR[k]} (${scope.name})\n${body || '(none)'}`);
        }
      }
      return { message: sections.join('\n\n') };
    }
    case 'recall': {
      // First flag/positional split: gather positional tokens for the query;
      // recognize --kind, --room, --wing, --limit, --days_back.
      const flags: { kind?: string; room?: string; wing?: string; limit?: number; days_back?: number } = {};
      const queryTokens: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const t = rest[i];
        if (t === '--kind' && rest[i + 1]) { flags.kind = rest[++i]; }
        else if (t === '--room' && rest[i + 1]) { flags.room = rest[++i]; }
        else if (t === '--wing' && rest[i + 1]) { flags.wing = rest[++i]; }
        else if (t === '--limit' && rest[i + 1]) {
          const n = parseInt(rest[++i]!, 10);
          if (Number.isFinite(n)) flags.limit = n;
        } else if (t === '--days_back' && rest[i + 1]) {
          const n = parseInt(rest[++i]!, 10);
          if (Number.isFinite(n)) flags.days_back = n;
        } else {
          queryTokens.push(t!);
        }
      }
      const query = queryTokens.join(' ').trim();
      if (!query) throw new Error('Usage: /memory recall <query> [--kind <k>] [--room <r>] [--wing <w>] [--limit N] [--days_back N]');
      // Defer to the same runRecall the LLM tool uses for parity.
      const out = await runRecall(bundle, {
        query,
        kind: flags.kind as never,           // runRecall accepts string; backend validates
        room: flags.room,
        wing: flags.wing,
        max_results: flags.limit,
        days_back: flags.days_back,
      });
      return { message: out.markdown };
    }
    default:
      throw new Error(`Unknown /memory subcommand: ${sub}. Try: note, status, clear, wing, room, seed, show, recall.`);
  }
}
