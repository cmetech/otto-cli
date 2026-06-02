// packages/coworker-memory/src/types.ts
export type Wing = string;
export type Room = string;

export const DRAWER_KINDS = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note', 'artifact'] as const;
export type DrawerKind = typeof DRAWER_KINDS[number];

export const LAYER_A_KINDS = ['profile', 'rule', 'lesson'] as const;
export type LayerAKind = typeof LAYER_A_KINDS[number];

export type ScopeMode = 'global' | 'per-project' | 'per-project-tagged';

export interface Drawer {
  id: string;
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  parent_id?: string;
  redacted: boolean;
}

export interface RecallQuery {
  query: string;
  wing?: Wing | Wing[];
  room?: Room;
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;
}

export interface RecallResult {
  drawer: Drawer;
  score: number;
  snippet: string;
}

export interface BackendStatus {
  ready: boolean;
  workspace_wing: Wing;
  drawer_count: number;
  layer_b_db_path: string;
  schema_version: number;
}

export interface LayerAEntry {
  kind: LayerAKind;
  text: string;
  source: 'user' | 'persona-seed';
  ts: string;
}

export interface WorkspaceIdRecord {
  _schema: 1;
  id: string;
  created_at: string;
  memory_seed_applied: boolean;
  memory_seed_persona: string | null;
}
