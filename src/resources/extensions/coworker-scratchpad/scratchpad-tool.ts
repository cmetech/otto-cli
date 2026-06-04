import { join } from 'node:path';
import { StringEnum } from '@otto/pi-ai';
import type { ExtensionAPI } from '@otto/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import type { ScratchpadManager, CellEntry } from '@otto/coworker-scratchpad';
import { validateName, readCellsJsonl } from './helpers.js';
import { deriveMimeBundle, type MimeBundle } from './mime-bundle.js';

export interface ScratchpadToolDeps {
  getManager: () => ScratchpadManager;
  getCurrentName: () => string | null;
  setCurrentName: (name: string | null) => void;
  rootDir: () => string;
}

const VIEW_DEFAULT_TAIL = 5;
const VIEW_MAX_TAIL = 20;
const VALUE_TRUNCATE = 200;
const STDOUT_TRUNCATE = 500;

interface ExecResultOk {
  ok: true;
  cell_id: number;
  total_cells: number;
  mime: MimeBundle;
}
interface ExecResultErr {
  ok: false;
  cell_id: number;
  total_cells: number;
  error: { name: string; message: string };
}
type ExecResult = ExecResultOk | ExecResultErr;

interface ViewCell {
  id: number;
  parentId: number | null;
  ts: string;
  code: string;
  ok: boolean;
  value?: unknown;
  error?: { name: string; message: string };
  stdout: string;
}
interface ViewResult {
  name: string;
  cells: ViewCell[];
  total_cells: number;
}

function ensureCurrent(deps: ScratchpadToolDeps): string {
  let current = deps.getCurrentName();
  if (!current) {
    current = 'default';
    deps.setCurrentName(current);
  }
  return current;
}

function resolveName(deps: ScratchpadToolDeps, explicit?: string): string {
  if (explicit) {
    validateName(explicit);
    return explicit;
  }
  return ensureCurrent(deps);
}

function truncateValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > VALUE_TRUNCATE) {
    return value.slice(0, VALUE_TRUNCATE);
  }
  return value;
}

function projectViewCell(c: CellEntry): ViewCell {
  return {
    id: c.id,
    parentId: c.parentId,
    ts: c.ts,
    code: c.code,
    ok: c.ok,
    value: c.ok ? truncateValue(c.value) : undefined,
    error: c.ok ? undefined : c.error,
    stdout: (c.stdout ?? '').slice(0, STDOUT_TRUNCATE),
  };
}

export function registerScratchpadTool(pi: ExtensionAPI, deps: ScratchpadToolDeps): void {
  pi.registerTool({
    name: 'cw_scratchpad',
    label: 'Co-worker scratchpad',
    description:
      'USE FOR: loading or analyzing files (CSV, JSON, Parquet, XLSX), tabular data manipulation with polars or DuckDB, multi-step data exploration where state should persist across turns, or anything that calls otto.collectors. ' +
      'DO NOT USE FOR: simple arithmetic, lookups answerable from reasoning alone, pure prose, code review, or one-off calculations with no file or data source involved. ' +
      'IF the user explicitly names this tool ("use cw_scratchpad", "run this in the scratchpad", "exec a cell"), use it regardless of the rules above. ' +
      'IF UNSURE whether a request belongs here, ASK the user once: "Do you want me to run this in cw_scratchpad so you can inspect the cells via /sp view, or answer inline?" Wait for their reply before deciding. ' +
      'Runs TypeScript cells in a persistent JS kernel scoped to a named scratchpad. State persists across cells via globalThis.* and across Otto sessions via on-disk kernel.db + namespace.json. ' +
      'Pre-bound libs in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios. otto.collectors.{list,open} enumerates and loads data sources. ' +
      'Actions: exec (run a TypeScript cell), view (return the last N cells). ' +
      'Distinct from the analyst extension\'s SQL-only `scratchpad` tool — this one runs arbitrary TypeScript.',
    promptSnippet:
      'cw_scratchpad — run TypeScript cells in a persistent JS kernel. USE for files (CSV/JSON/Parquet/XLSX), polars/DuckDB analysis, otto.collectors, or multi-step data work. NOT for arithmetic or pure prose. If unsure, ASK the user first.',
    promptGuidelines: [
      'Trigger criteria: the request involves loading a file (CSV/JSON/Parquet/XLSX/etc.), querying tabular data via polars or DuckDB, calling otto.collectors, or building state that must survive across turns.',
      'Skip the tool for: trivial arithmetic, lookups you can answer from reasoning, prose generation, code review, and pure-explanation tasks.',
      'If the user names the tool explicitly (e.g. "use cw_scratchpad", "in the scratchpad", "exec a cell"), always honor that request and skip the unsure-prompt.',
      'IF UNSURE whether a request fits the trigger criteria, ask the user once before deciding: "Do you want me to run this in cw_scratchpad (you can inspect the cells via /sp view) or answer inline?" Wait for the user\'s reply before either calling the tool or answering inline.',
      'Use action="exec" to run TypeScript code in the current scratchpad. State persists across calls.',
      'The cell body is wrapped in (async () => { ... })(). let/const/var are local to the cell. To persist, assign to globalThis.foo = ...',
      'For DuckDB tables that survive across Otto sessions, use `await otto.duckdb.connect()`. For ephemeral in-memory, use `DuckDB.DuckDBInstance.create(":memory:")`.',
      'For polars→DuckDB: prefer `otto.duckdb.registerDf(name, df)` over manual API discovery. If inference picks the wrong column type, pass `{ schema: { col: \'TYPE\' } }` as the third argument. Falls back to polars\' own SQL (`df.sql(...)`) for one-off aggregations.',
      'Pre-bound libs available in every cell: polars, DuckDB, XLSX, dateFns, lodash, zod, axios. No imports needed.',
      'Use otto.collectors.list() to discover data sources and otto.collectors.open(uri) to load one.',
      'The `name` parameter defaults to the currently attached scratchpad. Omit it unless you want to operate on a different one (this does NOT switch the user attachment).',
      'A returned string that looks markdown-shaped will appear in the response as text/markdown automatically. Return a markdown table or heading to render it.',
      'Use action="view" to see the last 5 cells (default). Pass tail=20 or from_id to see more.',
      'A failed cell IS recorded; the next view call will show it. Use this to recover.',
      'Default cell timeout is 120s. Long operations should call progress("status") periodically to reset the inactivity timer.',
    ],
    parameters: Type.Object({
      action: StringEnum(['exec', 'view'] as const),
      name: Type.Optional(Type.String({ description: "Scratchpad name; defaults to the current session attachment, auto-creating 'default' if none." })),
      code: Type.Optional(Type.String({ description: "TypeScript cell code (action='exec' only)." })),
      tail: Type.Optional(Type.Number({ description: `How many trailing cells to return (action='view' only). Default ${VIEW_DEFAULT_TAIL}, max ${VIEW_MAX_TAIL}.` })),
      from_id: Type.Optional(Type.Number({ description: "If set, view returns cells with id >= from_id (overrides tail)." })),
    }),
    async execute(_toolCallId: string, params: { action: 'exec' | 'view'; name?: string; code?: string; tail?: number; from_id?: number }, _signal: AbortSignal | undefined, _onUpdate: unknown, _ctx: unknown): Promise<{ content: { type: 'text'; text: string }[]; details: ExecResult | ViewResult }> {
      const name = resolveName(deps, params.name);

      let result: ExecResult | ViewResult;

      if (params.action === 'exec') {
        if (!params.code) {
          throw new Error('code is required for action="exec"');
        }
        const mgr = deps.getManager();
        try {
          const { value, stdout } = await mgr.runCell(name, params.code);
          const { total_cells } = readCellsJsonl(join(deps.rootDir(), name));
          result = { ok: true, cell_id: total_cells, total_cells, mime: deriveMimeBundle(value, stdout) };
        } catch (err) {
          const e = err as Error;
          const { total_cells } = readCellsJsonl(join(deps.rootDir(), name));
          result = { ok: false, cell_id: total_cells, total_cells, error: { name: e.name, message: e.message } };
        }
      } else {
        // view
        const { cells, total_cells } = readCellsJsonl(join(deps.rootDir(), name));
        let selected: CellEntry[];
        if (typeof params.from_id === 'number') {
          selected = cells.filter((c) => c.id >= params.from_id!);
        } else {
          const tail = Math.min(params.tail ?? VIEW_DEFAULT_TAIL, VIEW_MAX_TAIL);
          selected = cells.slice(-tail);
        }
        result = { name, cells: selected.map(projectViewCell), total_cells };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
