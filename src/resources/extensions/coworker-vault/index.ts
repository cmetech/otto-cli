// src/resources/extensions/coworker-vault/index.ts
//
// Coworker Vault production activator. Wires the Phase 2 command runners
// (runConnect, runDatasourceList/Remove/Test, runAudit) into pi's
// ExtensionAPI as /connect, /datasource, and /audit slash commands. Closes
// the Phase 2 "Phase 2.1+ deferral" — vault commands are now reachable from
// a live Otto session.
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { createVaultBundle, type VaultBundle, type VaultBundleOptions } from './vault-singleton.js';
import { runConnect, type PromptFieldOptions } from './connect-command.js';
import {
  runDatasourceList,
  runDatasourceRemove,
  runDatasourceTest,
} from './datasource-command.js';
import { runAudit, type AuditQuery } from './audit-command.js';
import { getCoworkerGlobalDir } from '../_coworker-paths.js';

export { createVaultBundle };
export type { VaultBundle, VaultBundleOptions };

export default function coworkerVaultExtension(api: ExtensionAPI): void {
  let bundle: VaultBundle | null = null;
  let unavailable = false;

  api.on('session_start', async (_event, ctx) => {
    try {
      bundle = await createVaultBundle({
        globalDir: getCoworkerGlobalDir(),
        workspaceDir: ctx.cwd,
      });
      unavailable = false;
    } catch (err) {
      unavailable = true;
      bundle = null;
      ctx.ui.notify(`vault unavailable: ${(err as Error).message}`, 'warning');
    }
  });

  api.registerCommand('connect', {
    description: 'Add or edit a credential entry. Usage: /connect <engine> <name> [--workspace]',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(
          unavailable ? 'vault unavailable; chat continues without it.' : 'vault not ready yet.',
          'warning',
        );
        return;
      }
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const flags = new Set(tokens.filter(t => t.startsWith('--')));
      const positional = tokens.filter(t => !t.startsWith('--'));
      const [engineId, entryName] = positional;
      if (!engineId || !entryName) {
        ctx.ui.notify('Usage: /connect <engine> <name> [--workspace]', 'info');
        return;
      }
      const forceWorkspace = flags.has('--workspace');
      // Wire ctx.ui.input as the prompt provider. If hasUI is false (print/RPC
      // mode), surface a non-error notice and bail rather than throwing.
      if (!ctx.hasUI) {
        ctx.ui.notify('interactive /connect requires a TTY session.', 'warning');
        return;
      }
      const promptProvider = async (field: string, opts: PromptFieldOptions): Promise<string> => {
        const placeholder = opts.defaultValue ?? '';
        const title = `${opts.label}${opts.required ? ' *' : ''}${opts.secret ? ' (hidden)' : ''}`;
        const result = await ctx.ui.input(title, placeholder);
        return result ?? '';
      };
      try {
        await runConnect(bundle, { engineId, entryName, forceWorkspace, promptProvider });
        ctx.ui.notify(`saved ${engineId}:${entryName}`, 'success');
      } catch (err) {
        ctx.ui.notify(`/connect failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.registerCommand('datasource', {
    description: '/datasource list [engine] | remove <engine:name> | test <engine:name>',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(
          unavailable ? 'vault unavailable; chat continues without it.' : 'vault not ready yet.',
          'warning',
        );
        return;
      }
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const [sub, ...rest] = tokens;
      try {
        switch (sub) {
          case undefined:
          case 'list': {
            const engineFilter = rest[0];
            const rows = await runDatasourceList(bundle, engineFilter ? { engine: engineFilter } : {});
            const lines = rows.length === 0
              ? ['no datasources configured']
              : rows.map(r => `  ${r.engine}:${r.name} (${r.scope})`);
            ctx.ui.notify(lines.join('\n'), 'info');
            return;
          }
          case 'remove': {
            const ref = rest.join(' ').trim();
            if (!ref) {
              ctx.ui.notify('Usage: /datasource remove <engine:name>', 'info');
              return;
            }
            await runDatasourceRemove(bundle, { ref });
            ctx.ui.notify(`removed: ${ref}`, 'success');
            return;
          }
          case 'test': {
            const ref = rest.join(' ').trim();
            if (!ref) {
              ctx.ui.notify('Usage: /datasource test <engine:name>', 'info');
              return;
            }
            const preview = await runDatasourceTest(bundle, { ref });
            ctx.ui.notify(`Would inject: ${preview.envVarNames.join(', ')}`, 'info');
            return;
          }
          default:
            ctx.ui.notify(`Unknown /datasource subcommand: ${sub}. Try: list, remove, test.`, 'warning');
        }
      } catch (err) {
        ctx.ui.notify(`/datasource failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.registerCommand('audit', {
    description: '/audit [--since 1h|24h|7d|ISO] [--producer P] [--engine E] [--action A] [--severity info|warn] [--limit N]',
    handler: async (args, ctx) => {
      if (!bundle) {
        ctx.ui.notify(
          unavailable ? 'vault unavailable; chat continues without it.' : 'vault not ready yet.',
          'warning',
        );
        return;
      }
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const q: AuditQuery = {};
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const next = tokens[i + 1];
        if (t === '--since' && next) { q.since = next; i++; }
        else if (t === '--producer' && next) { q.producer = next; i++; }
        else if (t === '--engine' && next) { q.engine = next; i++; }
        else if (t === '--action' && next) { q.action = next; i++; }
        else if (t === '--severity' && next) {
          if (next === 'info' || next === 'warn') { q.severity = next; }
          i++;
        }
        else if (t === '--limit' && next) {
          const n = parseInt(next, 10);
          if (Number.isFinite(n) && n > 0) q.limit = n;
          i++;
        }
      }
      try {
        const rows = await runAudit(bundle, q);
        const lines = rows.length === 0
          ? ['no audit records match']
          : rows.map(r => {
              const engine = typeof r.detail?.engine === 'string' ? r.detail.engine : undefined;
              return `  [${r.ts}] ${r.producer}/${r.action}${engine ? ` engine=${engine}` : ''}`;
            });
        ctx.ui.notify(lines.join('\n'), 'info');
      } catch (err) {
        ctx.ui.notify(`/audit failed: ${(err as Error).message}`, 'error');
      }
    },
  });

  api.on('session_shutdown', async () => {
    // Phase 2 VaultBundle has no async dispose path; clearing the reference is enough.
    bundle = null;
  });
}
