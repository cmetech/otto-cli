import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface LangFlowConfig {
  url: string;
  apiKey: string | null;
  enabled: boolean;
}

const DEFAULT_LANGFLOW_CONFIG: LangFlowConfig = {
  url: "http://127.0.0.1:7860",
  apiKey: null,
  enabled: false,
};

function configPath(): string {
  const root = process.env.OTTO_HOME || homedir();
  return join(root, ".otto", "config.json");
}

function readRawConfig(): Record<string, unknown> {
  try {
    const raw = JSON.parse(readFileSync(configPath(), "utf-8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function loadLangFlowConfig(): LangFlowConfig {
  const raw = readRawConfig();
  const lf = raw.langflow && typeof raw.langflow === "object" && !Array.isArray(raw.langflow)
    ? raw.langflow as Partial<LangFlowConfig>
    : {};
  return {
    url: typeof lf.url === "string" && lf.url.trim() ? lf.url.trim() : DEFAULT_LANGFLOW_CONFIG.url,
    apiKey: typeof lf.apiKey === "string" && lf.apiKey.trim() ? lf.apiKey.trim() : DEFAULT_LANGFLOW_CONFIG.apiKey,
    enabled: typeof lf.enabled === "boolean" ? lf.enabled : DEFAULT_LANGFLOW_CONFIG.enabled,
  };
}

export function effectiveLangFlowConfig(): LangFlowConfig {
  const cfg = loadLangFlowConfig();
  return {
    url: process.env.LANGFLOW_SERVER_URL?.trim() || cfg.url,
    apiKey: process.env.LANGFLOW_API_KEY?.trim() || cfg.apiKey,
    enabled: process.env.OTTO_LANGFLOW_DISABLED?.trim() === "1" ? false : cfg.enabled,
  };
}

export function saveLangFlowConfig(langflow: LangFlowConfig): void {
  const path = configPath();
  const raw = readRawConfig();
  const next = {
    gateway: raw.gateway ?? { url: null, token: null },
    ...raw,
    langflow,
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}
