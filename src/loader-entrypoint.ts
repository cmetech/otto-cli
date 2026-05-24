// LOOP24 - Loader child-process entrypoint resolution helpers.

import { existsSync as defaultExistsSync } from "node:fs"
import { join, resolve } from "node:path"

export interface LoaderEntrypointOptions {
  workflowRoot: string
  invokedBinPath: string | undefined
  env?: NodeJS.ProcessEnv
  existsSync?: (path: string) => boolean
}

export function resolveLoaderCliEntrypoint({
  workflowRoot,
  invokedBinPath,
  env = process.env,
  existsSync = defaultExistsSync,
}: LoaderEntrypointOptions): string | undefined {
  const sourceLoaderPath = join(workflowRoot, "src", "loader.ts")
  const devCliPath = env.GSD_DEV_CLI_PATH?.trim() || join(workflowRoot, "scripts", "dev-cli.js")
  const explicitCliPath = env.GSD_CLI_PATH?.trim() || (env.LOOP24_BIN_PATH ?? env.GSD_BIN_PATH)?.trim()
  const isSourceLoader = Boolean(invokedBinPath && resolve(invokedBinPath) === sourceLoaderPath)
  const rawWorkflowBinPath = explicitCliPath || (isSourceLoader && existsSync(devCliPath) ? devCliPath : invokedBinPath)
  return rawWorkflowBinPath ? resolve(rawWorkflowBinPath) : undefined
}

export function applyLoaderCliEntrypointEnv(env: NodeJS.ProcessEnv, options: LoaderEntrypointOptions): string | undefined {
  const resolvedWorkflowBinPath = resolveLoaderCliEntrypoint({ ...options, env })
  if (resolvedWorkflowBinPath) {
    env.LOOP24_BIN_PATH = resolvedWorkflowBinPath
    env.GSD_BIN_PATH = resolvedWorkflowBinPath
    if (!env.GSD_CLI_PATH) {
      env.GSD_CLI_PATH = resolvedWorkflowBinPath
    }
  } else {
    delete env.LOOP24_BIN_PATH
    delete env.GSD_BIN_PATH
    if (!env.GSD_CLI_PATH) {
      delete env.GSD_CLI_PATH
    }
  }
  return resolvedWorkflowBinPath
}
