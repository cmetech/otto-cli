import type { DataKind } from '@otto/coworker-types';

const EXT_TO_KIND: Record<string, DataKind> = {
  '.csv': 'csv',
  '.xlsx': 'xlsx',
  '.json': 'json',
  '.parquet': 'parquet',
  '.txt': 'txt',
  '.md': 'md',
};

// The six file kinds FileCollector enumerates. (DataKind also includes
// rest/mcp-resource/acp-stream, which belong to future non-file collectors.)
export const FILE_COLLECTOR_KINDS: readonly DataKind[] = ['csv', 'xlsx', 'json', 'parquet', 'txt', 'md'];

export function detectKind(pathOrUri: string): DataKind | null {
  const clean = pathOrUri.split('?')[0].split('#')[0];
  const dot = clean.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = clean.slice(dot).toLowerCase();
  return EXT_TO_KIND[ext] ?? null;
}
