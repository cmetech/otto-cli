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
// Phase 4 Task 9 — artifact RPC + event

// Layer-B drawer payload recorded when a cell creates an artifact. Mirrors the
// shape of DataLoadDrawer; persisted to memory by the manager (Task 10).
export interface ArtifactCreateDrawer {
  kind: 'artifact';
  slug: string;
  artifact_kind: string; // 'report' in v1
  uri: string;
  primary_path: string;
  created_at: string;
}

// Kernel→manager request to create an artifact. Manager constructs the
// ArtifactStore and writes the response back to kernel stdin.
export interface ArtifactCreateRequest {
  type: 'request';
  request: 'artifact_create';
  id: string;
  kind: string; // 'report'
  name: string;
}
export interface ArtifactCreateResponseOk {
  type: 'response';
  request: 'artifact_create';
  id: string;
  ok: true;
  slug: string;
  uri: string;
  primary_path: string;
}
export interface ArtifactCreateResponseErr {
  type: 'response';
  request: 'artifact_create';
  id: string;
  ok: false;
  error: string;
}
export type ArtifactCreateResponse = ArtifactCreateResponseOk | ArtifactCreateResponseErr;

// Kernel→manager request to write files into an existing artifact dir.
export interface ArtifactUpdateRequest {
  type: 'request';
  request: 'artifact_update';
  id: string;
  slug: string;
  files: Array<{ path: string; content: string }>;
}
export interface ArtifactUpdateResponseOk {
  type: 'response';
  request: 'artifact_update';
  id: string;
  ok: true;
  files_touched: string[];
}
export interface ArtifactUpdateResponseErr {
  type: 'response';
  request: 'artifact_update';
  id: string;
  ok: false;
  error: string;
}
export type ArtifactUpdateResponse = ArtifactUpdateResponseOk | ArtifactUpdateResponseErr;

// Event the kernel emits after a successful artifact_create RPC so the manager
// can record the drawer into memory (mirrors DataLoadEvent).
export interface ArtifactCreateEvent {
  type: 'event';
  event: 'artifact_create';
  drawer: ArtifactCreateDrawer;
}

export type KernelRpcRequest = ArtifactCreateRequest | ArtifactUpdateRequest;
export type KernelRpcResponse = ArtifactCreateResponse | ArtifactUpdateResponse;

export type KernelEvent =
  | ReadyEvent
  | DataLoadEvent
  | ProgressEvent
  | StartupErrorEvent
  | ArtifactCreateEvent;

// Phase 4 Task 10: widened to include KernelRpcRequest so the manager-side
// dispatch (child-process-runtime.ts readLoop) can narrow inbound artifact
// RPC requests alongside results/events/snapshot_results. The dispatcher must
// guard the ResultResponse branch with a discriminant check on `type === 'result'`
// before touching `frame.id` (which is `string` on RPC frames and `number`
// elsewhere).
export type KernelFrame = ResultResponse | KernelEvent | SnapshotResult | KernelRpcRequest;

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

export function isArtifactCreateEvent(frame: unknown): frame is ArtifactCreateEvent {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; event?: unknown };
  return f.type === 'event' && f.event === 'artifact_create';
}

export function isArtifactCreateRequest(frame: unknown): frame is ArtifactCreateRequest {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; request?: unknown };
  return f.type === 'request' && f.request === 'artifact_create';
}

export function isArtifactUpdateRequest(frame: unknown): frame is ArtifactUpdateRequest {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; request?: unknown };
  return f.type === 'request' && f.request === 'artifact_update';
}

export function isArtifactCreateResponse(frame: unknown): frame is ArtifactCreateResponse {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; request?: unknown };
  return f.type === 'response' && f.request === 'artifact_create';
}

export function isArtifactUpdateResponse(frame: unknown): frame is ArtifactUpdateResponse {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; request?: unknown };
  return f.type === 'response' && f.request === 'artifact_update';
}

/** True for any `{type:'response'}` frame addressed to the kernel. */
export function isKernelRpcResponse(frame: unknown): frame is KernelRpcResponse {
  return isArtifactCreateResponse(frame) || isArtifactUpdateResponse(frame);
}
