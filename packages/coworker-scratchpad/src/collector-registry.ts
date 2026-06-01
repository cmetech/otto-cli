import type { Collector, CollectorRegistry, DataSourceRef } from '@otto/coworker-types';

export function uriMatchesPattern(uri: string, pattern: string): boolean {
  if (pattern.endsWith('*')) return uri.startsWith(pattern.slice(0, -1));
  return uri === pattern;
}

export class DefaultCollectorRegistry implements CollectorRegistry {
  private readonly collectors = new Map<string, Collector>();

  register(collector: Collector): void {
    this.collectors.set(collector.id, collector);
  }

  list(): Collector[] {
    return [...this.collectors.values()];
  }

  get(id: string): Collector | null {
    return this.collectors.get(id) ?? null;
  }

  async resolve(uri: string): Promise<{ collector: Collector; ref: DataSourceRef } | null> {
    for (const collector of this.collectors.values()) {
      const patterns = collector.describe().supports_uris;
      if (!patterns.some((p) => uriMatchesPattern(uri, p))) continue;
      for await (const ref of collector.list()) {
        if (ref.uri === uri) return { collector, ref };
      }
    }
    return null;
  }
}
