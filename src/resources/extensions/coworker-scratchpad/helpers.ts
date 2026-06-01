import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CellEntry } from '@otto/coworker-scratchpad';

export const SCRATCHPAD_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

export function validateName(name: string): void {
  if (!SCRATCHPAD_NAME_REGEX.test(name)) {
    throw new Error(`invalid scratchpad name: ${JSON.stringify(name)} (must match ${SCRATCHPAD_NAME_REGEX})`);
  }
}

export interface CellsJsonlRead {
  cells: CellEntry[];
  total_cells: number;
}

export function readCellsJsonl(dir: string): CellsJsonlRead {
  const path = join(dir, 'cells.jsonl');
  if (!existsSync(path)) return { cells: [], total_cells: 0 };
  const cells: CellEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as { id?: unknown };
      if (typeof obj.id === 'number') cells.push(obj as CellEntry);
    } catch {
      // header line or trailing corrupt line -> skip (same tolerance as CellArchive.scan)
    }
  }
  return { cells, total_cells: cells.length };
}
