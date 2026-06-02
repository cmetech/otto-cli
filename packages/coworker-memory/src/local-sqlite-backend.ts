// packages/coworker-memory/src/local-sqlite-backend.ts
import Database, { type Database as DB } from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuid } from 'uuid';
import type { MemoryBackend } from './memory-backend.js';
import type { Drawer, RecallQuery, RecallResult, BackendStatus, Wing, Room } from './types.js';
import { RecallQueryMalformed, BackendUnavailable } from './errors.js';

export interface LocalSqliteBackendOptions {
  dbPath: string;
  now?: () => string;
  busyTimeoutMs?: number;
}

function migrationDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

function escapeFts5(q: string): string {
  // Wrap each word containing special chars in double quotes; doubled internal quotes.
  // Empty query → throw upstream.
  const tokens = q.match(/\S+/g) ?? [];
  return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

export class LocalSqliteBackend implements MemoryBackend {
  private db: DB | null = null;
  private readonly path: string;
  private readonly now: () => string;
  private readonly busyTimeoutMs: number;

  constructor(opts: LocalSqliteBackendOptions) {
    this.path = opts.dbPath;
    this.now = opts.now ?? (() => new Date().toISOString());
    this.busyTimeoutMs = opts.busyTimeoutMs ?? 2000;
  }

  async open(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    try {
      this.db = new Database(this.path);
      this.db.pragma(`busy_timeout = ${this.busyTimeoutMs}`);
      const initSql = readFileSync(join(migrationDir(), '001-init.sql'), 'utf8');
      this.db.exec(initSql);
    } catch (err) {
      throw new BackendUnavailable(`open failed: ${(err as Error).message}`);
    }
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private requireDb(): DB {
    if (!this.db) throw new BackendUnavailable('not opened');
    return this.db;
  }

  async retain(input: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer> {
    const db = this.requireDb();
    const id = uuid();
    const created_at = this.now();
    const stmt = db.prepare(`
      INSERT INTO drawers (id, wing, room, kind, content, metadata_json, parent_id, redacted, created_at)
      VALUES (@id, @wing, @room, @kind, @content, @metadata_json, @parent_id, @redacted, @created_at)
    `);
    stmt.run({
      id, wing: input.wing, room: input.room, kind: input.kind, content: input.content,
      metadata_json: JSON.stringify(input.metadata ?? {}),
      parent_id: input.parent_id ?? null,
      redacted: input.redacted ? 1 : 0,
      created_at,
    });
    return { id, created_at, ...input };
  }

  async recall(query: RecallQuery): Promise<RecallResult[]> {
    if (!query.query || !query.query.trim()) throw new RecallQueryMalformed('empty query');
    const db = this.requireDb();
    const matchExpr = escapeFts5(query.query.trim());
    const conditions: string[] = ['drawers_fts MATCH ?'];
    const params: unknown[] = [matchExpr];

    if (query.wing) {
      if (Array.isArray(query.wing)) {
        conditions.push(`d.wing IN (${query.wing.map(() => '?').join(',')})`);
        params.push(...query.wing);
      } else {
        conditions.push('d.wing = ?');
        params.push(query.wing);
      }
    }
    if (query.room) { conditions.push('d.room = ?'); params.push(query.room); }
    if (query.kind) {
      const kinds = Array.isArray(query.kind) ? query.kind : [query.kind];
      conditions.push(`d.kind IN (${kinds.map(() => '?').join(',')})`);
      params.push(...kinds);
    }
    if (query.days_back && query.days_back > 0) {
      const cutoff = new Date(Date.now() - query.days_back * 86400_000).toISOString();
      conditions.push('d.created_at >= ?');
      params.push(cutoff);
    }
    const limit = Math.min(Math.max(query.max_results ?? 8, 1), 64);
    params.push(limit);

    const sql = `
      SELECT d.id, d.wing, d.room, d.kind, d.content, d.metadata_json, d.parent_id, d.redacted, d.created_at,
             bm25(drawers_fts) AS rank,
             snippet(drawers_fts, 0, '<mark>', '</mark>', '...', 16) AS snippet
      FROM drawers_fts
      JOIN drawers d ON d.rowid = drawers_fts.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY rank
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params) as Array<{
      id: string; wing: string; room: string; kind: Drawer['kind']; content: string;
      metadata_json: string; parent_id: string | null; redacted: number; created_at: string;
      rank: number; snippet: string;
    }>;
    return rows.map(r => ({
      drawer: {
        id: r.id, wing: r.wing, room: r.room, kind: r.kind, content: r.content,
        metadata: JSON.parse(r.metadata_json) as Record<string, unknown>,
        parent_id: r.parent_id ?? undefined, redacted: r.redacted === 1,
        created_at: r.created_at,
      },
      score: -r.rank, // BM25 lower=better in sqlite; invert for descending
      snippet: r.snippet,
    }));
  }

  async listRooms(wing?: Wing): Promise<Room[]> {
    const db = this.requireDb();
    const sql = wing
      ? `SELECT DISTINCT room FROM drawers WHERE wing = ? ORDER BY room`
      : `SELECT DISTINCT room FROM drawers ORDER BY room`;
    const rows = wing ? db.prepare(sql).all(wing) : db.prepare(sql).all();
    return (rows as Array<{ room: string }>).map(r => r.room);
  }

  async listWings(): Promise<Wing[]> {
    const db = this.requireDb();
    const rows = db.prepare(`SELECT DISTINCT wing FROM drawers ORDER BY wing`).all() as Array<{ wing: string }>;
    return rows.map(r => r.wing);
  }

  async status(): Promise<BackendStatus> {
    const db = this.requireDb();
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM drawers`).get() as { c: number };
    const { user_version } = db.prepare(`PRAGMA user_version`).get() as { user_version: number };
    return {
      ready: true,
      workspace_wing: '',  // caller (memory-singleton) overlays this from scope info
      drawer_count: c,
      layer_b_db_path: this.path,
      schema_version: user_version,
    };
  }

  async clear(args: { wing?: Wing; confirm: true }): Promise<{ deleted: number }> {
    if (args.confirm !== true) throw new RecallQueryMalformed('confirm must be true');
    const db = this.requireDb();
    const stmt = args.wing
      ? db.prepare(`DELETE FROM drawers WHERE wing = ?`)
      : db.prepare(`DELETE FROM drawers`);
    const result = args.wing ? stmt.run(args.wing) : stmt.run();
    return { deleted: result.changes };
  }
}
