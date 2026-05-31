import process, { argv, stdin, stdout } from 'node:process';
import vm from 'node:vm';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import type { DataSource, DataSourceRef } from '@otto/coworker-types';
import { DefaultCollectorRegistry } from './collector-registry.js';
import { FileCollector } from './file-collector.js';
import type { KernelEvent, KernelRequest, ResultResponse, SnapshotResult, RecoveryNote, SkippedKey } from './kernel-protocol.js';
import { buildDataLibBindings } from './kernel-bindings.js';
import { encodeNamespace, decodeNamespace } from './namespace-codec.js';

const workspace = argv[2] ?? process.cwd();
const scratchpadDir: string | undefined = argv[3];
const trace = process.env.OTTO_SCRATCHPAD_IPC_TRACE === '1';

const KNOWN_BOUND_KEYS = new Set([
  'otto',
  'console',
  'progress',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'polars',
  'DuckDB',
  'ExcelJS',
  'dateFns',
  'lodash',
  'zod',
  'axios',
  'Date',
]);

const registry = new DefaultCollectorRegistry();
registry.register(new FileCollector({ workspace }));

process.on('SIGINT', () => {
  // Ignored on purpose. A stray cancel between cells must not tear down a healthy
  // kernel; the parent escalates to SIGTERM/SIGKILL to actually stop a hung kernel.
});

function send(frame: KernelEvent | ResultResponse | SnapshotResult): void {
  if (trace) process.stderr.write(`[kernel→] ${JSON.stringify(frame)}\n`);
  void writeNdjson(stdout, frame);
}

const ottoCollectors = {
  async list(): Promise<DataSourceRef[]> {
    const refs: DataSourceRef[] = [];
    for (const collector of registry.list()) {
      for await (const ref of collector.list()) refs.push(ref);
    }
    return refs;
  },
  async open(uri: string): Promise<DataSource> {
    const hit = await registry.resolve(uri);
    if (!hit) throw new Error(`no collector resolves uri: ${uri}`);
    const source = await hit.collector.open(hit.ref);
    return {
      ref: source.ref,
      async load(): Promise<Buffer | string | object> {
        const value = await source.load();
        send({
          type: 'event',
          event: 'data_load',
          drawer: {
            kind: 'data_load',
            collector: source.ref.collector,
            uri: source.ref.uri,
            bytes: source.ref.bytes ?? null,
            rows_loaded: Array.isArray(value) ? value.length : null,
            loaded_at: new Date().toISOString(),
            schema: null,
          },
        });
        return value;
      },
    };
  },
};

const otto: Record<string, unknown> = { collectors: ottoCollectors };
const sandbox: Record<string, unknown> = {
  otto,
  ...buildDataLibBindings(),
  // Timers are not part of a fresh vm context; bind the host ones so async cells
  // (await new Promise((r) => setTimeout(r, ...))) and progress() heartbeats work.
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  // Bind the host Date so that v8-deserialized Date objects (from namespace restore)
  // pass `instanceof Date` checks inside the vm context (cross-realm fix).
  Date,
};
const context = vm.createContext(sandbox);

async function runCell(code: string): Promise<{ value: unknown; stdout: string }> {
  const logs: string[] = [];
  sandbox.console = {
    log: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(' ')),
    error: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(' ')),
  };
  sandbox.progress = (message?: unknown): void => {
    send({
      type: 'event',
      event: 'progress',
      message: message === undefined ? undefined : String(message),
    });
  };
  const wrapped = `(async () => {\n${code}\n})()`;
  const value: unknown = await vm.runInContext(wrapped, context, { filename: 'cell.js' });
  return { value, stdout: logs.join('\n') };
}

function toSerializable(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? null));
  } catch {
    return { valuePreview: String(value) };
  }
}

async function openKernelDb(dir: string): Promise<void> {
  try {
    const instance = await DuckDBInstance.create(join(dir, 'kernel.db'));
    otto.duckdb = instance;
  } catch (err) {
    const e = err as Error;
    await writeNdjson(stdout, {
      type: 'event',
      event: 'startup_error',
      kind: 'duckdb_open',
      error: { name: e.name, message: e.message },
    });
    process.exit(1);
  }
}

function restoreNamespace(dir: string): RecoveryNote[] {
  const path = join(dir, 'namespace.json');
  if (!existsSync(path)) return [{ kind: 'namespace-absent' }];
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return [{ kind: 'namespace-corrupt', message: (err as Error).message }];
  }
  try {
    const { values } = decodeNamespace(raw);
    for (const key of Object.keys(values)) {
      if (KNOWN_BOUND_KEYS.has(key)) continue; // never let a tampered namespace.json overwrite host bindings
      sandbox[key] = values[key];
    }
    return [];
  } catch (err) {
    return [{ kind: 'namespace-corrupt', message: (err as Error).message }];
  }
}

function writeNamespaceSnapshot(dir: string): { skipped: SkippedKey[]; snapshotted_at: string } {
  // Enumerate live globalThis additions, excluding the known-bound surface.
  const live: Record<string, unknown> = {};
  for (const key of Object.keys(sandbox)) {
    if (KNOWN_BOUND_KEYS.has(key)) continue;
    live[key] = sandbox[key];
  }
  const { envelope, skipped } = encodeNamespace(live, () => Date.now());
  writeFileSync(join(dir, 'namespace.json'), JSON.stringify(envelope));
  return { skipped, snapshotted_at: envelope.ts };
}

async function main(): Promise<void> {
  const recoveryNotes: RecoveryNote[] = [];
  if (scratchpadDir !== undefined) {
    await openKernelDb(scratchpadDir);
    recoveryNotes.push(...restoreNamespace(scratchpadDir));
  }
  send({ type: 'event', event: 'ready', recovery_notes: recoveryNotes });

  for await (const raw of readNdjson(stdin)) {
    if (trace) process.stderr.write(`[kernel←] ${JSON.stringify(raw)}\n`);
    const req = raw as KernelRequest;
    if (req.type === 'snapshot') {
      if (scratchpadDir === undefined) {
        send({ id: req.id, type: 'snapshot_result', ok: true, skipped: [], snapshotted_at: new Date().toISOString() });
        continue;
      }
      try {
        const { skipped, snapshotted_at } = writeNamespaceSnapshot(scratchpadDir);
        send({ id: req.id, type: 'snapshot_result', ok: true, skipped, snapshotted_at });
      } catch (err) {
        const e = err as Error;
        send({ id: req.id, type: 'snapshot_result', ok: false, error: { name: e.name, message: e.message } });
      }
      continue;
    }
    if (req.type !== 'run') continue;
    let res: ResultResponse;
    try {
      const { value, stdout: out } = await runCell(req.code);
      res = { id: req.id, type: 'result', ok: true, value: toSerializable(value), stdout: out };
    } catch (err) {
      const e = err as Error;
      res = {
        id: req.id,
        type: 'result',
        ok: false,
        error: { name: e.name, message: e.message, stack: e.stack },
      };
    }
    send(res);
  }
}

void main();
