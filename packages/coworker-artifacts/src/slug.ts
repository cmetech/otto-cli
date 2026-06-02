// packages/coworker-artifacts/src/slug.ts
import { ArtifactSlugCollision } from './errors.js';

export const MAX_SLUG_LENGTH = 64;
export const MAX_COLLISION_ATTEMPTS = 100;

export function deriveSlug(name: string): string {
  let s = name.toLowerCase();
  // Strip diacritics (NFKD + remove combining marks U+0300–U+036F)
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  // Replace non a-z 0-9 with dash
  s = s.replace(/[^a-z0-9]+/g, '-');
  // Collapse runs of dashes
  s = s.replace(/-+/g, '-');
  // Trim leading/trailing dashes
  s = s.replace(/^-+|-+$/g, '');
  // Truncate
  if (s.length > MAX_SLUG_LENGTH) s = s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/, '');
  // Fallback if empty
  if (!s) s = `artifact-${Date.now().toString(36)}`;
  return s;
}

export function nextCollisionSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n <= MAX_COLLISION_ATTEMPTS + 1; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new ArtifactSlugCollision(base, MAX_COLLISION_ATTEMPTS);
}
