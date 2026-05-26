/**
 * Minimal Node.js import hook for running tests from dist-test/.
 *
 * esbuild with bundle:false preserves import specifiers verbatim, so compiled
 * .js files still import '../foo.ts'. This hook redirects those to '.js' so
 * Node can find the compiled output.
 *
 * Also redirects @otto bare imports to their compiled counterparts in dist-test.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const GIT_TEST_ENV_DIR = join(tmpdir(), `gsd-test-git-env-${process.pid}`);
mkdirSync(GIT_TEST_ENV_DIR, { recursive: true });
process.env.GIT_CONFIG_GLOBAL = join(GIT_TEST_ENV_DIR, 'global.gitconfig');
process.env.GIT_CONFIG_SYSTEM = join(GIT_TEST_ENV_DIR, 'system.gitconfig');
const gitTemplateDir = join(GIT_TEST_ENV_DIR, 'templates');
mkdirSync(join(gitTemplateDir, 'hooks'), { recursive: true });
mkdirSync(join(gitTemplateDir, 'info'), { recursive: true });
writeFileSync(join(gitTemplateDir, 'info', 'exclude'), '');
process.env.GIT_TEMPLATE_DIR = gitTemplateDir;

// dist-test root — everything compiled lands here
const DIST_TEST = new URL('../dist-test/', import.meta.url).href;

// Absolute paths to compiled @otto/* entry points
const OTTO_ALIASES = {
  '@otto/pi-coding-agent': new URL('../dist-test/packages/pi-coding-agent/src/index.js', import.meta.url).href,
  '@otto/pi-ai/oauth':     new URL('../dist-test/packages/pi-ai/src/utils/oauth/index.js', import.meta.url).href,
  '@otto/pi-ai':           new URL('../dist-test/packages/pi-ai/src/index.js', import.meta.url).href,
  '@otto/pi-agent-core':   new URL('../dist-test/packages/pi-agent-core/src/index.js', import.meta.url).href,
  '@otto/pi-tui':          new URL('../dist-test/packages/pi-tui/src/index.js', import.meta.url).href,
  '@otto/native':          new URL('../dist-test/packages/native/src/index.js', import.meta.url).href,
};

export function resolve(specifier, context, nextResolve) {
  // 1. @otto/* bare imports → compiled dist-test counterpart
  if (specifier in OTTO_ALIASES) {
    return nextResolve(OTTO_ALIASES[specifier], context);
  }

  // 2. .ts relative imports inside dist-test → .js
  if (
    specifier.endsWith('.ts') &&
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL &&
    context.parentURL.startsWith(DIST_TEST)
  ) {
    const jsSpecifier = specifier.slice(0, -3) + '.js';
    return nextResolve(jsSpecifier, context);
  }

  return nextResolve(specifier, context);
}
