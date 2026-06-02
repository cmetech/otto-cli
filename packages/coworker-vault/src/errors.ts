// packages/coworker-vault/src/errors.ts
export class EngineNotFound extends Error {
  constructor(public readonly id: string) {
    super(`Unknown engine: ${id}. Available engines can be listed with /datasource list.`);
    this.name = 'EngineNotFound';
  }
}

export class EngineValidationError extends Error {
  constructor(public readonly yamlPath: string, public readonly issue: string) {
    super(`Engine ${yamlPath}: ${issue}`);
    this.name = 'EngineValidationError';
  }
}

export class VaultEntryNotFound extends Error {
  constructor(
    public readonly engine: string,
    public readonly entryName: string,
    public readonly searched: string[],
  ) {
    super(
      `Vault entry not found: ${engine}:${entryName}. Searched: ${searched.join(', ')}. Use /connect ${engine} ${entryName} to create.`,
    );
    this.name = 'VaultEntryNotFound';
  }
}

export class VaultEntryMalformed extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`Vault entry corrupt: ${path} (${reason}). Move it aside and re-create with /connect.`);
    this.name = 'VaultEntryMalformed';
  }
}

export class BindingRefMalformed extends Error {
  constructor(public readonly input: string) {
    super(`Bad binding: ${input}. Expected <engine>:<name>, e.g., jira:prod.`);
    this.name = 'BindingRefMalformed';
  }
}

export class BindingNotFound extends Error {
  constructor(public readonly ref: string) {
    super(
      `Vault binding not resolvable: ${ref}. The entry may have been removed. Use /datasource list to inspect.`,
    );
    this.name = 'BindingNotFound';
  }
}
