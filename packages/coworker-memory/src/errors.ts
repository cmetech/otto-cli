// packages/coworker-memory/src/errors.ts
export class MemoryNotInitialized extends Error {
  constructor(public readonly reason: string) {
    super(`Memory not initialized: ${reason}. /memory status to inspect.`);
    this.name = 'MemoryNotInitialized';
  }
}

export class BackendUnavailable extends Error {
  constructor(public readonly reason: string) {
    super(`Memory backend unavailable: ${reason}.`);
    this.name = 'BackendUnavailable';
  }
}

export class DrawerKindRejected extends Error {
  constructor(public readonly kind: string) {
    super(`Drawer kind '${kind}' is not in v1 vocabulary. Allowed: turn, paste, file_load, ticket, email, rca, note.`);
    this.name = 'DrawerKindRejected';
  }
}

export class LayerAWriteBlocked extends Error {
  constructor(public readonly secretKind: string) {
    super(`Refused to store: contains secret-shaped value (kind: ${secretKind}). Remove the secret and retry. Vault entries should land in /connect, not memorize.`);
    this.name = 'LayerAWriteBlocked';
  }
}

export class RecallQueryMalformed extends Error {
  constructor(public readonly reason: string) {
    super(`Bad recall query: ${reason}.`);
    this.name = 'RecallQueryMalformed';
  }
}

export class MemoryEntryMalformed extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Layer A file ${path} is malformed: ${reason}. Move it aside and re-create.`);
    this.name = 'MemoryEntryMalformed';
  }
}
