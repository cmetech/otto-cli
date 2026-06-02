// packages/coworker-vault/src/types.ts
export interface EntryRef {
  engine: string;
  name: string;
}

export interface EngineField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  default?: string;
}

export interface EngineDefinition {
  schema_version: 1;
  id: string;
  label: string;
  description?: string;
  fields: EngineField[];
}

export interface VaultEntry {
  _schema: 1;
  engine: string;
  name: string;
  fields: Record<string, string>;
  created_at: string;
  last_modified_at: string;
}

export type EngineSource = 'builtin' | 'user' | 'workspace';
export type VaultScope = 'global' | 'workspace';
