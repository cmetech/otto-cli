/**
 * LangFlow HTTP client.
 *
 * Targets the API shape documented in clients/LANGFLOW-API.md.
 * Uses Node 22+ built-in fetch — no axios.
 *
 * Auth: optional. When apiKey is provided, sent as `x-api-key` header.
 * Timeout: configurable per-method; getVersion defaults to a short
 * 1500ms because it runs on the loader banner hot path.
 */

export interface LangFlowClientOptions {
  baseUrl: string;       // e.g. "http://127.0.0.1:7860"
  apiKey?: string;       // optional; omitted if absent
  timeoutMs?: number;    // default per-request fallback
}

export interface LangFlowVersion {
  version: string;
  main_version?: string;
  package?: string;
}

export interface RunFlowInput {
  input_value: string;
  output_type?: string;   // default "chat"
  input_type?: string;    // default "chat"
  tweaks?: Record<string, unknown>;
}

export interface RunFlowResult {
  text: string;
  raw: unknown;           // entire response envelope, for callers that need it
}

export interface LangFlowSummary {
  id: string;
  name: string;
  endpointName?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class LangFlowClient {
  private readonly opts: LangFlowClientOptions;

  constructor(opts: LangFlowClientOptions) {
    this.opts = opts;
  }

  /**
   * Probe LangFlow version. Returns null on any failure (offline, timeout,
   * non-2xx, bad JSON). Used by the loader banner — should never throw.
   */
  async getVersion(timeoutMsOverride?: number): Promise<LangFlowVersion | null> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? 1500;
    try {
      const res = await this._fetch(`${this.opts.baseUrl}/api/v1/version`, { method: "GET" }, timeoutMs);
      if (!res.ok) return null;
      return (await res.json()) as LangFlowVersion;
    } catch {
      return null;
    }
  }

  /**
   * Trigger a flow by ID. Throws on non-2xx with status + response body in
   * the error message. Returns parsed result with extracted text.
   */
  async runFlow(flowId: string, input: RunFlowInput, timeoutMsOverride?: number): Promise<RunFlowResult> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(
      `${this.opts.baseUrl}/api/v1/run/${encodeURIComponent(flowId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
      timeoutMs,
    );
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
    return {
      text: this._extractText(raw),
      raw,
    };
  }

  /**
   * List flows currently known to the LangFlow server. Normalizes only the
   * fields OTTO needs for display and name/endpoint resolution.
   */
  async listFlows(timeoutMsOverride?: number): Promise<LangFlowSummary[]> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(`${this.opts.baseUrl}/api/v1/flows/`, { method: "GET" }, timeoutMs);
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow flows: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow flows: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const record = item as { id?: unknown; name?: unknown; endpoint_name?: unknown; endpointName?: unknown };
      if (typeof record.id !== "string" || typeof record.name !== "string") return [];
      const endpointName =
        typeof record.endpoint_name === "string" ? record.endpoint_name :
        typeof record.endpointName === "string" ? record.endpointName :
        undefined;
      return [{ id: record.id, name: record.name, endpointName }];
    });
  }

  async getFlow(flowId: string, timeoutMsOverride?: number): Promise<unknown> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(`${this.opts.baseUrl}/api/v1/flows/${encodeURIComponent(flowId)}`, { method: "GET" }, timeoutMs);
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow get: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow get: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
  }

  /**
   * Import a flow into LangFlow by POSTing its JSON definition.
   * Endpoint: POST /api/v1/flows/  (JSON body — distinct from the
   * /api/v1/flows/upload/ multipart endpoint used by the bundled
   * import_flow.py script).
   *
   * Throws on non-2xx with status + response body in the error message.
   * Returns the parsed JSON response (typically the created flow record
   * with its newly-assigned id).
   */
  async importFlow(payload: unknown, timeoutMsOverride?: number): Promise<unknown> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(
      `${this.opts.baseUrl}/api/v1/flows/`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow import: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow import: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
  }

  async updateFlow(flowId: string, payload: unknown, timeoutMsOverride?: number): Promise<unknown> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(
      `${this.opts.baseUrl}/api/v1/flows/${encodeURIComponent(flowId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
      timeoutMs,
    );
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow update: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    try {
      return JSON.parse(bodyText);
    } catch {
      throw new Error(`langflow update: response was not JSON — ${bodyText.slice(0, 200)}`);
    }
  }

  async deleteFlow(flowId: string, timeoutMsOverride?: number): Promise<unknown> {
    const timeoutMs = timeoutMsOverride ?? this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const res = await this._fetch(`${this.opts.baseUrl}/api/v1/flows/${encodeURIComponent(flowId)}`, { method: "DELETE" }, timeoutMs);
    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(`langflow delete: ${res.status} ${res.statusText} — ${bodyText.slice(0, 500)}`);
    }
    if (!bodyText.trim()) return {};
    try {
      return JSON.parse(bodyText);
    } catch {
      return { message: bodyText };
    }
  }

  private async _fetch(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.opts.apiKey) headers.set("x-api-key", this.opts.apiKey);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, headers, signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Extract the user-facing text from a LangFlow response envelope. Shape
   * verified against LangFlow v1.9.3 per LANGFLOW-API.md.
   */
  private _extractText(raw: unknown): string {
    type Envelope = { outputs?: { outputs?: { results?: { message?: { text?: string } } }[] }[] };
    const env = raw as Envelope;
    return env.outputs?.[0]?.outputs?.[0]?.results?.message?.text ?? "";
  }
}
