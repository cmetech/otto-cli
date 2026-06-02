// src/resources/extensions/coworker-vault/test-helpers.ts
//
// Shared fake ExtensionAPI used by the coworker-vault, coworker-memory, and
// (eventually) cross-extension integration tests. Captures every command +
// tool registration + event handler so tests can fire lifecycle events and
// inspect ui.notify calls.
import type {
  ExtensionAPI, ExtensionContext, ExtensionCommandContext, RegisteredCommand,
  SessionStartEvent, SessionShutdownEvent, BeforeAgentStartEvent, AgentStartEvent,
  ToolDefinition,
} from '@otto/pi-coding-agent';

export interface NotifyCall {
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
}

export interface FakeApi {
  api: ExtensionAPI;
  commands: Map<string, RegisteredCommand>;
  tools: Map<string, ToolDefinition>;
  handlers: Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown>>;
  notifyCalls: NotifyCall[];
  ctx: ExtensionContext;
  commandCtx: ExtensionCommandContext;
}

export function makeFakeApi(): FakeApi {
  const commands = new Map<string, RegisteredCommand>();
  const tools = new Map<string, ToolDefinition>();
  const handlers = new Map<string, Array<(event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown>>();
  const notifyCalls: NotifyCall[] = [];

  const ui = {
    notify: (message: string, level?: 'info' | 'warning' | 'error' | 'success'): void => {
      notifyCalls.push({ message, level: level ?? 'info' });
    },
    confirm: async (): Promise<boolean> => true,
    input: async (): Promise<string | undefined> => '',
    select: async (): Promise<string | string[] | undefined> => undefined,
  } as unknown as ExtensionContext['ui'];

  const ctx = {
    cwd: '/tmp',
    hasUI: true,
    ui,
    sessionManager: {
      getSessionFile: (): string | undefined => '/tmp/session.jsonl',
    },
    isIdle: (): boolean => true,
    abort: (): void => {},
    hasPendingMessages: (): boolean => false,
    shutdown: (): void => {},
    getContextUsage: (): undefined => undefined,
    compact: (): void => {},
    getSystemPrompt: (): string => '',
    setCompactionThresholdOverride: (): void => {},
  } as unknown as ExtensionContext;

  const commandCtx = ctx as unknown as ExtensionCommandContext;

  const api = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown): void {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    },
    registerCommand(name: string, options: Omit<RegisteredCommand, 'name'>): void {
      commands.set(name, { name, ...options });
    },
    registerTool(tool: ToolDefinition): void {
      tools.set(tool.name, tool);
    },
    sendMessage(): void {},
  } as unknown as ExtensionAPI;

  return { api, commands, tools, handlers, notifyCalls, ctx, commandCtx };
}

export async function fireSessionStart(fake: FakeApi, opts: { cwd: string }): Promise<void> {
  const evt: SessionStartEvent = { type: 'session_start' };
  // Mutate the fake.ctx so handlers see the requested cwd.
  (fake.ctx as { cwd: string }).cwd = opts.cwd;
  const list = fake.handlers.get('session_start') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}

export async function fireSessionShutdown(fake: FakeApi): Promise<void> {
  const evt: SessionShutdownEvent = { type: 'session_shutdown' };
  const list = fake.handlers.get('session_shutdown') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}

export async function fireBeforeAgentStart(
  fake: FakeApi,
  prompt: string,
  systemPrompt: string,
): Promise<{ systemPrompt?: string } | undefined> {
  const evt: BeforeAgentStartEvent = { type: 'before_agent_start', prompt, systemPrompt };
  const list = fake.handlers.get('before_agent_start') ?? [];
  let result: { systemPrompt?: string } | undefined;
  for (const h of list) {
    const r = await h(evt, fake.ctx);
    if (r && typeof r === 'object' && 'systemPrompt' in r) {
      result = r as { systemPrompt?: string };
    }
  }
  return result;
}

export async function fireAgentStart(
  fake: FakeApi,
  sessionId: string,
  turnId: string,
): Promise<void> {
  const evt: AgentStartEvent = { type: 'agent_start', sessionId, turnId };
  const list = fake.handlers.get('agent_start') ?? [];
  for (const h of list) await h(evt, fake.ctx);
}
