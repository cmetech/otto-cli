// Vault types. See spec §2.2.

export interface EngineField {
  name: string;
  secret: boolean;            // true → uses VAULT_KEEP sentinel on round-trip
  description?: string;
  default?: string;
  name_from?: boolean;        // if true, used to auto-name the entry
}

export interface EngineDef {
  slug: string;
  display_name: string;
  pip: string | null;          // for parity with Anton's YAML; null when not applicable
  fields: EngineField[];
  auth_methods: string[];
  test_snippet?: string;
  popular?: boolean;
  custom?: boolean;
}

export interface VaultEntry {
  engine: string;             // engine slug
  name: string;               // user-chosen, sanitized
  values: Record<string, string>;
  secure_keys: string[];      // fields that should never be logged or echoed
  created_at: string;
  updated_at?: string;
}

export interface BoundClient<TClient = unknown> {
  engine: string;
  name: string;
  client: TClient;
}

export interface CredentialInjector {
  injectEnv(processEnv: NodeJS.ProcessEnv, vaultEntries: string[]): NodeJS.ProcessEnv;
  loadForBinding<TClient = unknown>(serviceName: string): Promise<BoundClient<TClient> | null>;
}
