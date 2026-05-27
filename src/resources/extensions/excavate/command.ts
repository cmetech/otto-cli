import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseExcavateArgs } from "./args.js";
import { resolveSkillPaths } from "./paths.js";
import { buildPlaybook } from "./playbook.js";

type ExecFileSync = typeof execFileSync;

let execFileSyncForGit: ExecFileSync = execFileSync;

export function _setExecFileSyncForTest(fn: ExecFileSync): () => void {
  const previous = execFileSyncForGit;
  execFileSyncForGit = fn;
  return () => {
    execFileSyncForGit = previous;
  };
}

interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

export function getExcavateArgumentCompletions(prefix: string): CompletionItem[] {
  const options = [
    {
      value: ".",
      label: ".",
      description: "Excavate the current directory",
    },
    {
      value: "--workspace ./.otto/excavate",
      label: "--workspace",
      description: "Write excavation artifacts to a custom workspace directory",
    },
  ];
  const current = (prefix ?? "").trimStart();
  if (!current || current.startsWith("-")) {
    return options.filter((option) => option.value.startsWith(current) || option.label.startsWith(current));
  }
  return [];
}

function commandCwd(ctx: ExtensionCommandContext): string {
  if (ctx.cwd) return ctx.cwd;
  try {
    return process.cwd();
  } catch {
    return ".";
  }
}

function resolveGitRoot(cwd: string): string | null {
  try {
    return execFileSyncForGit("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function isGitAvailable(cwd: string): boolean {
  try {
    execFileSyncForGit("git", ["--version"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

export async function handleExcavateCommand(
  args: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<void> {
  const rawArgs = typeof args === "string" ? args : "";
  const parsed = parseExcavateArgs(rawArgs, { allowMissingTarget: true });
  if (!parsed.ok) {
    ctx.ui.notify(parsed.error, "error");
    return;
  }
  const hasExplicitTarget = parsed.target.trim().length > 0;
  const cwd = commandCwd(ctx);
  const gitAvailable = isGitAvailable(cwd);
  let target = parsed.target;
  let workspace = parsed.workspace;

  if (!hasExplicitTarget) {
    if (!gitAvailable) {
      ctx.ui.notify(
        "Git was not found, so OTTO cannot infer the current repository root. Run /otto excavate <path> to choose a target explicitly.",
        "error",
      );
      return;
    }
    const gitRoot = resolveGitRoot(cwd);
    if (!gitRoot) {
      ctx.ui.notify(
        "excavate requires a target path when the current directory is not inside a Git repository: /otto excavate <path>",
        "error",
      );
      return;
    }

    target = gitRoot;
    workspace = join(gitRoot, ".otto", "excavate");
    const confirmed = await ctx.ui.confirm(
      "Run Excavation",
      [
        "No target path was provided. Use the current Git repository?",
        "",
        `Target: ${target}`,
        `Workspace: ${workspace}`,
      ].join("\n"),
    );
    if (!confirmed) {
      ctx.ui.notify("Excavation cancelled.", "info");
      return;
    }
  }

  if (!gitAvailable) {
    ctx.ui.notify(
      [
        "Git was not found. Excavation will run without workspace commits.",
        `Artifacts will still be written to ${workspace}.`,
        "Stage history will be recorded in provenance/stage-log.jsonl instead of Git commits.",
        "Install Git to enable checkpoint commits.",
      ].join("\n"),
      "warning",
    );
  }

  const playbook = buildPlaybook({
    target,
    workspace,
    skillPaths: resolveSkillPaths(),
    gitMode: gitAvailable ? "git" : "no-git",
  });
  // sendUserMessage always triggers a turn; the agent then executes the playbook.
  pi.sendUserMessage(playbook);
}

export default function registerExcavate(pi: ExtensionAPI): void {
  pi.registerCommand("excavate", {
    description: "Reverse-engineer a codebase into provenance-cited behavioral specs",
    getArgumentCompletions: getExcavateArgumentCompletions,
    handler: async (args: string, ctx: ExtensionCommandContext) => handleExcavateCommand(args, ctx, pi),
  });
}
