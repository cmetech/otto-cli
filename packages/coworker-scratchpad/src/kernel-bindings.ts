import pl from 'nodejs-polars';
import ExcelJS from 'exceljs';
import lodash from 'lodash';
import axios from 'axios';
import { z } from 'zod';
import * as dateFns from 'date-fns';
import * as DuckDB from '@duckdb/node-api';
import type { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';

/**
 * The data libraries pre-bound into every scratchpad cell's vm sandbox.
 * DuckDB is bound as an in-memory-capable lib here; on-disk kernel.db wiring is 1d2.
 */
export function buildDataLibBindings(): Record<string, unknown> {
  return {
    polars: pl,
    DuckDB,
    ExcelJS,
    dateFns,
    lodash,
    zod: z,
    axios,
  };
}

// ---------------------------------------------------------------------------
// Task F: otto.duckdb.registerDf — single-call polars/Arrow/records → DuckDB
// ---------------------------------------------------------------------------

/** SQL column type string passed straight into CREATE TABLE (e.g. VARCHAR, BIGINT). */
export type DuckDBColumnType = string;

export interface RegisterDfOptions {
  /**
   * Explicit per-column SQL types. When omitted, the schema is inferred from
   * the first non-null value of each column in the first 10 rows.
   */
  schema?: Record<string, DuckDBColumnType> | Array<[string, DuckDBColumnType]>;
}

interface PolarsDataFrameShape {
  toRecords: () => Record<string, unknown>[];
  width: number;
  height: number;
}

interface ArrowTableShape {
  toArray: () => Record<string, unknown>[];
  numRows: number;
  schema: unknown;
}

function isPolarsDataFrame(x: unknown): x is PolarsDataFrameShape {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as { toRecords?: unknown }).toRecords === 'function' &&
    typeof (x as { width?: unknown }).width === 'number' &&
    typeof (x as { height?: unknown }).height === 'number'
  );
}

function isArrowTable(x: unknown): x is ArrowTableShape {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as { toArray?: unknown }).toArray === 'function' &&
    typeof (x as { numRows?: unknown }).numRows === 'number' &&
    'schema' in (x as object)
  );
}

function coerceToRecords(input: unknown): Record<string, unknown>[] {
  if (isPolarsDataFrame(input)) return input.toRecords();
  if (isArrowTable(input)) return input.toArray();
  if (Array.isArray(input)) return input as Record<string, unknown>[];
  throw new TypeError(
    'registerDf: input must be a polars DataFrame, Arrow Table, or array of records',
  );
}

function inferSchema(records: Record<string, unknown>[]): Record<string, DuckDBColumnType> {
  if (records.length === 0) {
    throw new Error(
      'registerDf: cannot infer schema from empty input. Provide opts.schema or pass at least one row.',
    );
  }
  const cols = Object.keys(records[0]!);
  const out: Record<string, DuckDBColumnType> = {};
  for (const col of cols) {
    // Null-walk: scan up to the first 10 rows for the first non-null value of this column.
    // Defaults to VARCHAR for all-null columns (safe — DuckDB will accept NULL into a VARCHAR).
    out[col] = 'VARCHAR';
    const walk = Math.min(10, records.length);
    for (let i = 0; i < walk; i++) {
      const v = records[i]![col];
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') { out[col] = 'VARCHAR'; break; }
      if (typeof v === 'bigint') { out[col] = 'BIGINT'; break; }
      if (typeof v === 'number') { out[col] = 'DOUBLE'; break; }
      if (typeof v === 'boolean') { out[col] = 'BOOLEAN'; break; }
      if (v instanceof Date) { out[col] = 'TIMESTAMP'; break; }
      out[col] = 'VARCHAR'; // unknown object → store as VARCHAR
      break;
    }
  }
  return out;
}

function normalizeSchema(
  schema: Record<string, DuckDBColumnType> | Array<[string, DuckDBColumnType]>,
): Array<[string, DuckDBColumnType]> {
  if (Array.isArray(schema)) return schema;
  return Object.entries(schema);
}

function quoteIdent(name: string): string {
  // DuckDB identifier quoting: wrap in double quotes, escape embedded double quotes.
  return `"${name.replace(/"/g, '""')}"`;
}

async function registerViaAppender(
  conn: DuckDBConnection,
  name: string,
  records: Record<string, unknown>[],
  schema: Array<[string, DuckDBColumnType]>,
  sourceHint: 'inferred' | 'explicit',
): Promise<void> {
  const ddl = `CREATE TABLE ${quoteIdent(name)} (${schema
    .map(([c, t]) => `${quoteIdent(c)} ${t}`)
    .join(', ')})`;
  await conn.run(ddl);
  // All-or-nothing semantic: on any failure we drop the table so the caller
  // can retry the same name without hitting "Table already exists." On the
  // success path we flip this flag and the finally becomes a no-op.
  let createdTable = true;
  const app = await conn.createAppender(name);
  try {
    for (let i = 0; i < records.length; i++) {
      let failingColIdx = -1;
      try {
        for (let colIdx = 0; colIdx < schema.length; colIdx++) {
          failingColIdx = colIdx;
          const col = schema[colIdx]![0];
          const v = records[i]![col];
          if (v === null || v === undefined) {
            app.appendNull();
          } else {
            // appendValue accepts DuckDBValue (null | boolean | number | bigint | string | ...)
            // and lets the engine coerce based on the declared column type.
            app.appendValue(v as never);
          }
        }
        // endRow() may itself reject the row on a type mismatch detected at
        // end-of-row; in that case we can't attribute to a single column so
        // we fall back to '<column>' literally rather than blame col 0.
        failingColIdx = -1;
        app.endRow();
      } catch (e) {
        const failingCol =
          failingColIdx >= 0 ? schema[failingColIdx]![0] : '<column>';
        const hint =
          sourceHint === 'inferred'
            ? ` Pass an explicit schema via the third argument: registerDf(name, df, { schema: { ${failingCol}: 'VARCHAR' } })`
            : '';
        throw new Error(
          `registerDf row ${i}: append failed for column '${failingCol}' (${(e as Error).message}).${hint}`,
        );
      }
    }
    // Success path: close the appender to commit the rows, then disarm cleanup.
    app.closeSync();
    createdTable = false;
  } finally {
    if (createdTable) {
      // Failure path: close the appender (may already be closed; best-effort)
      // then drop the partially-populated table.
      try { app.closeSync(); } catch { /* already closed or errored */ }
      try { await conn.run(`DROP TABLE IF EXISTS ${quoteIdent(name)}`); } catch { /* best-effort */ }
    }
  }
}

/**
 * Patches a DuckDBInstance with a `registerDf(name, input, opts?)` method
 * so the LLM can drop a polars DataFrame / Arrow Table / array of records
 * into DuckDB in one call instead of discovering the appender API.
 *
 * The method opens a fresh connection on each call (cheap — DuckDB connections
 * share the underlying instance/db) and CREATE-TABLE-then-appends.
 */
export function attachRegisterDf(instance: DuckDBInstance): void {
  const patched = instance as unknown as {
    registerDf: (
      name: string,
      input: unknown,
      opts?: RegisterDfOptions,
    ) => Promise<void>;
  };
  patched.registerDf = async function registerDf(
    name: string,
    input: unknown,
    opts: RegisterDfOptions = {},
  ): Promise<void> {
    const conn = await instance.connect();
    try {
      const records = coerceToRecords(input);
      const sourceHint: 'inferred' | 'explicit' = opts.schema ? 'explicit' : 'inferred';
      const schemaObj = opts.schema ?? inferSchema(records);
      const schema = normalizeSchema(schemaObj);
      await registerViaAppender(conn, name, records, schema, sourceHint);
    } finally {
      // Release the connection — DuckDBConnection exposes closeSync(): void.
      // Without this, every registerDf call leaks one connection over the
      // lifetime of the scratchpad session.
      conn.closeSync();
    }
  };
}
