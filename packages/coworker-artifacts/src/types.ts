// packages/coworker-artifacts/src/types.ts
export type ArtifactKind = 'report';
export const ARTIFACT_KINDS = ['report'] as const;

export interface ArtifactHandle {
  slug: string;
  kind: ArtifactKind;
  name: string;
  dir: string;
  uri: string;
  primaryPath: string;
  metadataPath: string;
  provenancePath: string;
  readmePath: string;
}

export interface ArtifactMetadata {
  _schema: 1;
  slug: string;
  kind: ArtifactKind;
  name: string;
  created_at: string;
  last_updated_at: string;
  turn_count: number;
  primary_file: string;
  uri: string;
}

export interface TurnEntry {
  _schema: 1;
  ts: string;
  action: 'create' | 'update';
  turn_id: string;
  agent_turn_id?: string;
  user_prompt: string;
  scratchpad_name?: string;
  files_touched: string[];
}

export type Provenance = TurnEntry[];

export interface DirSnapshotEntry {
  mtimeNs: bigint;
  sizeBytes: number;
}

export type DirSnapshot = Map<string, DirSnapshotEntry>;

export interface FileWrite {
  path: string;
  content: string;
}

export interface ResolvedArtifactUri {
  slug: string;
  dir: string;
  primaryPath: string;
  metadataPath: string;
  provenancePath: string;
  readmePath: string;
}
