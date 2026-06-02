// src/resources/extensions/coworker-memory/recall-tool.ts
import type { MemoryBundle } from './memory-singleton.js';
import { formatRecall, type RecallQuery, type RecallResult } from '@otto/coworker-memory';

export interface RecallToolArgs {
  query: string;
  kind?: RecallQuery['kind'];
  wing?: string;
  room?: string;
  days_back?: number;
  max_results?: number;
}

export interface RecallToolOutput {
  results: RecallResult[];
  markdown: string;
}

export async function runRecall(bundle: MemoryBundle, args: RecallToolArgs): Promise<RecallToolOutput> {
  const wings = args.wing ? [args.wing, ...bundle.readWings.filter(w => w !== args.wing)] : bundle.readWings;
  const limit = args.max_results === undefined ? 8 : Math.min(Math.max(args.max_results, 1), 64);
  const results = await bundle.backend.recall({
    query: args.query, wing: wings, room: args.room, kind: args.kind,
    days_back: args.days_back, max_results: limit,
  });
  bundle.audit.append({
    _schema: 1, ts: new Date().toISOString(), producer: 'memory', action: 'recall',
    detail: {
      wing_filter: wings, room_filter: args.room ?? null,
      kind_filter: args.kind ?? null, days_back: args.days_back ?? null,
      result_count: results.length,
    },
  });
  return { results, markdown: formatRecall(results) };
}
