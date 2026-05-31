// Scratchpad/collector types. See spec §2.4 collector facade.

export type DataKind =
  | 'csv' | 'xlsx' | 'json' | 'parquet' | 'txt' | 'md'
  | 'rest' | 'mcp-resource' | 'acp-stream';

export interface DataSourceRef {
  collector: string;
  uri: string;
  kind: DataKind;
  bytes?: number;
  modified?: string;
  metadata: Record<string, unknown>;
}

export interface DataSource {
  ref: DataSourceRef;
  load(): Promise<Buffer | string | object>;
  stream?(): AsyncIterable<Buffer>;
}

export interface CollectorCapabilities {
  supports_uris: string[];          // wildcard patterns: 'file://*', 'servicenow://*'
  supports_kinds: DataKind[];
  supports_streaming: boolean;
  supports_watching: boolean;
}

export interface ListOpts {
  workspace?: string;
  prefix?: string;
  limit?: number;
}

export type Unsubscribe = () => void;

export interface Collector {
  readonly id: string;
  readonly kind: 'file' | 'api' | 'protocol';
  describe(): CollectorCapabilities;
  list(opts?: ListOpts): AsyncIterable<DataSourceRef>;
  open(ref: DataSourceRef): Promise<DataSource>;
  watch?(ref: DataSourceRef, onChange: (ref: DataSourceRef) => void): Unsubscribe;
}

export interface CollectorRegistry {
  register(collector: Collector): void;
  list(): Collector[];
  get(id: string): Collector | null;
  resolve(uri: string): Promise<{ collector: Collector; ref: DataSourceRef } | null>;
}
