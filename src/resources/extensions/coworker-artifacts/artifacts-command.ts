// src/resources/extensions/coworker-artifacts/artifacts-command.ts
//
// /artifacts slash command dispatcher. Subcommands:
//   list (default)        — markdown table of artifacts in this workspace
//   show <slug>           — body + recent provenance for one artifact
//   remove <slug> --confirm — destructive delete, gated by --confirm
import type { ArtifactStore } from '@otto/coworker-artifacts';
import { runListArtifacts } from './list-tool.js';
import { runOpenArtifact } from './open-tool.js';

export interface ArtifactsCommandResult {
  message: string;
}

export async function runArtifactsCommand(
  store: ArtifactStore,
  argv: string[],
): Promise<ArtifactsCommandResult> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'list':
    case undefined: {
      const out = await runListArtifacts(store);
      return { message: out.markdown };
    }
    case 'show': {
      const slug = rest[0];
      if (!slug) throw new Error('Usage: /artifacts show <slug>');
      const out = await runOpenArtifact(store, { slug });
      return { message: out.markdown };
    }
    case 'remove': {
      const slug = rest[0];
      const confirm = rest.includes('--confirm');
      if (!slug) throw new Error('Usage: /artifacts remove <slug> --confirm');
      if (!confirm) throw new Error('Usage: /artifacts remove <slug> --confirm');
      await store.remove(slug, true);
      return { message: `removed: ${slug}` };
    }
    default:
      throw new Error(`Unknown /artifacts subcommand: ${sub}. Try: list, show, remove.`);
  }
}
