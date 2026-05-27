export interface ParsedLangFlowCommand {
  action: string;
  rest: string;
}

export function parseLangFlowCommand(input: string): ParsedLangFlowCommand {
  const trimmed = input.trim();
  if (!trimmed) return { action: "status", rest: "" };
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return { action: "status", rest: "" };
  return {
    action: match[1].toLowerCase(),
    rest: (match[2] ?? "").trim(),
  };
}

export function splitFirstArg(input: string): { first: string; rest: string } {
  const trimmed = input.trim();
  if (!trimmed) return { first: "", rest: "" };
  const quoted = trimmed.match(/^"([^"]+)"(?:\s+([\s\S]*))?$/);
  if (quoted) return { first: quoted[1], rest: (quoted[2] ?? "").trim() };
  const singleQuoted = trimmed.match(/^'([^']+)'(?:\s+([\s\S]*))?$/);
  if (singleQuoted) return { first: singleQuoted[1], rest: (singleQuoted[2] ?? "").trim() };
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return { first: match?.[1] ?? "", rest: (match?.[2] ?? "").trim() };
}
