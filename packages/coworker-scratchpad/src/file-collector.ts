import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { watch as chokidarWatch } from 'chokidar';
import type {
  Collector,
  CollectorCapabilities,
  DataSource,
  DataSourceRef,
  ListOpts,
  Unsubscribe,
} from '@otto/coworker-types';
import { detectKind, FILE_COLLECTOR_KINDS } from './detect-kind.js';

const TEXT_KINDS = new Set(['csv', 'txt', 'md']);

export interface FileCollectorOptions {
  /** Absolute path to the workspace root. inputs/ resolves to <workspace>/.otto/inputs. */
  workspace: string;
}

export class FileCollector implements Collector {
  readonly id = 'file';
  readonly kind = 'file' as const;
  private readonly inputsDir: string;

  constructor(opts: FileCollectorOptions) {
    this.inputsDir = join(opts.workspace, '.otto', 'inputs');
  }

  describe(): CollectorCapabilities {
    return {
      supports_uris: ['file://*'],
      supports_kinds: [...FILE_COLLECTOR_KINDS],
      supports_streaming: false,
      supports_watching: true,
    };
  }

  async *list(opts?: ListOpts): AsyncIterable<DataSourceRef> {
    let remaining = opts?.limit ?? Number.POSITIVE_INFINITY;
    if (remaining <= 0) return;
    const prefixDir = opts?.prefix ? join(this.inputsDir, opts.prefix) : this.inputsDir;
    for await (const abs of walk(this.inputsDir)) {
      if (opts?.prefix && !abs.startsWith(prefixDir)) continue;
      const kind = detectKind(abs);
      if (!kind) continue;
      const st = await stat(abs);
      yield {
        collector: this.id,
        uri: pathToFileURL(abs).href,
        kind,
        bytes: st.size,
        modified: st.mtime.toISOString(),
        metadata: {},
      };
      remaining -= 1;
      if (remaining <= 0) return;
    }
  }

  async open(ref: DataSourceRef): Promise<DataSource> {
    const abs = fileURLToPath(ref.uri);
    const kind = ref.kind;
    return {
      ref,
      async load(): Promise<Buffer | string | object> {
        if (kind === 'json') {
          return JSON.parse(await readFile(abs, 'utf8')) as object;
        }
        if (TEXT_KINDS.has(kind)) {
          return readFile(abs, 'utf8');
        }
        return readFile(abs); // Buffer for xlsx/parquet
      },
    };
  }

  watch(ref: DataSourceRef, onChange: (ref: DataSourceRef) => void): Unsubscribe {
    const abs = fileURLToPath(ref.uri);
    const watcher = chokidarWatch(abs, { ignoreInitial: true });
    const handler = async (): Promise<void> => {
      try {
        const st = await stat(abs);
        onChange({ ...ref, bytes: st.size, modified: st.mtime.toISOString() });
      } catch {
        onChange(ref);
      }
    };
    watcher.on('change', () => void handler());
    watcher.on('add', () => void handler());
    return () => {
      void watcher.close();
    };
  }
}

async function* walk(dir: string): AsyncIterable<string> {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // inputs/ may not exist yet — yield nothing
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
