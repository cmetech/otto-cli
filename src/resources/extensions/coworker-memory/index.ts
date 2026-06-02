// src/resources/extensions/coworker-memory/index.ts
//
// Coworker Memory extension entry point.
// For Phase 3 Task 13 this scaffold exports only the bundle factory; subsequent
// tasks will add memorize/recall tools, /memory commands, and session hooks
// alongside a default-export extension activator mirroring coworker-vault.
export { createMemoryBundle } from './memory-singleton.js';
export type { MemoryBundle, MemoryBundleOptions } from './memory-singleton.js';
