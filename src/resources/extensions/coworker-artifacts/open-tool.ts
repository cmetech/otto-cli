// src/resources/extensions/coworker-artifacts/open-tool.ts
//
// `open_artifact` LLM tool runner. Returns the primary file body wrapped in a
// fenced markdown block plus the tail 5 provenance entries so the assistant
// can summarise recent edits without flooding context with the full ledger.
import type { ArtifactStore } from '@otto/coworker-artifacts';
import { ArtifactNotFound } from '@otto/coworker-artifacts';

export interface OpenToolOutput {
  markdown: string;
}

export async function runOpenArtifact(
  store: ArtifactStore,
  args: { slug: string },
): Promise<OpenToolOutput> {
  const handle = await store.get(args.slug);
  if (!handle) throw new ArtifactNotFound(args.slug);
  const { readFileSync } = await import('node:fs');
  const body = readFileSync(handle.primaryPath, 'utf8');
  const provRaw = readFileSync(handle.provenancePath, 'utf8');
  const prov = JSON.parse(provRaw) as Array<{
    ts: string;
    action: string;
    turn_id: string;
    user_prompt: string;
  }>;
  const tail = prov.slice(-5);
  const lines: string[] = [];
  lines.push(`### ${handle.name} (\`${handle.uri}\`)`);
  lines.push('');
  lines.push('```markdown');
  lines.push(body);
  lines.push('```');
  lines.push('');
  if (tail.length > 0) {
    lines.push('**Recent provenance:**');
    for (const e of tail) {
      lines.push(`- ${e.ts} · ${e.action} · turn \`${e.turn_id}\` · ${e.user_prompt}`);
    }
  }
  return { markdown: lines.join('\n') + '\n' };
}
