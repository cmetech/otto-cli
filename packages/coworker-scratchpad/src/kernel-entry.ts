import process, { argv, stdin, stdout } from 'node:process';
import vm from 'node:vm';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import type { DataSource, DataSourceRef } from '@otto/coworker-types';
import { DefaultCollectorRegistry } from './collector-registry.js';
import { FileCollector } from './file-collector.js';
import type {
  KernelEvent,
  KernelRequest,
  ResultResponse,
  SnapshotResult,
  RecoveryNote,
  SkippedKey,
  ArtifactCreateRequest,
  ArtifactCreateResponse,
  ArtifactUpdateRequest,
  ArtifactUpdateResponse,
  KernelRpcRequest,
} from './kernel-protocol.js';
import { isKernelRpcResponse } from './kernel-protocol.js';
import { buildDataLibBindings, attachRegisterDf } from './kernel-bindings.js';
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
  'XLSX',
  'dateFns',
  'lodash',
  'zod',
  'axios',
  'Date',
  // Phase 2 Task 13: process is bound so cells can read OTTO_DS_* env vars
  // injected by CredentialInjector. Filtered from namespace snapshots.
  'process',
  'Buffer',
]);

const registry = new DefaultCollectorRegistry();
registry.register(new FileCollector({ workspace }));

process.on('SIGINT', () => {
  // Ignored on purpose. A stray cancel between cells must not tear down a healthy
  // kernel; the parent escalates to SIGTERM/SIGKILL to actually stop a hung kernel.
});

function send(frame: KernelEvent | ResultResponse | SnapshotResult | KernelRpcRequest): void {
  if (trace) process.stderr.write(`[kernel→] ${JSON.stringify(frame)}\n`);
  void writeNdjson(stdout, frame);
}

// Phase 4 Task 9 — RPC plumbing for otto.artifact.
// The kernel sends `{type:'request',...}` frames over stdout and awaits the
// matching `{type:'response',...}` frame on stdin. The main loop routes
// response frames to this pending map before falling through to the
// existing run/snapshot request handling.
interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}
const pendingRpc = new Map<string, PendingRpc>();
let nextRpcId = 1;

function newRpcId(): string {
  return `art-${process.pid}-${nextRpcId++}`;
}

function rpcRequest<TResp>(payload: KernelRpcRequest): Promise<TResp> {
  return new Promise<TResp>((resolve, reject) => {
    pendingRpc.set(payload.id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    send(payload);
  });
}

// Returns true when the frame was consumed as an RPC response.
function tryRouteRpcResponse(frame: unknown): boolean {
  if (!isKernelRpcResponse(frame)) return false;
  const p = pendingRpc.get(frame.id);
  if (!p) return true; // unknown id — silently drop; nothing to do
  pendingRpc.delete(frame.id);
  if (frame.ok === false) p.reject(new Error(frame.error));
  else p.resolve(frame);
  return true;
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

// Phase 4 Task 9 — otto.artifact binding (RPC over stdio).
// `create` and `update` block the cell on a parent-side response; the manager
// handles the FS work and writes the artifact_create event back to memory.
interface ArtifactHandleProxy {
  slug: string;
  uri: string;
  primaryPath: string;
  update(files: Array<{ path: string; content: string }>): Promise<{ files_touched: string[] }>;
}

function makeArtifactProxy(args: { slug: string; uri: string; primaryPath: string }): ArtifactHandleProxy {
  return {
    slug: args.slug,
    uri: args.uri,
    primaryPath: args.primaryPath,
    async update(files): Promise<{ files_touched: string[] }> {
      const req: ArtifactUpdateRequest = {
        type: 'request',
        request: 'artifact_update',
        id: newRpcId(),
        slug: args.slug,
        files,
      };
      const resp = await rpcRequest<ArtifactUpdateResponse>(req);
      if (resp.ok === false) throw new Error(`artifact_update failed: ${resp.error}`);
      return { files_touched: resp.files_touched };
    },
  };
}

const ottoArtifact = {
  async create(kind: string, name: string): Promise<ArtifactHandleProxy> {
    if (kind !== 'report') {
      throw new Error(`unsupported artifact kind: ${kind}. v1 ships only 'report'.`);
    }
    const req: ArtifactCreateRequest = {
      type: 'request',
      request: 'artifact_create',
      id: newRpcId(),
      kind,
      name,
    };
    const resp = await rpcRequest<ArtifactCreateResponse>(req);
    if (resp.ok === false) throw new Error(`artifact_create failed: ${resp.error}`);
    // Broadcast artifact_create event so the manager can call recordArtifact
    // into memory (Phase 4 Task 12 closure: getMemoryRecorder()?.recordArtifact).
    // Without this, Layer B is silent for artifacts.
    send({
      type: 'event',
      event: 'artifact_create',
      drawer: {
        kind: 'artifact',
        slug: resp.slug,
        artifact_kind: kind,
        uri: resp.uri,
        primary_path: resp.primary_path,
        created_at: new Date().toISOString(),
      },
    });
    return makeArtifactProxy({
      slug: resp.slug,
      uri: resp.uri,
      primaryPath: resp.primary_path,
    });
  },

  async spillIfLarge(
    value: unknown,
    opts?: { thresholdBytes?: number; name?: string },
  ): Promise<ArtifactHandleProxy | null> {
    const threshold = opts?.thresholdBytes ?? 10_240;
    let serialized: string;
    try {
      serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
      serialized = String(value);
    }
    if (Buffer.byteLength(serialized, 'utf8') < threshold) return null;
    const name =
      opts?.name ??
      `cell-output-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;
    const handle = await ottoArtifact.create('report', name);
    await handle.update([{ path: 'report.md', content: serialized }]);
    return handle;
  },
};

const otto: Record<string, unknown> = { collectors: ottoCollectors, artifact: ottoArtifact };
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
  // Phase 2 Task 13: cells need process.env to read OTTO_DS_* vault-injected
  // env vars. Bind the host process directly; vm sandbox isolation otherwise
  // hides Node globals. Buffer is bound alongside since cells frequently
  // base64-encode credentials (e.g. Basic auth from env vars).
  process,
  Buffer,
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
    attachRegisterDf(instance);
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
  const nsPath = join(dir, 'namespace.json');
  const tmp = `${nsPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(envelope));
  renameSync(tmp, nsPath);
  return { skipped, snapshotted_at: envelope.ts };
}

async function main(): Promise<void> {
  const recoveryNotes: RecoveryNote[] = [];
  if (scratchpadDir !== undefined) {
    await openKernelDb(scratchpadDir);
    recoveryNotes.push(...restoreNamespace(scratchpadDir));
  }
  send({ type: 'event', event: 'ready', recovery_notes: recoveryNotes });

  try {
    for await (const raw of readNdjson(stdin)) {
      if (trace) process.stderr.write(`[kernel←] ${JSON.stringify(raw)}\n`);
      // Phase 4 Task 9 — route artifact RPC responses to the pending map before
      // falling through to the existing run/snapshot request dispatch.
      if (tryRouteRpcResponse(raw)) continue;
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
      // Phase 4 Task 10 fix — `runCell` may issue an artifact RPC and await its
      // response. The response arrives over stdin, which means the main loop
      // MUST keep iterating to route it via tryRouteRpcResponse. Awaiting
      // runCell inline would deadlock the kernel against its own RPC. Fire it
      // off; runCell sends its own result frame. The manager already serializes
      // cell submissions, so there's no concurrency to worry about.
      void (async (): Promise<void> => {
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
      })();
    }
  } finally {
    // Phase 4 Task 9 review fix — if stdin closes (manager died / EOF) while
    // RPCs are still in flight, reject them so awaiting cells fail fast
    // instead of hanging until SIGKILL.
    for (const [, p] of pendingRpc) {
      p.reject(new Error('kernel: stdin closed with pending RPC'));
    }
    pendingRpc.clear();
  }
}

void main();
