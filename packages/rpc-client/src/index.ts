/**
 * @otto-build/rpc-client — standalone RPC client SDK for the workflow.
 *
 * Re-exports all types, JSONL utilities, and the RpcClient class.
 */

export * from "./rpc-types.js";
export { serializeJsonLine, attachJsonlLineReader } from "./jsonl.js";
export { RpcClient } from "./rpc-client.js";
export type { RpcClientOptions, RpcEventListener } from "./rpc-client.js";
