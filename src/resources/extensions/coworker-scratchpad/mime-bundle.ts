export interface MimeBundle {
  'text/plain'?: string;
  'application/json'?: unknown;
  'text/markdown'?: string;
}

export function deriveMimeBundle(value: unknown, stdout: string): MimeBundle {
  const bundle: MimeBundle = {};
  if (stdout.length > 0) bundle['text/plain'] = stdout;
  if (value !== undefined && value !== null) bundle['application/json'] = value;
  if (typeof value === 'string' && looksLikeMarkdown(value)) {
    bundle['text/markdown'] = value;
  }
  return bundle;
}

function looksLikeMarkdown(s: string): boolean {
  const trimmed = s.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('|')) return true;
  // GFM table separator row: a line that is just |---|---|...
  if (/\n\s*\|[-:|\s]+\|\s*\n/.test(s)) return true;
  return false;
}
