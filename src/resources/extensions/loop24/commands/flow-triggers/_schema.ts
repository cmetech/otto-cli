/**
 * Declarative flow-trigger command schema.
 *
 * Hand-rolled validator — no external dep. The schema is small enough
 * to enumerate by hand and clearer than a zod/typebox declaration
 * for someone reading the file for the first time.
 */

export interface FlowTrigger {
  name: string;                            // slash-command name (no spaces; e.g. "analyze-logs")
  description: string;                     // shown in /loop24 autocomplete
  flow: { id?: string; name?: string };    // one or the other; id wins if both present
  server?: string;                         // optional override; falls back to LANGFLOW_SERVER_URL env
  inputs: FlowTriggerInput[];
  execution?: {
    mode?: "stream" | "poll" | "fire-and-forget"; // default: "poll"
    timeoutMs?: number;                            // default: 300000 (5 min)
  };
  output?: {
    format?: "markdown" | "json" | "raw";          // default: "markdown"
    render?: "inline" | "file" | "both";           // default: "inline"
  };
}

export interface FlowTriggerInput {
  name: string;                            // arg name in the slash command (--name value)
  type: "string" | "number" | "bool" | "file";
  required?: boolean;                      // default false
  default?: string | number | boolean;
  flowField: string;                       // field name in LangFlow flow's input shape
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VALID_INPUT_TYPES = new Set(["string", "number", "bool", "file"]);
const VALID_MODES = new Set(["stream", "poll", "fire-and-forget"]);
const VALID_FORMATS = new Set(["markdown", "json", "raw"]);
const VALID_RENDERS = new Set(["inline", "file", "both"]);

export function validateFlowTrigger(raw: unknown): ValidationResult<FlowTrigger> {
  const errs: string[] = [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["root must be an object"] };
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string") errs.push("name: missing or not a string");
  else if (!NAME_PATTERN.test(r.name)) errs.push(`name: must match ${NAME_PATTERN} (lowercase, digits, hyphens)`);

  if (typeof r.description !== "string") errs.push("description: missing or not a string");

  if (r.flow === null || typeof r.flow !== "object") errs.push("flow: missing or not an object");
  else {
    const f = r.flow as Record<string, unknown>;
    if (typeof f.id !== "string" && typeof f.name !== "string") {
      errs.push("flow: must have either .id or .name");
    }
  }

  if (r.server !== undefined && typeof r.server !== "string") errs.push("server: must be a string when present");

  if (!Array.isArray(r.inputs)) errs.push("inputs: missing or not an array");
  else {
    r.inputs.forEach((inp, i) => {
      if (inp === null || typeof inp !== "object") {
        errs.push(`inputs[${i}]: must be an object`);
        return;
      }
      const ip = inp as Record<string, unknown>;
      if (typeof ip.name !== "string") errs.push(`inputs[${i}].name: missing or not a string`);
      if (typeof ip.type !== "string" || !VALID_INPUT_TYPES.has(ip.type)) {
        errs.push(`inputs[${i}].type: must be one of ${[...VALID_INPUT_TYPES].join("|")}`);
      }
      if (typeof ip.flowField !== "string") errs.push(`inputs[${i}].flowField: missing or not a string`);
    });
  }

  if (r.execution !== undefined) {
    if (r.execution === null || typeof r.execution !== "object") errs.push("execution: must be an object when present");
    else {
      const ex = r.execution as Record<string, unknown>;
      if (ex.mode !== undefined && (typeof ex.mode !== "string" || !VALID_MODES.has(ex.mode))) {
        errs.push(`execution.mode: must be one of ${[...VALID_MODES].join("|")}`);
      }
      if (ex.timeoutMs !== undefined && (typeof ex.timeoutMs !== "number" || ex.timeoutMs <= 0)) {
        errs.push("execution.timeoutMs: must be a positive number");
      }
    }
  }

  if (r.output !== undefined) {
    if (r.output === null || typeof r.output !== "object") errs.push("output: must be an object when present");
    else {
      const o = r.output as Record<string, unknown>;
      if (o.format !== undefined && (typeof o.format !== "string" || !VALID_FORMATS.has(o.format))) {
        errs.push(`output.format: must be one of ${[...VALID_FORMATS].join("|")}`);
      }
      if (o.render !== undefined && (typeof o.render !== "string" || !VALID_RENDERS.has(o.render))) {
        errs.push(`output.render: must be one of ${[...VALID_RENDERS].join("|")}`);
      }
    }
  }

  if (errs.length > 0) return { ok: false, errors: errs };
  return { ok: true, value: r as unknown as FlowTrigger };
}
