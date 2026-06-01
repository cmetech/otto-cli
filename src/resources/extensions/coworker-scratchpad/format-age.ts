export function formatRelativeAge(ageMs: number): string {
  if (ageMs < 30_000) return 'active';
  if (ageMs < 60 * 60_000) return `idle ${Math.floor(ageMs / 60_000)}m`;
  if (ageMs < 24 * 60 * 60_000) return `idle ${Math.floor(ageMs / (60 * 60_000))}h`;
  return `idle ${Math.floor(ageMs / (24 * 60 * 60_000))}d`;
}
