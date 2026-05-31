// SecretScanner — stub gate before any disk write to memory layers A/B.
// Spec §6.5.

export interface SecretHit {
  kind: string;
  start: number;
  end: number;
  preview: string;        // first 8 chars + "..." — for audit logs (never the full secret)
}

interface Pattern {
  kind: string;
  regex: RegExp;
}

// Patterns are intentionally conservative — false negatives are OK in v1; false positives in
// memory are a real cost (user lessons get over-redacted). Tighten or extend as Phase 3 reveals
// real-world content.
const PATTERNS: Pattern[] = [
  { kind: 'anthropic_api_key', regex: /sk-ant-api03-[A-Za-z0-9_-]{40,}/g },
  { kind: 'openai_api_key',    regex: /sk-(?:proj-)?[A-Za-z0-9]{40,}/g },
  { kind: 'aws_access_key_id', regex: /AKIA[0-9A-Z]{16}/g },
  { kind: 'github_pat',        regex: /gh[pous]_[A-Za-z0-9]{36,}/g },
];

export class SecretScanner {
  scan(text: string): SecretHit[] {
    const hits: SecretHit[] = [];
    for (const { kind, regex } of PATTERNS) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) != null) {
        hits.push({
          kind,
          start: m.index,
          end: m.index + m[0].length,
          preview: m[0].slice(0, 8) + '...',
        });
      }
    }
    return hits.sort((a, b) => a.start - b.start);
  }

  redact(text: string): string {
    const hits = this.scan(text);
    if (hits.length === 0) return text;
    let out = '';
    let cursor = 0;
    for (const h of hits) {
      out += text.slice(cursor, h.start) + `[REDACTED:${h.kind}]`;
      cursor = h.end;
    }
    out += text.slice(cursor);
    return out;
  }
}
