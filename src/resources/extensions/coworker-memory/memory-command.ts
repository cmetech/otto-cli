// src/resources/extensions/coworker-memory/memory-command.ts
import type { MemoryBundle } from './memory-singleton.js';
import { runMemorize } from './memorize-tool.js';

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
    default:
      throw new Error(`Unknown /memory subcommand: ${sub}. Try: note, status, clear, wing, room, seed.`);
  }
}
