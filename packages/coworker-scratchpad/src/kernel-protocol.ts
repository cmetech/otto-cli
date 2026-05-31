// NDJSON wire protocol between the scratchpad parent runtime and the kernel child.
// One JSON object per line (\n terminated). See spec §2.4 + §6.3.

export interface RunRequest {
  id: number;
  type: 'run';
  code: string;
}
export type KernelRequest = RunRequest;

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
}
export interface DataLoadEvent {
  type: 'event';
  event: 'data_load';
  drawer: DataLoadDrawer;
}
export type KernelEvent = ReadyEvent | DataLoadEvent;

export type KernelFrame = ResultResponse | KernelEvent;

export function isDataLoadEvent(frame: KernelFrame): frame is DataLoadEvent {
  return frame.type === 'event' && frame.event === 'data_load';
}
