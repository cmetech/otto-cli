// src/resources/extensions/coworker-vault/connect-command.ts
//
// Programmatic /connect wizard. Walks an engine's fields via a `promptProvider`
// callback, handles VAULT_KEEP sentinel for edits, validates required fields,
// and writes through LocalDataVault.set. No TUI dependencies — the TUI binding
// (clack/prompts) is wired separately and passes a clack-based provider.
import {
  mergeWithSentinel,
  assertNoSentinelInCreate,
  VAULT_KEEP,
  VaultEntryNotFound,
} from '@otto/coworker-vault';
import type { VaultBundle } from './vault-singleton.js';

export interface PromptFieldOptions {
  label: string;
  secret: boolean;
  required: boolean;
  defaultValue?: string;
}

export interface ConnectOptions {
  engineId: string;
  entryName: string;
  forceWorkspace: boolean;
  promptProvider: (field: string, opts: PromptFieldOptions) => Promise<string>;
}

export async function runConnect(bundle: VaultBundle, opts: ConnectOptions): Promise<void> {
  const engine = bundle.registry.require(opts.engineId);

  let existing: Record<string, string> | undefined;
  try {
    const got = await bundle.vault.get({ engine: opts.engineId, name: opts.entryName });
    existing = got.fields;
  } catch (err) {
    if (!(err instanceof VaultEntryNotFound)) throw err;
  }

  const submitted: Record<string, string> = {};
  for (const f of engine.fields) {
    const defaultValue = existing && f.secret
      ? VAULT_KEEP
      : (existing?.[f.name] ?? f.default ?? '');
    const value = await opts.promptProvider(f.name, {
      label: f.label,
      secret: f.secret,
      required: f.required,
      defaultValue,
    });
    if (f.required && value.trim() === '') {
      throw new Error(`Field "${f.name}" is required.`);
    }
    submitted[f.name] = value;
  }

  if (!existing) {
    assertNoSentinelInCreate(engine.fields, submitted);
  }
  const merged = existing
    ? mergeWithSentinel(engine.fields, existing, submitted)
    : submitted;

  await bundle.vault.set(
    { engine: opts.engineId, name: opts.entryName },
    merged,
    { forceWorkspace: opts.forceWorkspace },
  );
}
