import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import type { ScratchpadManager } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl, readPersistedLeaf } from './helpers.js';
import { projectTree, formatTreeText } from '@otto/coworker-scratchpad';
import { sessionSidecarPath, writeSessionSidecar, deleteSessionSidecar } from './session-sidecar.js';

export interface SpDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
  getSessionId: () => string;
}

type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove' | 'tree' | 'fork' | 'save' | 'detach' | 'clear-history';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove', 'tree', 'fork', 'save', 'detach', 'clear-history'];

function ensureCurrent(deps: SpDeps): string {
  let current = deps.getCurrentName();
  if (!current) {
    current = 'default';
    deps.setCurrentName(current);
  }
  return current;
}

function listExistingScratchpads(root: string): string[] {
  if (!existsSync(root)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    try {
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'meta.json'))) names.push(entry);
    } catch {
      // entry vanished -> skip
    }
  }
  return names.sort();
}

function formatCellSummary(rec: { id: number; ok: boolean; code: string; value?: unknown; error?: { message: string } }): string {
  const head = rec.ok ? `cell ${rec.id} [ok]` : `cell ${rec.id} [err]`;
  const value = rec.ok ? ` value=${JSON.stringify(rec.value)}` : ` error=${rec.error?.message ?? ''}`;
  return `${head} ${rec.code.split('\n')[0].slice(0, 80)} ${value}`;
}

interface UiCtx {
  hasUI: boolean;
  ui: {
    notify: (msg: string, level: 'info' | 'error' | 'warning') => void;
    confirm: (title: string, msg: string) => Promise<boolean>;
  };
}

export function registerSpCommand(pi: ExtensionAPI, deps: SpDeps): void {
  pi.registerCommand('sp', {
    description: 'Manage scratchpads: /sp [list|new|attach|reset|view|remove|tree|fork|save|detach|clear-history] [name]',
    getArgumentCompletions: (prefix: string) => {
      // Split on whitespace but preserve whether the prefix ends with a space
      // (trailing space = user typed the verb and hit space, ready for name completion).
      const trimmed = prefix.trimStart();
      const parts = trimmed.split(/\s+/);
      // If trailing space: user has finished typing the verb, want name completions.
      const trailingSpace = prefix.endsWith(' ');
      if (parts.length <= 1 && !trailingSpace) {
        return VERBS.filter((v) => v.startsWith(parts[0] ?? '')).map((v) => ({ value: v, label: v }));
      }
      const verb = parts[0];
      if (verb === 'attach' || verb === 'reset' || verb === 'view' || verb === 'remove') {
        const namePrefix = trailingSpace && parts.length === 1 ? '' : (parts[1] ?? '');
        return listExistingScratchpads(deps.rootDir())
          .filter((n) => n.startsWith(namePrefix))
          .map((n) => ({ value: `${verb} ${n}`, label: n }));
      }
      return [];
    },
    handler: async (args: string, ctx: UiCtx) => {
      const trimmed = args.trim();
      const parts = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
      const verb = (parts[0] as SpVerb | undefined) ?? 'list';
      const name = parts[1];

      try {
        switch (verb) {
          case 'list': {
            const mgr = deps.getManager();
            const live = mgr.list();
            const liveByName = new Map(live.map((e) => [e.name, e]));
            const onDisk = listExistingScratchpads(deps.rootDir());
            const all = Array.from(new Set([...liveByName.keys(), ...onDisk])).sort();
            const cur = deps.getCurrentName();
            if (all.length === 0) {
              ctx.ui.notify('No scratchpads yet. Use /sp new <name> to create one.', 'info');
              return;
            }
            const lines = all.map((n) => {
              const l = liveByName.get(n);
              const state = l?.live ? '● live' : '○ cold';
              const marker = n === cur ? ' (current)' : '';
              return `  ${state}  ${n}${marker}`;
            });
            ctx.ui.notify(['scratchpads:', ...lines].join('\n'), 'info');
            return;
          }
          case 'new': {
            if (!name) { ctx.ui.notify('Usage: /sp new <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().create(name);
            deps.setCurrentName(name);
            writeSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()), {
              schema_version: 1,
              session_id: deps.getSessionId(),
              current_name: name,
              attached_at: new Date().toISOString(),
            });
            ctx.ui.notify(`created scratchpad: ${name} (now current)`, 'info');
            return;
          }
          case 'attach': {
            if (!name) { ctx.ui.notify('Usage: /sp attach <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().getOrAttach(name);
            deps.setCurrentName(name);
            writeSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()), {
              schema_version: 1,
              session_id: deps.getSessionId(),
              current_name: name,
              attached_at: new Date().toISOString(),
            });
            ctx.ui.notify(`attached to scratchpad: ${name}`, 'info');
            return;
          }
          case 'reset': {
            const target = name ?? ensureCurrent(deps);
            validateName(target);
            const mgr = deps.getManager();
            await mgr.remove(target);
            await mgr.create(target);
            // currentName preserved if it was the reset target; otherwise unchanged
            ctx.ui.notify(`reset scratchpad: ${target}`, 'info');
            return;
          }
          case 'view': {
            const target = name ?? ensureCurrent(deps);
            validateName(target);
            const { cells, total_cells } = readCellsJsonl(join(deps.rootDir(), target));
            if (total_cells === 0) {
              ctx.ui.notify(`${target}: no cells yet`, 'info');
              return;
            }
            const tail = cells.slice(-10);
            const lines = tail.map((c) => formatCellSummary(c));
            ctx.ui.notify([`${target} (${total_cells} cells, last 10):`, ...lines].join('\n'), 'info');
            return;
          }
          case 'remove': {
            if (!name) { ctx.ui.notify('Usage: /sp remove <name> [--yes]', 'error'); return; }
            const force = parts.includes('--yes');
            validateName(name);
            if (name === deps.getCurrentName() && !force) {
              const confirmed = await ctx.ui.confirm(
                'Remove current scratchpad?',
                `${name} is your current scratchpad. Remove it? This deletes kernel.db, namespace.json, and the cell journal.`,
              );
              if (!confirmed) { ctx.ui.notify('cancelled', 'info'); return; }
            }
            const wasCurrent = name === deps.getCurrentName();
            await deps.getManager().remove(name);
            if (wasCurrent) {
              deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
              deps.setCurrentName(null);
            }
            ctx.ui.notify(`removed scratchpad: ${name}`, 'info');
            return;
          }
          case 'tree': {
            // Usage: /sp tree [<name>] [--to <id>]
            const flagIdx = parts.indexOf('--to');
            let target: string;
            if (flagIdx === -1) {
              target = name ?? ensureCurrent(deps);
            } else {
              target = flagIdx === 1 ? ensureCurrent(deps) : (parts[1] as string);
              const toId = Number(parts[flagIdx + 1]);
              if (!Number.isInteger(toId) || toId <= 0) {
                ctx.ui.notify('Usage: /sp tree [<name>] --to <id>', 'error');
                return;
              }
              validateName(target);
              await deps.getManager().setLeaf(target, toId);
              ctx.ui.notify(`set leaf of ${target} to cell ${toId}`, 'info');
              return;
            }
            validateName(target);
            const { cells } = readCellsJsonl(join(deps.rootDir(), target));
            if (cells.length === 0) {
              ctx.ui.notify(`${target}: no cells yet`, 'info');
              return;
            }
            const tree = projectTree(cells);
            const leaf = readPersistedLeaf(join(deps.rootDir(), target, 'meta.json'));
            ctx.ui.notify(`${target} cell tree:\n${formatTreeText(tree, leaf)}`, 'info');
            return;
          }
          case 'fork': {
            // Usage: /sp fork <src> <dst>
            if (parts.length < 3) { ctx.ui.notify('Usage: /sp fork <src> <dst>', 'error'); return; }
            const src = parts[1]!;
            const dst = parts[2]!;
            validateName(src);
            validateName(dst);
            await deps.getManager().fork(src, dst);
            ctx.ui.notify(`forked ${src} → ${dst}`, 'info');
            return;
          }
          case 'save': {
            const target = name ?? deps.getCurrentName();
            if (!target) { ctx.ui.notify('Usage: /sp save [<name>] — no current scratchpad', 'error'); return; }
            validateName(target);
            await deps.getManager().save(target);
            ctx.ui.notify(`saved ${target}`, 'info');
            return;
          }
          case 'detach': {
            const target = deps.getCurrentName();
            if (!target) { ctx.ui.notify('not attached to any scratchpad', 'error'); return; }
            await deps.getManager().detach(target, deps.getSessionId());
            deleteSessionSidecar(sessionSidecarPath(deps.rootDir(), deps.getSessionId()));
            deps.setCurrentName(null);
            ctx.ui.notify(`detached from ${target}`, 'info');
            return;
          }
          case 'clear-history': {
            const target = name ?? deps.getCurrentName();
            if (!target) { ctx.ui.notify('Usage: /sp clear-history [<name>] — no current scratchpad', 'error'); return; }
            validateName(target);
            const confirmed = await ctx.ui.confirm(
              'Clear cell history?',
              `Clear cell history for ${target}? kernel.db + namespace.json are preserved.`,
            );
            if (!confirmed) { ctx.ui.notify('cancelled', 'info'); return; }
            await deps.getManager().clearHistory(target);
            ctx.ui.notify(`cleared cell history for ${target}`, 'info');
            return;
          }
          default: {
            ctx.ui.notify(`unknown verb: ${verb}. Try one of: ${VERBS.join(', ')}`, 'error');
          }
        }
      } catch (err) {
        ctx.ui.notify((err as Error).message, 'error');
      }
    },
  });
}
