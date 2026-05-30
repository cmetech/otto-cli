verdict: manual-port

# 61babc2 — feat(rpc): add excludeFromContext flag to bash command (closes #5039)

## Target file(s)
- packages/pi-coding-agent/src/modes/rpc/rpc-mode.ts (exists; bash case at line ~666)
- packages/contracts/src/rpc.ts (exists; NOT rpc-types.ts) — RpcCommand bash variant at line 127
- packages/pi-coding-agent/src/modes/rpc/rpc-types.ts is a 4-line re-export of `@otto-build/contracts`; the type change lives in the contracts package instead.

## Divergence
- otto's rpc-types.ts does NOT contain the `RpcCommand` union (it re-exports from contracts), so the upstream rpc-types.ts hunk must be redirected to packages/contracts/src/rpc.ts line 127: `| { id?: string; type: "bash"; command: string }`.
- rpc-mode.ts bash case has diverged only by line number (otto line ~666 vs upstream 547): otto currently calls `session.executeBash(command.command);` with no options arg.
- otto's `executeBash` already accepts the third options arg with `excludeFromContext` (agent-session.ts line ~2492: `options?: { excludeFromContext?: boolean; ... }`), so the API target exists.

## Concrete edits
1. packages/contracts/src/rpc.ts line 127: change bash variant to `| { id?: string; type: "bash"; command: string; excludeFromContext?: boolean }`.
2. rpc-mode.ts bash case: change `const result = await session.executeBash(command.command);` to `const result = await session.executeBash(command.command, undefined, { excludeFromContext: command.excludeFromContext });`.
3. (Optional) add a CHANGELOG entry.

## Verdict
manual-port — trivial logic but the type edit must move to packages/contracts/src/rpc.ts (otto's rpc-types.ts is a contracts re-export). executeBash already supports the option, so just the two edits above.
