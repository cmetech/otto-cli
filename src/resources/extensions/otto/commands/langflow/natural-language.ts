import type { LangFlowToolAction } from "../../tools/langflow.js";

export interface LangFlowNaturalLanguageIntent {
  action: LangFlowToolAction;
  flow?: string;
  prefix?: string;
  file?: string;
  input?: string;
  description?: string;
  overwrite?: boolean;
  update?: boolean;
  replace?: boolean;
  createNew?: boolean;
  confirmDelete?: boolean;
}

function cleanToken(value: string | undefined): string | undefined {
  const cleaned = value?.trim().replace(/^["'`]+|["'`.,!?]+$/g, "");
  return cleaned || undefined;
}

function mentionsLangFlow(text: string): boolean {
  return /\blang\s*flow\b/i.test(text) || /\blangflow\b/i.test(text);
}

function extractPrefix(text: string): string | undefined {
  return cleanToken(
    /\b(?:starting with|starts with|prefix(?:ed)?(?: by| with)?|named like)\s+([A-Za-z0-9_.-]+)/i.exec(text)?.[1],
  );
}

function extractAfter(text: string, pattern: RegExp): string | undefined {
  return cleanToken(pattern.exec(text)?.[1]);
}

export function parseLangFlowNaturalLanguage(text: string): LangFlowNaturalLanguageIntent | undefined {
  const input = text.trim();
  if (!input || !mentionsLangFlow(input)) return undefined;

  if (/\b(list|show|see|display)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    return { action: "list_flows", prefix: extractPrefix(input) };
  }

  if (/\b(status|health|connected|connection)\b/i.test(input)) {
    return { action: "status" };
  }

  if (/\b(build|create|generate|make)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    return { action: "build_flow", description: input };
  }

  if (/\b(import|load)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    const file = extractAfter(input, /\b(?:from|file)\s+(\S+)/i) ?? extractAfter(input, /\bimport\s+(\S+)/i);
    return {
      action: "import_flow",
      file,
      update: /\b(update|re-import|reimport|overwrite)\b/i.test(input),
      replace: /\b(replace|remove and import|delete and import)\b/i.test(input),
      createNew: /\b(new copy|as new|create new)\b/i.test(input),
    };
  }

  if (/\b(export|save)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    const flow = extractAfter(input, /\b(?:flow|named)\s+([A-Za-z0-9_.-]+)/i) ?? extractAfter(input, /\bexport\s+([A-Za-z0-9_.-]+)/i);
    return { action: "export_flow", flow, overwrite: /\b(overwrite|replace)\b/i.test(input) };
  }

  if (/\b(delete|remove)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    const flow = extractAfter(input, /\b(?:flow|named)\s+([A-Za-z0-9_.-]+)/i) ?? extractAfter(input, /\b(?:delete|remove)\s+([A-Za-z0-9_.-]+)/i);
    return { action: "delete_flow", flow, confirmDelete: true };
  }

  if (/\b(run|execute)\b/i.test(input) && /\bflows?\b/i.test(input)) {
    const flow = extractAfter(input, /\b(?:flow|named)\s+([A-Za-z0-9_.-]+)/i) ?? extractAfter(input, /\b(?:run|execute)\s+([A-Za-z0-9_.-]+)/i);
    const runInput = extractAfter(input, /\b(?:with|input|message)\s+(.+)$/i);
    return { action: "run_flow", flow, input: runInput };
  }

  return undefined;
}
