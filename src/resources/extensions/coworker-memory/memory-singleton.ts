// src/resources/extensions/coworker-memory/memory-singleton.ts
//
// Factory that constructs the layered memory collaborators (LayerAStore x2,
// LocalSqliteBackend, MemoryRecorder) plus shared audit + secret scanner for
// given roots. Mirrors the coworker-vault singleton pattern. Pure beyond what
// the underlying constructors already perform (dir creation, db open, etc.).
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import {
  LayerAStore,
  LocalSqliteBackend,
  MemoryRecorder,
  resolveScope,
  resolveWorkspaceId,
  type ScopeMode,
  type Wing,
  type CurrentScratchpadProvider,
  type WorkspaceIdRecord,
} from '@otto/coworker-memory';

export interface MemoryBundleOptions {
  globalDir: string;
  workspaceDir: string;
  scopeMode: ScopeMode;
  currentScratchpadName: CurrentScratchpadProvider;
}

export interface MemoryBundle {
  globalLayerA: LayerAStore;
  workspaceLayerA: LayerAStore;
  backend: LocalSqliteBackend;
  recorder: MemoryRecorder;
  audit: AuditLog;
  scanner: SecretScanner;
  workspaceWing: Wing;
  writeWing: Wing;
  readWings: Wing[];
  scopeMode: ScopeMode;
  workspaceRecord: WorkspaceIdRecord;
  workspaceDir: string;
  dispose(): Promise<void>;
}

export async function createMemoryBundle(opts: MemoryBundleOptions): Promise<MemoryBundle> {
  const audit = new AuditLog({ path: join(opts.globalDir, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const wsRecord = await resolveWorkspaceId(opts.workspaceDir);
  const scope = resolveScope({ mode: opts.scopeMode, workspaceId: wsRecord.id });
  const globalLayerA = new LayerAStore({
    scopeDir: join(opts.globalDir, 'memory'),
    scope: 'global',
    audit,
    scanner,
  });
  const workspaceLayerA = new LayerAStore({
    scopeDir: join(opts.workspaceDir, '.otto', 'memory'),
    scope: 'workspace',
    audit,
    scanner,
  });
  const backend = new LocalSqliteBackend({
    dbPath: join(opts.workspaceDir, '.otto', 'memory', 'layer-b.db'),
  });
  await backend.open();
  const recorder = new MemoryRecorder({
    backend,
    scanner,
    audit,
    writeWing: scope.writeWing,
    currentScratchpadName: opts.currentScratchpadName,
  });
  return {
    globalLayerA,
    workspaceLayerA,
    backend,
    recorder,
    audit,
    scanner,
    workspaceWing: wsRecord.id,
    writeWing: scope.writeWing,
    readWings: scope.readWings,
    scopeMode: opts.scopeMode,
    workspaceRecord: wsRecord,
    workspaceDir: opts.workspaceDir,
    async dispose() {
      await backend.close();
    },
  };
}
