import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CELLS_SCHEMA_VERSION = 1;

export interface CellEntry {
  id: number;
  parentId: number | null;
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
  ts: string;
}

export interface AppendInput {
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
}

export class CellArchive {
  private readonly path: string;
  private nextId: number;
  #lastId: number | null;

  constructor(private readonly dir: string, private readonly now: () => number = Date.now) {
    this.path = join(dir, 'cells.jsonl');
    const { nextId, lastId } = this.scan();
    this.nextId = nextId;
    this.#lastId = lastId;
  }

  private scan(): { nextId: number; lastId: number | null } {
    if (!existsSync(this.path)) return { nextId: 1, lastId: null };
    let lastId: number | null = null;
    for (const line of readFileSync(this.path, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { id?: unknown };
        if (typeof obj.id === 'number') lastId = obj.id;
      } catch {
        // header or corrupt line -> ignore
      }
    }
    return { nextId: (lastId ?? 0) + 1, lastId };
  }

  private ensureHeader(): void {
    if (existsSync(this.path)) return;
    mkdirSync(this.dir, { recursive: true });
    appendFileSync(this.path, JSON.stringify({ type: 'header', version: CELLS_SCHEMA_VERSION }) + '\n');
  }

  append(input: AppendInput): CellEntry {
    this.ensureHeader();
    const id = this.nextId++;
    const entry: CellEntry = {
      id,
      parentId: this.#lastId,
      code: input.code,
      ok: input.ok,
      ...(input.ok ? { value: input.value } : { error: input.error }),
      stdout: input.stdout,
      ts: new Date(this.now()).toISOString(),
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    this.#lastId = id;
    return entry;
  }

  get lastId(): number | null {
    return this.#lastId;
  }
}
