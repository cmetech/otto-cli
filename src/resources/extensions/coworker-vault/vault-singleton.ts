// src/resources/extensions/coworker-vault/vault-singleton.ts
//
// Factory that constructs the three vault collaborators (LocalDataVault, AuditLog,
// EngineRegistry) for given roots. Pure: side-effects are limited to whatever the
// underlying constructors already perform (dir creation, orphan sweeps, etc.).
import { join } from 'node:path';
import { homedir } from 'node:os';
import { AuditLog } from '@otto/coworker-utils';
import { LocalDataVault, EngineRegistry } from '@otto/coworker-vault';

export interface VaultBundleOptions {
  /** Defaults to ~/.otto */
  globalDir?: string;
  /** Optional workspace root (NOT including .otto suffix). */
  workspaceDir?: string;
}

export interface VaultBundle {
  vault: LocalDataVault;
  audit: AuditLog;
  registry: EngineRegistry;
  globalDir: string;
  workspaceDir?: string;
}

export async function createVaultBundle(opts: VaultBundleOptions = {}): Promise<VaultBundle> {
  const globalDir = opts.globalDir ?? join(homedir(), '.otto');
  const auditPath = join(globalDir, 'audit.jsonl');
  const audit = new AuditLog({ path: auditPath });
  const vault = new LocalDataVault({
    globalDir,
    workspaceDir: opts.workspaceDir,
    audit,
  });
  const registry = await EngineRegistry.load({
    userDir: join(globalDir, 'engines'),
    workspaceDir: opts.workspaceDir ? join(opts.workspaceDir, 'engines') : undefined,
  });
  return { vault, audit, registry, globalDir, workspaceDir: opts.workspaceDir };
}
