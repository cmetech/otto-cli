// Brand strings are read from package.json piConfig at module load.
// Mirrors loader.ts's strategy — no compiled-module imports — so this stays
// fast for the loader's --help fast-path which runs before heavy imports.
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'
import { readFileSync } from 'fs'

const helpRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let BRAND = 'LOOP24'
let CMD = 'loop24'
let CONFIG_DIR = '.loop24'
let TAGLINE = 'compliant agent for developers'
try {
  const pkg = JSON.parse(readFileSync(join(helpRoot, 'package.json'), 'utf-8'))
  BRAND = pkg.piConfig?.brandName || BRAND
  CMD = pkg.piConfig?.commandNamespace || CMD
  CONFIG_DIR = pkg.piConfig?.configDir || CONFIG_DIR
} catch { /* fall back to defaults above */ }

const SUBCOMMAND_HELP: Record<string, string> = {
  config: [
    `Usage: ${CMD} config`,
    '',
    'Re-run the interactive setup wizard to configure:',
    '  - LLM provider (Anthropic, OpenAI, Google, OpenRouter, Ollama, LM Studio, etc.)',
    '  - Web search provider (Brave, Tavily, built-in)',
    '  - Remote questions (Discord, Slack, Telegram)',
    '  - Tool API keys (Context7, Jina, Groq)',
    '',
    'All steps are skippable and can be changed later with /login or /search-provider.',
    '',
    'For detailed provider setup instructions (OpenRouter, Ollama, LM Studio, vLLM,',
    'and other OpenAI-compatible endpoints), see docs/providers.md.',
  ].join('\n'),

  update: [
    `Usage: ${CMD} update`,
    '',
    `Update ${BRAND} to the latest version.`,
  ].join('\n'),

  upgrade: [
    `Usage: ${CMD} upgrade`,
    '',
    `Upgrade ${BRAND} to the latest version.`,
  ].join('\n'),

  sessions: [
    `Usage: ${CMD} sessions`,
    '',
    'List all saved sessions for the current directory and interactively',
    'pick one to resume. Shows date, message count, and a preview of the',
    'first message for each session.',
    '',
    'Sessions are stored per-directory, so you only see sessions that were',
    'started from the current working directory.',
    '',
    'Compare with --continue (-c) which always resumes the most recent session.',
  ].join('\n'),

  install: [
    `Usage: ${CMD} install <source> [-l, --local]`,
    '',
    'Install a package/extension source and run post-install validation (dependency checks, setup).',
    '',
    'Examples:',
    `  ${CMD} install npm:@foo/bar`,
    `  ${CMD} install git:github.com/user/repo`,
    `  ${CMD} install https://github.com/user/repo`,
    `  ${CMD} install ./local/path`,
  ].join('\n'),

  remove: [
    `Usage: ${CMD} remove <source> [-l, --local]`,
    '',
    'Remove an installed package source and its settings entry.',
  ].join('\n'),

  list: [
    `Usage: ${CMD} list`,
    '',
    'List installed package sources from user and project settings.',
  ].join('\n'),

  worktree: [
    `Usage: ${CMD} worktree <command> [args]`,
    '',
    'Manage isolated git worktrees for parallel work streams.',
    '',
    'Commands:',
    '  list                 List worktrees with status (files changed, commits, dirty)',
    '  merge [name]         Squash-merge a worktree into main and clean up',
    '  clean                Remove all worktrees that have been merged or are empty',
    '  remove <name>        Remove a worktree (--force to remove with unmerged changes)',
    '',
    'The -w flag creates/resumes worktrees for interactive sessions:',
    `  ${CMD} -w               Auto-name a new worktree, or resume the only active one`,
    `  ${CMD} -w my-feature    Create or resume a named worktree`,
    '',
    'Lifecycle:',
    `  1. ${CMD} -w             Create worktree, start session inside it`,
    '  2. (work normally)    All changes happen on the worktree branch',
    '  3. Ctrl+C             Exit — dirty work is auto-committed',
    `  4. ${CMD} -w             Resume where you left off`,
    `  5. ${CMD} worktree merge Squash-merge into main when done`,
    '',
    'Examples:',
    `  ${CMD} -w                              Start in a new auto-named worktree`,
    `  ${CMD} -w auth-refactor                Create/resume "auth-refactor" worktree`,
    `  ${CMD} worktree list                   See all worktrees and their status`,
    `  ${CMD} worktree merge auth-refactor    Merge and clean up`,
    `  ${CMD} worktree clean                  Remove all merged/empty worktrees`,
    `  ${CMD} worktree remove old-branch      Remove a specific worktree`,
    `  ${CMD} worktree remove old-branch --force  Remove even with unmerged changes`,
  ].join('\n'),

  graph: [
    `Usage: ${CMD} graph <subcommand> [options]`,
    '',
    `Manage the ${BRAND} project knowledge graph. Reads ${CONFIG_DIR}/ artifacts and builds`,
    'a queryable graph of milestones, slices, tasks, rules, patterns, and lessons.',
    '',
    'Subcommands:',
    `  build   Parse ${CONFIG_DIR}/ artifacts (STATE.md, milestone ROADMAPs, slice PLANs,`,
    `          KNOWLEDGE.md) and write ${CONFIG_DIR}/graphs/graph.json atomically.`,
    '  query   Search graph nodes by term (BFS from seed matches, budget-trimmed).',
    '          Returns matching nodes and reachable edges within the token budget.',
    '  status  Show whether graph.json exists, its age, node/edge counts, and',
    '          whether it is stale (built more than 24 hours ago).',
    '  diff    Compare current graph.json with .last-build-snapshot.json.',
    '          Returns added, removed, and changed nodes and edges.',
    '',
    'Examples:',
    `  ${CMD} graph build                        Build the graph from ${CONFIG_DIR}/ artifacts`,
    `  ${CMD} graph status                       Check graph age and node/edge counts`,
    `  ${CMD} graph query auth                   Find nodes related to "auth"`,
    `  ${CMD} graph diff                         Show changes since last snapshot`,
  ].join('\n'),

  headless: [
    `Usage: ${CMD} headless [flags] [command] [args...]`,
    '',
    `Run /${CMD} commands without the TUI. Default command: auto`,
    '',
    'Flags:',
    '  --timeout N            Overall timeout in ms (default: 300000)',
    '  --json                 JSONL event stream to stdout (alias for --output-format stream-json)',
    '  --output-format <fmt>  Output format: text (default), json (structured result), stream-json (JSONL events)',
    '  --bare                 Minimal context: skip CLAUDE.md, AGENTS.md, user settings, user skills',
    '  --resume <id>          Resume a prior headless session by ID',
    '  --model ID             Override model',
    '  --supervised           Forward interactive UI requests to orchestrator via stdout/stdin',
    '  --response-timeout N   Timeout (ms) for orchestrator response (default: 30000)',
    '  --answers <path>       Pre-supply answers and secrets (JSON file)',
    '  --events <types>       Filter JSONL output to specific event types (comma-separated)',
    '',
    'Commands:',
    '  auto                 Run all queued units continuously (default)',
    '  next                 Run one unit',
    '  status               Show progress dashboard',
    '  new-milestone        Create a milestone from a specification document',
    '  query                JSON snapshot: state + next dispatch + costs (no LLM)',
    '',
    'new-milestone flags:',
    '  --context <path>     Path to spec/PRD file (use \'-\' for stdin)',
    '  --context-text <txt> Inline specification text',
    '  --auto               Start auto-mode after milestone creation',
    '  --verbose            Show tool calls in progress output',
    '',
    'Output formats:',
    '  text         Human-readable progress on stderr (default)',
    '  json         Collect events silently, emit structured HeadlessJsonResult on stdout at exit',
    '  stream-json  Stream JSONL events to stdout in real time (same as --json)',
    '',
    'Examples:',
    `  ${CMD} headless                                    Run /${CMD} auto`,
    `  ${CMD} headless next                               Run one unit`,
    `  ${CMD} headless --output-format json auto           Structured JSON result on stdout`,
    `  ${CMD} headless --json status                      Machine-readable JSONL stream`,
    `  ${CMD} headless --timeout 60000                    With 1-minute timeout`,
    `  ${CMD} headless --bare auto                        Minimal context (CI/ecosystem use)`,
    `  ${CMD} headless --resume abc123 auto               Resume a prior session`,
    `  ${CMD} headless new-milestone --context spec.md    Create milestone from file`,
    `  cat spec.md | ${CMD} headless new-milestone --context -   From stdin`,
    `  ${CMD} headless new-milestone --context spec.md --auto    Create + auto-execute`,
    `  ${CMD} headless --supervised auto                     Supervised orchestrator mode`,
    `  ${CMD} headless --answers answers.json auto              With pre-supplied answers`,
    `  ${CMD} headless --events agent_end,extension_ui_request auto   Filtered event stream`,
    `  ${CMD} headless query                              Instant JSON state snapshot`,
    `  ${CMD} headless recover                            Reset hierarchy + validation/gates, then rebuild from markdown`,
    '',
    'Exit codes: 0 = success, 1 = error/timeout, 10 = blocked, 11 = cancelled',
  ].join('\n'),
}

// Alias: `<cmd> wt --help` → same as `<cmd> worktree --help`
SUBCOMMAND_HELP['wt'] = SUBCOMMAND_HELP['worktree']

export function printHelp(version: string): void {
  process.stdout.write(`${BRAND} v${version} — ${TAGLINE}\n\n`)
  process.stdout.write(`Usage: ${CMD} [options] [message...]\n\n`)
  process.stdout.write('Options:\n')
  process.stdout.write('  --mode <text|json|rpc|mcp> Output mode (default: interactive)\n')
  process.stdout.write('  --print, -p              Single-shot print mode\n')
  process.stdout.write('  --continue, -c           Resume the most recent session\n')
  process.stdout.write('  --worktree, -w [name]    Start in an isolated worktree (auto-named if omitted)\n')
  process.stdout.write('  --model <id>             Override model (e.g. provider/model-id)\n')
  process.stdout.write('  --no-session             Disable session persistence\n')
  process.stdout.write('  --extension <path>       Load additional extension\n')
  process.stdout.write('  --tools <a,b,c>          Restrict available tools\n')
  process.stdout.write('  --list-models [search]   List available models and exit\n')
  process.stdout.write('  --version, -v            Print version and exit\n')
  process.stdout.write('  --help, -h               Print this help and exit\n')
  process.stdout.write('\nSubcommands:\n')
  process.stdout.write('  config [subject]         Configure services: gateway, langflow, llm, all (or interactive menu)\n')
  process.stdout.write('  install <source>         Install a package/extension source\n')
  process.stdout.write('  remove <source>          Remove an installed package source\n')
  process.stdout.write('  list                     List installed package sources\n')
  process.stdout.write(`  update                   Update ${BRAND} to the latest version\n`)
  process.stdout.write('  upgrade                  Alias for update\n')
  process.stdout.write('  sessions                 List and resume a past session\n')
  process.stdout.write('  worktree <cmd>           Manage worktrees (list, merge, clean, remove)\n')
  process.stdout.write('  auto [args]              Run auto-mode without TUI (pipeable)\n')
  process.stdout.write(`  headless [cmd] [args]    Run /${CMD} commands without TUI (default: auto)\n`)
  process.stdout.write('  graph <subcommand>       Manage knowledge graph (build, query, status, diff)\n')
  process.stdout.write(`\nRun ${CMD} <subcommand> --help for subcommand-specific help.\n`)
}

export function printSubcommandHelp(subcommand: string, version: string): boolean {
  const help = SUBCOMMAND_HELP[subcommand]
  if (!help) return false
  process.stdout.write(`${BRAND} v${version} — ${TAGLINE}\n\n`)
  process.stdout.write(help + '\n')
  return true
}
