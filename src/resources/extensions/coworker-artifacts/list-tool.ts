// src/resources/extensions/coworker-artifacts/list-tool.ts
//
// `list_artifacts` LLM tool runner. Reads each artifact's metadata.json for
// the timestamp + turn_count fields not carried on ArtifactHandle, and emits
// both a structured payload and a markdown table for the assistant to surface.
import type { ArtifactStore } from '@otto/coworker-artifacts';

export interface ListedArtifact {
  slug: string;
  kind: string;
  name: string;
  uri: string;
  created_at: string;
  last_updated_at: string;
  turn_count: number;
}

export interface ListToolOutput {
  artifacts: ListedArtifact[];
  markdown: string;
}

export async function runListArtifacts(store: ArtifactStore): Promise<ListToolOutput> {
  const handles = await store.list();
  // We need the metadata fields not on the handle — re-read each metadata.json.
  const { readFileSync } = await import('node:fs');
  const rows: ListedArtifact[] = handles.map((h) => {
    const meta = JSON.parse(readFileSync(h.metadataPath, 'utf8')) as {
      created_at: string;
      last_updated_at: string;
      turn_count: number;
    };
    return {
      slug: h.slug,
      kind: h.kind,
      name: h.name,
      uri: h.uri,
      created_at: meta.created_at,
      last_updated_at: meta.last_updated_at,
      turn_count: meta.turn_count,
    };
  });
  if (rows.length === 0) {
    return { artifacts: [], markdown: '### Artifacts (0)\n' };
  }
  const lines: string[] = [`### Artifacts (${rows.length})`, ''];
  lines.push('| slug | kind | turns | last updated | uri |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(`| ${r.slug} | ${r.kind} | ${r.turn_count} | ${r.last_updated_at} | \`${r.uri}\` |`);
  }
  return { artifacts: rows, markdown: lines.join('\n') + '\n' };
}
