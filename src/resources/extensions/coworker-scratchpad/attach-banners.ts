import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecoveryNote } from '@otto/coworker-scratchpad';

type RecoveryNoteEntry = RecoveryNote & { at: string };

interface UiNotify {
  notify: (msg: string, level: 'info' | 'warning' | 'error') => void;
}

export function showRecoveryNotesBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { unseenCount: number; markSeen: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { unseenCount: 0, markSeen: false };
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { unseenCount: 0, markSeen: false };
  }
  const notes = Array.isArray(meta.recovery_notes) ? (meta.recovery_notes as RecoveryNoteEntry[]) : [];
  if (notes.length === 0) return { unseenCount: 0, markSeen: false };
  const seenAt = typeof meta.recovery_notes_seen_at === 'string' ? meta.recovery_notes_seen_at : null;
  const unseen = notes.filter((n) => seenAt === null || n.at > seenAt);
  if (unseen.length === 0) return { unseenCount: 0, markSeen: false };
  const head = unseen.slice(0, 5).map(formatNoteLine).join('\n');
  const tail = unseen.length > 5 ? `\n+ ${unseen.length - 5} more (run /sp notes)` : '';
  ui.notify(`⚠ ${unseen.length} unread recovery notes:\n${head}${tail}`, 'warning');
  return { unseenCount: unseen.length, markSeen: true };
}

export function showDivergenceBanner(
  name: string,
  rootDir: string,
  ui: UiNotify,
): { diverged: boolean } {
  const metaPath = join(rootDir, name, 'meta.json');
  if (!existsSync(metaPath)) return { diverged: false };
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { diverged: false };
  }
  const leaf = typeof meta.cell_leaf_id === 'number' ? meta.cell_leaf_id : null;
  const kernel = typeof meta.kernel_at_cell_id === 'number' ? meta.kernel_at_cell_id : null;
  if (leaf === null || kernel === null || leaf === kernel) return { diverged: false };
  ui.notify(
    `ℹ kernel state is at cell #${kernel}; view is at cell #${leaf} (run /sp tree to inspect)`,
    'info',
  );
  return { diverged: true };
}

export function formatNoteLine(n: RecoveryNoteEntry): string {
  const ts = n.at.slice(0, 19);
  switch (n.kind) {
    case 'snapshot-failed':       return `  • [${ts}] snapshot-failed: ${n.message}`;
    case 'cells-since-snapshot':  return `  • [${ts}] ${n.n} cells since last snapshot`;
    case 'namespace-corrupt':     return `  • [${ts}] namespace-corrupt: ${n.message}`;
    case 'namespace-absent':      return `  • [${ts}] namespace-absent`;
    default:                      return `  • [${ts}] ${(n as { kind: string }).kind}`;
  }
}
