import { serialize, deserialize } from 'node:v8';

export const NAMESPACE_SCHEMA_VERSION = 1;

export interface SkippedKey {
  key: string;
  ctor: string | null;
  reason: string;
}

export interface NamespaceEnvelope {
  schema_version: number;
  snapshot_b64: string;
  skipped: SkippedKey[];
  ts: string;
}

export interface EncodeResult {
  envelope: NamespaceEnvelope;
  skipped: SkippedKey[];
}

export interface DecodeResult {
  values: Record<string, unknown>;
  skipped: SkippedKey[];
}

function ctorName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const c = (value as { constructor?: { name?: string } }).constructor;
  return c?.name ?? null;
}

export function encodeNamespace(
  values: Record<string, unknown>,
  now: () => number,
): EncodeResult {
  const survivors: Record<string, unknown> = {};
  const skipped: SkippedKey[] = [];
  for (const key of Object.keys(values)) {
    const value = values[key];
    try {
      // Probe by serializing a single-key wrapper. Cheaper than per-key buffers
      // because the survivors map is re-serialized once below.
      serialize({ [key]: value });
      survivors[key] = value;
    } catch (err) {
      skipped.push({
        key,
        ctor: ctorName(value),
        reason: (err as Error).message,
      });
    }
  }
  let snapshot_b64: string;
  try {
    snapshot_b64 = serialize(survivors).toString('base64');
  } catch (err) {
    // A value passed the per-key probe but threw on bulk serialize (e.g. a getter
    // that throws on its second invocation). Demote every survivor to skipped so
    // the caller still gets a usable envelope; the snapshot for this round is empty.
    const reason = `bulk-serialize-failed: ${(err as Error).message}`;
    for (const key of Object.keys(survivors)) {
      skipped.push({ key, ctor: ctorName(survivors[key]), reason });
    }
    snapshot_b64 = serialize({}).toString('base64');
  }
  const envelope: NamespaceEnvelope = {
    schema_version: NAMESPACE_SCHEMA_VERSION,
    snapshot_b64,
    skipped,
    ts: new Date(now()).toISOString(),
  };
  return { envelope, skipped };
}

export function decodeNamespace(json: string): DecodeResult {
  const parsed = JSON.parse(json) as Partial<NamespaceEnvelope>;
  if (parsed.schema_version !== NAMESPACE_SCHEMA_VERSION) {
    throw new Error(
      `namespace-codec: unsupported schema_version ${String(parsed.schema_version)} (expected ${NAMESPACE_SCHEMA_VERSION})`,
    );
  }
  if (typeof parsed.snapshot_b64 !== 'string') {
    throw new Error('namespace-codec: missing snapshot_b64');
  }
  const buf = Buffer.from(parsed.snapshot_b64, 'base64');
  const values = deserialize(buf) as Record<string, unknown>;
  return { values, skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [] };
}
