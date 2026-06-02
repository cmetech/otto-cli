export interface StalenessCheck {
  scratchpadName: string;
  sessionId: string;
  bindings: string[];
  spawnTime: Date;
  lookupLastModified: (ref: string) => Promise<string | null>;
}

export class StalenessBanner {
  private readonly shown = new Map<string, Set<string>>(); // scratchpadName → set of "session|ref"

  async check(args: StalenessCheck): Promise<string | null> {
    const stale: string[] = [];
    for (const ref of args.bindings) {
      const lm = await args.lookupLastModified(ref);
      if (!lm) continue;
      if (new Date(lm).getTime() <= args.spawnTime.getTime()) continue;
      const key = `${args.sessionId}|${ref}`;
      const set = this.shown.get(args.scratchpadName) ?? new Set<string>();
      if (set.has(key)) continue;
      set.add(key);
      this.shown.set(args.scratchpadName, set);
      stale.push(ref);
    }
    if (stale.length === 0) return null;
    const list = stale.join(', ');
    return `${list} was modified after this kernel was spawned; env vars are stale. Run /sp reset to respawn with current values.`;
  }

  resetForRespawn(scratchpadName: string): void {
    this.shown.delete(scratchpadName);
  }
}
