import type { EngineField } from './types.js';

export const VAULT_KEEP = '[VAULT_KEEP]' as const;

export function mergeWithSentinel(
  fields: EngineField[],
  stored: Record<string, string>,
  submitted: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const sub = submitted[f.name];
    if (f.secret && sub === VAULT_KEEP) {
      out[f.name] = stored[f.name] ?? '';
    } else {
      out[f.name] = sub ?? '';
    }
  }
  return out;
}

export function assertNoSentinelInCreate(
  fields: EngineField[],
  submitted: Record<string, string>,
): void {
  for (const f of fields) {
    if (f.secret && submitted[f.name] === VAULT_KEEP) {
      throw new Error(`VAULT_KEEP is reserved; pick a real value for field "${f.name}".`);
    }
  }
}
