// packages/coworker-artifacts/src/readme-renderer.ts
import type { ArtifactMetadata, Provenance } from './types.js';

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${UNITS[unit]}`;
}

function escapeMarkdownPipe(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function renderReadme(
  metadata: ArtifactMetadata,
  provenance: Provenance,
  fileStats: Array<{ path: string; sizeBytes: number }>,
): string {
  const firstTurn = provenance[0]?.turn_id ?? '';
  const lastTurn = provenance.length > 0 ? provenance[provenance.length - 1]!.turn_id : '';

  const lines: string[] = [];
  lines.push(`# ${metadata.name}`);
  lines.push('');
  lines.push(`**Kind:** ${metadata.kind}`);
  lines.push(`**URI:** \`${metadata.uri}\``);
  lines.push(`**Created:** ${metadata.created_at}${firstTurn ? ` (turn \`${firstTurn}\`)` : ''}`);
  lines.push(`**Last updated:** ${metadata.last_updated_at}${lastTurn ? ` (turn \`${lastTurn}\`)` : ''}`);
  lines.push(`**Turns:** ${metadata.turn_count}`);
  lines.push('');
  lines.push('## Files');
  lines.push('');
  if (fileStats.length === 0) {
    lines.push('(none)');
  } else {
    for (const f of fileStats) {
      lines.push(`- \`${f.path}\` — ${humanSize(f.sizeBytes)}`);
    }
  }
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push('| # | ts | action | turn | prompt |');
  lines.push('|---|---|---|---|---|');
  provenance.forEach((e, i) => {
    lines.push(`| ${i + 1} | ${e.ts} | ${e.action} | ${e.turn_id} | ${escapeMarkdownPipe(e.user_prompt)} |`);
  });
  return lines.join('\n') + '\n';
}
