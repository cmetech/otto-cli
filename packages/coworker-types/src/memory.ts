// Memory-layer types for the otto-memory contract.
// See spec §2.1 "Layer B structure — Wings, Rooms, Drawers as contract concepts".

export type Wing = string;
export type Room = string;

export type DrawerKind =
  | 'turn'
  | 'paste'
  | 'file_load'
  | 'ticket'
  | 'email'
  | 'rca'
  | 'note';

export interface Drawer {
  id: string;
  wing: Wing;
  room: Room;
  kind: DrawerKind;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  parent_id?: string;
}

export interface RecallQuery {
  query: string;
  wing?: Wing;
  room?: Room;
  kind?: DrawerKind | DrawerKind[];
  days_back?: number;
  max_results?: number;
}

export interface Entity {
  id: string;
  type: string;
  canonical: string;
  aliases: string[];
  metadata: Record<string, unknown>;
  first_seen: string;
  last_seen: string;
}

export interface EntityEdge {
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to?: string;
  metadata?: Record<string, unknown>;
}

export interface EntityQuery {
  entity_type?: string;
  name?: string;
  predicate?: string;
  as_of?: string;
}

export interface BackendStatus {
  backend_id: string;
  drawer_count: number;
  entity_count: number;
  size_bytes: number;
  last_write_at?: string;
}

export interface MemoryBackend {
  recall(query: RecallQuery): Promise<Drawer[]>;
  retain(drawer: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  entityQuery(query: EntityQuery): Promise<Entity[]>;
  entityAssert(edge: EntityEdge): Promise<void>;
  status(): Promise<BackendStatus>;
  clear(): Promise<void>;
}
