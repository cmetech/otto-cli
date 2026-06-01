// Inter-package contracts. See spec §2.5.
import type { DrawerKind } from './memory.js';

export interface RecordEpisodeArgs {
  sessionId: string;
  room: string;
  kind: DrawerKind;
  content: string;
  turnId: string;
  metadata?: Record<string, unknown>;
  // wing is intentionally absent — otto-memory derives it from active scoping mode.
}

export interface RecordCellArgs {
  scratchpadName: string;
  cellId: string;
  code: string;
  stdout: string;
  error: { type: string; message: string } | null;
  durationMs: number;
}

export type AccSeverity = 'low' | 'medium' | 'high';

export interface AccEventArgs {
  sessionId: string;
  kind: string;          // ACC detector vocabulary — closed set defined in coworker-memory Phase 5
  detail: string;
  severity: AccSeverity;
}

export interface MemoryRecorder {
  recordEpisode(args: RecordEpisodeArgs): Promise<void>;
  recordCell(args: RecordCellArgs): Promise<void>;
  observeAccEvent(args: AccEventArgs): void;
}
