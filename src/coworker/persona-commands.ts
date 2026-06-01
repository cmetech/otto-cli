// /persona slash-command handlers now live in @otto/coworker-persona so they
// can be imported from inside the src/resources extension boundary (which is
// compiled with rootDir: src/resources and cannot import from src/ directly).
// Re-exported here for the co-located unit test and external callers.
export {
  handleList,
  handleCurrent,
  handleSwitch,
  handleReset,
  handleInstall,
  handleUninstall,
} from '@otto/coworker-persona';
