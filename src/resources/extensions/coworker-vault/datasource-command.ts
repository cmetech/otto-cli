// src/resources/extensions/coworker-vault/datasource-command.ts
//
// Programmatic /datasource list|remove|test commands. `edit` is wired at the
// routing layer (Task 16) as an alias for runConnect and does not need its own
// function here. No TUI dependencies.
import { LocalDataVault, envVarName } from '@otto/coworker-vault';
import type { VaultBundle } from './vault-singleton.js';

export interface ListedField {
  name: string;
  secret: boolean;
  display: string;
}

export interface ListedRow {
  engine: string;
  name: string;
  scope: 'global' | 'workspace';
  fields: ListedField[];
  last_modified_at: string;
}

export async function runDatasourceList(
  bundle: VaultBundle,
  filter: { engine?: string },
): Promise<ListedRow[]> {
  const all = await bundle.vault.list();
  const out: ListedRow[] = [];
  for (const row of all) {
    if (filter.engine && row.engine !== filter.engine) continue;
    const engine = bundle.registry.get(row.engine);
    let fields: ListedField[] = [];
    if (engine) {
      const entry = await bundle.vault.get({ engine: row.engine, name: row.name });
      fields = engine.fields
        .map((f) => ({
          name: f.name,
          secret: f.secret,
          display: f.secret ? '••••••' : (entry.fields[f.name] ?? ''),
        }))
        .filter((f) => row.fields_set.includes(f.name));
    } else {
      fields = row.fields_set.map((n) => ({ name: n, secret: false, display: '' }));
    }
    out.push({
      engine: row.engine,
      name: row.name,
      scope: row.scope,
      fields,
      last_modified_at: row.last_modified_at,
    });
  }
  return out;
}

export async function runDatasourceRemove(
  bundle: VaultBundle,
  args: { ref: string },
): Promise<void> {
  const ref = LocalDataVault.parseRef(args.ref);
  await bundle.vault.remove(ref);
}

export interface TestPreview {
  ref: string;
  engine: string;
  envVarNames: string[];
}

export async function runDatasourceTest(
  bundle: VaultBundle,
  args: { ref: string },
): Promise<TestPreview> {
  const ref = LocalDataVault.parseRef(args.ref);
  const entry = await bundle.vault.get(ref);
  return {
    ref: args.ref,
    engine: ref.engine,
    envVarNames: Object.keys(entry.fields).map((f) => envVarName(ref.engine, ref.name, f)),
  };
}
