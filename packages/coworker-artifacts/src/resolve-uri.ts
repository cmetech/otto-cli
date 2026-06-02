// packages/coworker-artifacts/src/resolve-uri.ts
import { join } from 'node:path';
import { ArtifactUriMalformed } from './errors.js';
import type { ResolvedArtifactUri } from './types.js';

export const ARTIFACT_URI_SCHEME = 'artifact://';
const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export function resolveArtifactUri(uri: string, workspaceDir: string): ResolvedArtifactUri {
  if (!uri.startsWith(ARTIFACT_URI_SCHEME)) {
    throw new ArtifactUriMalformed(uri, `must start with ${ARTIFACT_URI_SCHEME}`);
  }
  const slug = uri.slice(ARTIFACT_URI_SCHEME.length);
  if (!slug) throw new ArtifactUriMalformed(uri, 'empty slug');
  if (slug.includes('..')) throw new ArtifactUriMalformed(uri, 'path traversal');
  if (slug.length > 64) throw new ArtifactUriMalformed(uri, 'slug exceeds 64 chars');
  if (!SLUG_REGEX.test(slug)) {
    throw new ArtifactUriMalformed(uri, 'slug must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$');
  }
  const dir = join(workspaceDir, '.otto', 'artifacts', slug);
  return {
    slug,
    dir,
    primaryPath: join(dir, 'report.md'),
    metadataPath: join(dir, 'metadata.json'),
    provenancePath: join(dir, 'provenance.json'),
    readmePath: join(dir, 'README.md'),
  };
}
