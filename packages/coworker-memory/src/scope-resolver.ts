// packages/coworker-memory/src/scope-resolver.ts
import type { ScopeMode, Wing } from './types.js';

export interface ResolvedScope {
  writeWing: Wing;
  readWings: Wing[];
}

export function resolveScope(args: { mode: ScopeMode; workspaceId: Wing }): ResolvedScope {
  switch (args.mode) {
    case 'global':
      return { writeWing: 'global', readWings: ['global'] };
    case 'per-project':
      return { writeWing: args.workspaceId, readWings: [args.workspaceId] };
    case 'per-project-tagged':
      return { writeWing: args.workspaceId, readWings: [args.workspaceId, 'global'] };
  }
}
