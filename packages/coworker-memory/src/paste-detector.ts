// packages/coworker-memory/src/paste-detector.ts
export interface PasteDetectorOptions {
  lengthThreshold?: number;     // default 500
  newlineThreshold?: number;    // default 10
}

const DEFAULT_LENGTH = 500;
const DEFAULT_NEWLINES = 10;

export function detectPaste(text: string, opts: PasteDetectorOptions = {}): 'turn' | 'paste' {
  const lengthThreshold = opts.lengthThreshold ?? DEFAULT_LENGTH;
  const newlineThreshold = opts.newlineThreshold ?? DEFAULT_NEWLINES;
  if (/```/.test(text)) return 'paste';
  if (text.length >= lengthThreshold) return 'paste';
  const newlines = (text.match(/\n/g) ?? []).length;
  if (newlines > newlineThreshold) return 'paste';
  return 'turn';
}
