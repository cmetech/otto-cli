// packages/coworker-vault/src/injector.ts
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault } from './data-vault.js';
import { BindingNotFound, VaultEntryNotFound } from './errors.js';
import type { VaultEntry } from './types.js';

export interface CredentialInjectorOptions {
  vault: LocalDataVault;
  audit: AuditLog;
}

export interface InjectionContext {
  scratchpadName: string;
  sessionId: string;
  pid: number;
}

export class CredentialInjector {
  constructor(private readonly opts: CredentialInjectorOptions) {}

  async injectEnv(
    baseEnv: NodeJS.ProcessEnv,
    bindings: string[],
    ctx: InjectionContext,
  ): Promise<NodeJS.ProcessEnv> {
    const out: NodeJS.ProcessEnv = { ...baseEnv };
    const loose = process.env.OTTO_VAULT_MISSING_OK === '1';
    for (const refStr of bindings) {
      const ref = LocalDataVault.parseRef(refStr);
      let entry: VaultEntry;
      try {
        entry = await this.opts.vault.get(ref);
      } catch (err) {
        if (err instanceof VaultEntryNotFound) {
          if (loose) {
            process.stderr.write(
              `vault: binding ${refStr} missing — skipped (OTTO_VAULT_MISSING_OK=1)\n`,
            );
            this.opts.audit.append({
              _schema: 1,
              ts: new Date().toISOString(),
              producer: 'vault',
              action: 'inject-skipped',
              severity: 'warn',
              sessionId: ctx.sessionId,
              scratchpadName: ctx.scratchpadName,
              pid: ctx.pid,
              detail: { ref: refStr, reason: 'not-found' },
            });
            continue;
          }
          throw new BindingNotFound(refStr);
        }
        throw err;
      }
      for (const [field, value] of Object.entries(entry.fields)) {
        out[envVarName(ref.engine, ref.name, field)] = value;
      }
      this.opts.audit.append({
        _schema: 1,
        ts: new Date().toISOString(),
        producer: 'vault',
        action: 'inject',
        sessionId: ctx.sessionId,
        scratchpadName: ctx.scratchpadName,
        pid: ctx.pid,
        detail: {
          engine: ref.engine,
          name: ref.name,
          fields_injected: Object.keys(entry.fields),
        },
      });
    }
    return out;
  }

  async loadForBinding(_serviceName: string): Promise<null> {
    return null; // Phase 3+
  }
}

export function envVarName(engineId: string, entryName: string, fieldName: string): string {
  const e = engineId.replace(/-/g, '_').toUpperCase();
  const n = entryName.replace(/-/g, '_').toUpperCase();
  const f = fieldName.toUpperCase();
  return `OTTO_DS_${e}_${n}__${f}`;
}

export function clearEnv(env: NodeJS.ProcessEnv = process.env): number {
  let n = 0;
  for (const key of Object.keys(env)) {
    if (key.startsWith('OTTO_DS_')) {
      delete env[key];
      n++;
    }
  }
  return n;
}
