// Artifact-store types. See spec §2.3.

export type ArtifactKind = 'report' | 'workbook' | 'dataset';

export interface ArtifactHandle {
  slug: string;
  kind: ArtifactKind;
  base_path: string;
  created_at: string;
}

export interface FileWrite {
  path: string;          // relative to artifact base_path
  content: string | Uint8Array;
}

export interface TurnEntry {
  turn_id: string;
  timestamp: string;
  prompt_excerpt: string;       // truncated to 240 chars
  files_touched: string[];      // sorted, deduped, relative paths
}

export interface ProvenanceEntry {
  session_id: string;
  turns: TurnEntry[];
}

export interface ArtifactStore {
  create(kind: ArtifactKind, name: string): Promise<ArtifactHandle>;
  update(handle: ArtifactHandle, files: FileWrite[]): Promise<void>;
  recordTurn(handle: ArtifactHandle, turn: { turn_id: string; prompt: string }): Promise<void>;
  get(slug: string): Promise<ArtifactHandle | null>;
  list(): Promise<ArtifactHandle[]>;
}
