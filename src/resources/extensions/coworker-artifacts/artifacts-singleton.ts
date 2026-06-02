// src/resources/extensions/coworker-artifacts/artifacts-singleton.ts
//
// Factory for the per-session ArtifactStore bundle. Mirrors the Phase 3
// memory-singleton pattern so the activator can construct/dispose state in
// one place. dispose() is a no-op in v1 (ArtifactStore holds no async
// resources) but kept for pattern symmetry with memory + scratchpad bundles.
import { ArtifactStore } from '@otto/coworker-artifacts';

export interface ArtifactsBundleOptions {
  workspaceDir: string;
  now?: () => string;
}

export interface ArtifactsBundle {
  store: ArtifactStore;
  workspaceDir: string;
  dispose(): Promise<void>;
}

export async function createArtifactsBundle(opts: ArtifactsBundleOptions): Promise<ArtifactsBundle> {
  const store = new ArtifactStore({ workspaceDir: opts.workspaceDir, now: opts.now });
  return {
    store,
    workspaceDir: opts.workspaceDir,
    async dispose(): Promise<void> {
      /* no async resources in v1 */
    },
  };
}
