// Migration framework — forward-only schema migrations per file kind.
// Spec §6.2, §3.4c.

export type MigrationFn<TIn = unknown, TOut = unknown> = (data: TIn) => Promise<TOut>;

interface MigrationRecord {
  from: number;
  to: number;
  fn: MigrationFn;
}

export class MigrationRunner {
  #byKind = new Map<string, MigrationRecord[]>();

  register<TIn = unknown, TOut = unknown>(
    kind: string,
    from: number,
    to: number,
    fn: MigrationFn<TIn, TOut>,
  ): void {
    if (to <= from) {
      throw new Error(`migration target version (${to}) must be greater than source (${from})`);
    }
    const list = this.#byKind.get(kind) ?? [];
    list.push({ from, to, fn: fn as MigrationFn });
    list.sort((a, b) => a.from - b.from);
    this.#byKind.set(kind, list);
  }

  latestVersion(kind: string): number | null {
    const list = this.#byKind.get(kind);
    if (!list || list.length === 0) return null;
    return Math.max(...list.map(m => m.to));
  }

  async migrate(kind: string, fromVersion: number, data: unknown): Promise<unknown> {
    const target = this.latestVersion(kind);
    if (target == null || fromVersion >= target) return data;
    const list = this.#byKind.get(kind)!;
    let current = fromVersion;
    let value = data;
    while (current < target) {
      const next = list.find(m => m.from === current);
      if (!next) throw new Error(`no migration from version ${current} to ${current + 1} for kind ${kind}`);
      value = await next.fn(value);
      current = next.to;
    }
    return value;
  }
}
