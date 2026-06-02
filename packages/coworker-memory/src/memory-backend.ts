import type { Drawer, RecallQuery, RecallResult, BackendStatus, Wing, Room } from './types.js';

export interface MemoryBackend {
  recall(query: RecallQuery): Promise<RecallResult[]>;
  retain(input: Omit<Drawer, 'id' | 'created_at'>): Promise<Drawer>;
  listRooms(wing?: Wing): Promise<Room[]>;
  listWings(): Promise<Wing[]>;
  status(): Promise<BackendStatus>;
  clear(args: { wing?: Wing; confirm: true }): Promise<{ deleted: number }>;
}
