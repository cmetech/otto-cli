/**
 * Reader for ~/.otto/settings.json — user-scoped, non-project settings.
 *
 * Never throws. Returns null on missing file, malformed JSON, missing key, or
 * any I/O error. Callers fall back to env vars / project prefs / defaults.
 *
 * The home directory is resolvable via the homeOverride option for tests.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ReadUserSettingOptions {
  /** Override homedir() for tests. */
  homeOverride?: string;
}

export function readUserSetting<T>(
  keyPath: string,
  opts: ReadUserSettingOptions = {},
): T | null {
  const home = opts.homeOverride ?? homedir();
  const file = join(home, ".otto", "settings.json");
  if (!existsSync(file)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return null;
  }

  const segments = keyPath.split(".");
  let cursor: unknown = parsed;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[segment];
    if (cursor === undefined) return null;
  }
  return cursor as T;
}
