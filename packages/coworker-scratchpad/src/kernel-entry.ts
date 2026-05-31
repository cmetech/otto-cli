import process, { argv, stdin, stdout } from 'node:process';
import vm from 'node:vm';
import { writeNdjson, readNdjson } from '@otto/coworker-utils';
import type { DataSource, DataSourceRef } from '@otto/coworker-types';
import { DefaultCollectorRegistry } from './collector-registry.js';
import { FileCollector } from './file-collector.js';
import type { KernelEvent, KernelRequest, ResultResponse } from './kernel-protocol.js';
import { buildDataLibBindings } from './kernel-bindings.js';

const workspace = argv[2] ?? process.cwd();
const trace = process.env.OTTO_SCRATCHPAD_IPC_TRACE === '1';

const registry = new DefaultCollectorRegistry();
registry.register(new FileCollector({ workspace }));

process.on('SIGINT', () => {
  // Ignored on purpose. A stray cancel between cells must not tear down a healthy
  // kernel; the parent escalates to SIGTERM/SIGKILL to actually stop a hung kernel.
});

function send(frame: KernelEvent | ResultResponse): void {
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

const sandbox: Record<string, unknown> = {
  otto: { collectors: ottoCollectors },
  ...buildDataLibBindings(),
  // Timers are not part of a fresh vm context; bind the host ones so async cells
  // (await new Promise((r) => setTimeout(r, ...))) and progress() heartbeats work.
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
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

async function main(): Promise<void> {
  send({ type: 'event', event: 'ready' });
  for await (const raw of readNdjson(stdin)) {
    if (trace) process.stderr.write(`[kernel←] ${JSON.stringify(raw)}\n`);
    const req = raw as KernelRequest;
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
