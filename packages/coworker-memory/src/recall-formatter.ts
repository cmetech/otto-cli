import type { RecallResult } from './types.js';

export function formatRecall(results: RecallResult[]): string {
  const header = `### Memory recall (${results.length} matches)\n`;
  if (results.length === 0) return header;
  const lines: string[] = [header];
  results.forEach((r, i) => {
    const ts = r.drawer.created_at.replace('T', ' ').slice(0, 16);
    const redacted = r.drawer.redacted ? ' (redacted)' : '';
    lines.push(`\n${i + 1}. [${r.drawer.wing}/${r.drawer.room}/${r.drawer.kind} · ${ts}] (score ${r.score.toFixed(2)})${redacted}`);
    lines.push(`   > ${r.snippet}`);
    lines.push(`   drawer://${r.drawer.id}`);
  });
  return lines.join('\n');
}
