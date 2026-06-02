// src/resources/extensions/coworker-vault/index.ts
//
// Coworker Vault extension entry point.
// For Phase 2 Task 8 this scaffold exports only the bundle factory; subsequent
// tasks will add /connect, /datasource, /audit command registration alongside
// a default-export extension activator that mirrors coworker-scratchpad.
export { createVaultBundle } from './vault-singleton.js';
export type { VaultBundle, VaultBundleOptions } from './vault-singleton.js';
