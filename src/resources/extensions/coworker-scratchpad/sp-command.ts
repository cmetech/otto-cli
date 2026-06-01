import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import type { ScratchpadManager } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl } from './helpers.js';

export interface SpDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
}

type SpVerb = 'list' | 'new' | 'attach' | 'reset' | 'view' | 'remove';
const VERBS: SpVerb[] = ['list', 'new', 'attach', 'reset', 'view', 'remove'];

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
  ui: { notify: (msg: string, level: 'info' | 'error' | 'warning') => void };
}

export function registerSpCommand(pi: ExtensionAPI, deps: SpDeps): void {
  pi.registerCommand('sp', {
    description: 'Manage scratchpads: /sp [list|new|attach|reset|view|remove] [name]',
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
            ctx.ui.notify(`created scratchpad: ${name} (now current)`, 'info');
            return;
          }
          case 'attach': {
            if (!name) { ctx.ui.notify('Usage: /sp attach <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().getOrAttach(name);
            deps.setCurrentName(name);
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
            if (!name) { ctx.ui.notify('Usage: /sp remove <name>', 'error'); return; }
            validateName(name);
            await deps.getManager().remove(name);
            if (deps.getCurrentName() === name) deps.setCurrentName(null);
            ctx.ui.notify(`removed scratchpad: ${name}`, 'info');
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
