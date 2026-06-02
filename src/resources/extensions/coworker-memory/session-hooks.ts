// src/resources/extensions/coworker-memory/session-hooks.ts
//
// Session lifecycle seams for the coworker-memory extension.
// - onSessionStart: applies a one-shot persona seed (if pending) and returns
//   the Layer A context block ready for system-prompt injection.
// - onSessionShutdown: closes the backend (Layer B). Safe to double-call —
//   LocalSqliteBackend.close() nulls its db handle so a second close is a no-op.
import { buildLayerAContext, applyPersonaSeed, writeWorkspaceId } from '@otto/coworker-memory';
import type { MemoryBundle } from './memory-singleton.js';

export interface SessionStartOptions {
  tokenLimit?: number;
  persona?: { id: string; personaDir: string };
}

export interface SessionStartResult {
  contextBlock: string;
  seed: { copied: string[]; blocked: string[] };
}

export async function onSessionStart(
  bundle: MemoryBundle,
  opts: SessionStartOptions = {},
): Promise<SessionStartResult> {
  let seed = { copied: [] as string[], blocked: [] as string[] };
  if (opts.persona && !bundle.workspaceRecord.memory_seed_applied) {
    seed = await applyPersonaSeed({
      personaId: opts.persona.id,
      personaDir: opts.persona.personaDir,
      store: bundle.workspaceLayerA,
    });
    if (seed.copied.length > 0 || seed.blocked.length > 0) {
      bundle.workspaceRecord.memory_seed_applied = true;
      bundle.workspaceRecord.memory_seed_persona = opts.persona.id;
      await writeWorkspaceId(bundle.workspaceDir, bundle.workspaceRecord);
      bundle.audit.append({
        _schema: 1,
        ts: new Date().toISOString(),
        producer: 'memory',
        action: 'seed-applied',
        detail: {
          persona_id: opts.persona.id,
          files_copied: seed.copied,
          files_blocked: seed.blocked,
        },
      });
    }
  }
  const contextBlock = await buildLayerAContext({
    mode: bundle.scopeMode,
    globalStore: bundle.globalLayerA,
    workspaceStore: bundle.workspaceLayerA,
    tokenLimit: opts.tokenLimit ?? 3000,
  });
  return { contextBlock, seed };
}

export async function onSessionShutdown(bundle: MemoryBundle): Promise<void> {
  // WAL checkpoint happens on backend close; this is the seam.
  await bundle.dispose();
}
