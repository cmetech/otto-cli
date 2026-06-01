// NDJSON wire protocol between the scratchpad parent runtime and the kernel child.
// One JSON object per line (\n terminated). See spec §2.4 + §6.3.

export type { SkippedKey } from './namespace-codec.js';
import type { SkippedKey } from './namespace-codec.js';

export interface RunRequest {
  id: number;
  type: 'run';
  code: string;
}
export interface SnapshotRequest {
  id: number;
  type: 'snapshot';
}
export type KernelRequest = RunRequest | SnapshotRequest;

export interface ResultOk {
  id: number;
  type: 'result';
  ok: true;
  value: unknown;
  stdout: string;
}
export interface ResultErr {
  id: number;
  type: 'result';
  ok: false;
  error: { name: string; message: string; stack?: string };
}
export type ResultResponse = ResultOk | ResultErr;

// 1d2 — snapshot request/response. Parent triggers, kernel sync-writes
// <scratchpadDir>/namespace.json and ACKs. Parent records the result into
// meta.json before disposing the kernel.
export interface SnapshotResultOk {
  id: number;
  type: 'snapshot_result';
  ok: true;
  skipped: SkippedKey[];
  snapshotted_at: string;
}
export interface SnapshotResultErr {
  id: number;
  type: 'snapshot_result';
  ok: false;
  error: { name: string; message: string; stack?: string };
}
export type SnapshotResult = SnapshotResultOk | SnapshotResultErr;

export type RecoveryNote =
  | { kind: 'namespace-absent' }
  | { kind: 'namespace-corrupt'; message: string }
  | { kind: 'cells-since-snapshot'; n: number }
  | { kind: 'snapshot-failed'; message: string };

// Layer-B drawer payload recorded when a cell loads data through a collector.
// `schema` is always null in Phase 1b; real schema introspection arrives with
// DuckDB in sub-plan 1d.
export interface DataLoadDrawer {
  kind: 'data_load';
  collector: string;
  uri: string;
  bytes: number | null;
  rows_loaded: number | null;
  loaded_at: string;
  schema: null;
}

export interface ReadyEvent {
  type: 'event';
  event: 'ready';
  recovery_notes?: RecoveryNote[];
}
export interface DataLoadEvent {
  type: 'event';
  event: 'data_load';
  drawer: DataLoadDrawer;
}
export interface ProgressEvent {
  type: 'event';
  event: 'progress';
  message?: string;
}
export interface StartupErrorEvent {
  type: 'event';
  event: 'startup_error';
  kind: string;
  error: { name: string; message: string; stack?: string };
}
export type KernelEvent = ReadyEvent | DataLoadEvent | ProgressEvent | StartupErrorEvent;

export type KernelFrame = ResultResponse | KernelEvent | SnapshotResult;

export function isDataLoadEvent(frame: KernelFrame): frame is DataLoadEvent {
  return frame.type === 'event' && frame.event === 'data_load';
}

export function isProgressEvent(frame: KernelFrame): frame is ProgressEvent {
  return frame.type === 'event' && frame.event === 'progress';
}

export function isStartupErrorEvent(frame: KernelFrame): frame is StartupErrorEvent {
  return frame.type === 'event' && frame.event === 'startup_error';
}

export function isSnapshotResult(frame: KernelFrame): frame is SnapshotResult {
  return frame.type === 'snapshot_result';
}
