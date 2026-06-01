import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV_ALLOW = new Set([
  'PATH', 'HOME', 'TERM', 'SHELL', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'PWD', 'USER', 'LOGNAME',
]);
const ENV_ALLOW_PREFIXES = ['LC_', 'XDG_', 'OTTO_', 'NODE_'];
const ENV_DENY = new Set([
  'LOOP24_GATEWAY_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN',
]);

export function filterEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (ENV_DENY.has(key)) continue; // denylist overrides any allow-rule
    if (ENV_ALLOW.has(key) || ENV_ALLOW_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  return out;
}

const FORWARD_FLAGS_WITH_VALUE = new Set([
  '--import', '--loader', '--experimental-loader', '--require', '-r', '--conditions',
]);
const FORWARD_FLAGS_BOOLEAN = new Set([
  '--experimental-strip-types', '--experimental-transform-types', '--no-warnings',
]);

export function kernelExecArgv(execArgv: string[] = process.execArgv): string[] {
  const out: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i];
    const eq = arg.indexOf('=');
    const flag = eq >= 0 ? arg.slice(0, eq) : arg;
    if (FORWARD_FLAGS_WITH_VALUE.has(flag)) {
      out.push(arg);
      if (eq < 0 && i + 1 < execArgv.length) out.push(execArgv[++i]);
    } else if (FORWARD_FLAGS_BOOLEAN.has(flag)) {
      out.push(arg);
    }
    // Everything else (--test, --watch, --test-*, …) is dropped.
  }
  return out;
}

export function resolveKernelEntry(): string {
  const js = fileURLToPath(new URL('./kernel-entry.js', import.meta.url));
  if (existsSync(js)) return js;
  return fileURLToPath(new URL('./kernel-entry.ts', import.meta.url));
}
