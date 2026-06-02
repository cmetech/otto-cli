// packages/coworker-memory/src/memory-recorder.ts
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import type { MemoryBackend } from './memory-backend.js';
import type { Wing, Room, Drawer } from './types.js';
import { detectPaste } from './paste-detector.js';

export interface CurrentScratchpadProvider {
  (sessionId: string): string | null;
}

export interface MemoryRecorderOptions {
  backend: MemoryBackend;
  scanner: SecretScanner;
  audit: AuditLog;
  writeWing: Wing;
  currentScratchpadName: CurrentScratchpadProvider;
  pasteOptions?: { lengthThreshold?: number; newlineThreshold?: number };
}

export class MemoryRecorder {
  constructor(private readonly opts: MemoryRecorderOptions) {}

  async recordTurn(args: { sessionId: string; userText: string; turnId: string; room?: Room }): Promise<Drawer> {
    const kind = detectPaste(args.userText, this.opts.pasteOptions);
    const room = args.room ?? this.opts.currentScratchpadName(args.sessionId) ?? 'inbox';
    return this.writeDrawer({
      wing: this.opts.writeWing, room, kind,
      content: args.userText, metadata: { turn_id: args.turnId, session_id: args.sessionId },
    });
  }

  async recordPaste(args: { sessionId: string; content: string; turnId: string; room?: Room }): Promise<Drawer> {
    const room = args.room ?? this.opts.currentScratchpadName(args.sessionId) ?? 'inbox';
    return this.writeDrawer({
      wing: this.opts.writeWing, room, kind: 'paste',
      content: args.content, metadata: { turn_id: args.turnId, session_id: args.sessionId },
    });
  }

  async recordFileLoad(args: {
    scratchpadName: string; collector: string; uri: string;
    bytes: number; rows_loaded?: number; schema?: object; turnId: string;
  }): Promise<Drawer> {
    const content = JSON.stringify({
      collector: args.collector, uri: args.uri, bytes: args.bytes,
      rows_loaded: args.rows_loaded, schema: args.schema,
    });
    return this.writeDrawer({
      wing: this.opts.writeWing, room: args.scratchpadName, kind: 'file_load',
      content, metadata: { turn_id: args.turnId, scratchpad: args.scratchpadName },
    });
  }

  async recordArtifact(args: {
    scratchpadName: string; slug: string; kind: string; uri: string;
    turnId: string;
  }): Promise<Drawer> {
    const content = JSON.stringify({
      slug: args.slug, kind: args.kind, uri: args.uri,
    });
    return this.writeDrawer({
      wing: this.opts.writeWing, room: args.scratchpadName, kind: 'artifact',
      content, metadata: { turn_id: args.turnId, scratchpad: args.scratchpadName },
    });
  }

  private async writeDrawer(input: Omit<Drawer, 'id' | 'created_at' | 'redacted'>): Promise<Drawer> {
    const hits = this.opts.scanner.scan(input.content);
    let content = input.content;
    let redacted = false;
    if (hits.length > 0) {
      content = this.opts.scanner.redact(input.content);
      redacted = true;
      const ts = new Date().toISOString();
      for (const h of hits) {
        this.opts.audit.append({
          _schema: 1, ts, producer: 'memory', action: 'redact', severity: 'warn',
          detail: {
            wing: input.wing, room: input.room, kind: input.kind,
            secret_kind: h.kind, offset: h.start, length: h.end - h.start,
          },
        });
      }
    }
    const drawer = await this.opts.backend.retain({ ...input, content, redacted });
    this.opts.audit.append({
      _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'write-drawer',
      detail: {
        wing: drawer.wing, room: drawer.room, kind: drawer.kind,
        byte_count: Buffer.byteLength(content, 'utf8'), redacted,
      },
    });
    return drawer;
  }
}
