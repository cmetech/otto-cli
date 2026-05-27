export type ParsedArgs =
  | { ok: true; target: string; workspace: string }
  | { ok: false; error: string };

const DEFAULT_WORKSPACE = "./.otto/excavate";

export interface ParseExcavateOptions {
  allowMissingTarget?: boolean;
}

// Parse `<target> [--workspace <dir>|--workspace=<dir>]`. Quotes are not
// required for the PoC-scale usage; tokens split on whitespace.
export function parseExcavateArgs(raw: string, options: ParseExcavateOptions = {}): ParsedArgs {
  const tokens = (raw ?? "").trim().split(/\s+/).filter(Boolean);
  let target: string | undefined;
  let workspace = DEFAULT_WORKSPACE;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "--workspace") {
      const v = tokens[++i];
      if (!v) return { ok: false, error: "--workspace requires a directory value" };
      workspace = v;
    } else if (t.startsWith("--workspace=")) {
      const v = t.slice("--workspace=".length);
      if (!v) return { ok: false, error: "--workspace requires a directory value" };
      workspace = v;
    } else if (!t.startsWith("-") && target === undefined) {
      target = t;
    }
  }

  if (!target && !options.allowMissingTarget) {
    return { ok: false, error: "excavate requires a target path: /otto excavate <path>" };
  }
  if (!target) target = "";
  return { ok: true, target, workspace };
}
