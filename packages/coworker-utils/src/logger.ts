// Lightweight logger wrapper. Spec §6.7.
// Defers to a sink callable so otto-cli can wire it to the existing logger
// without coworker-utils taking a direct dependency on otto-cli.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface LoggerOptions {
  level?: LogLevel;
  sink?: (line: string) => void;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(suffix: string): Logger;
}

const DEFAULT_SINK = (line: string): void => {
  // Phase 0: write to stderr; otto-cli will replace this sink at wire time.
  process.stderr.write(line + '\n');
};

export function createLogger(namespace: string, opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? 'info';
  const sink = opts.sink ?? DEFAULT_SINK;
  const threshold = LEVEL_ORDER[level];

  function emit(at: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_ORDER[at] < threshold) return;
    const ctxPart = ctx ? ' ' + JSON.stringify(ctx) : '';
    sink(`${new Date().toISOString()} ${at} ${namespace} ${msg}${ctxPart}`);
  }

  return {
    debug: (msg, ctx) => emit('debug', msg, ctx),
    info:  (msg, ctx) => emit('info', msg, ctx),
    warn:  (msg, ctx) => emit('warn', msg, ctx),
    error: (msg, ctx) => emit('error', msg, ctx),
    child: (suffix) => createLogger(`${namespace}.${suffix}`, { level, sink }),
  };
}
