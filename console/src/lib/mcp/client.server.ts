import { assertSafeCommand } from "./sandbox";

export type McpTextResult = {
  ok: boolean;
  status: number;
  sessionId: string | null;
  text: string;
};

export type HealthResult = {
  ok: boolean;
  status: number;
  service: string;
  transport: string;
  port: number;
  error: string;
};

export type ToolInfo = {
  name: string;
  description: string;
};

type SessionEntry = {
  sessionId: string;
  initializedAt: number;
};

type JsonRecord = Record<string, string | number | boolean | null>;

const sessions = new Map<string, SessionEntry>();
const SESSION_TTL_MS = 8 * 60 * 1000;

function sessionKey(url: string, apiKey: string) {
  return `${url}::${apiKey.slice(0, 12)}`;
}

function assertPublicHttps(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("MCP URL is not valid.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("MCP URL must be https.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error("MCP URL cannot target a private host.");
  }
  return parsed.origin;
}

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function extractText(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  if (!record) return String(payload);
  const error = asRecord(record.error);
  if (error?.message) return String(error.message);
  const result = asRecord(record.result);
  if (result && Array.isArray((result as unknown as { content?: unknown }).content)) {
    const content = (result as unknown as { content: Array<{ text?: string }> }).content;
    return content
      .map((part) => part.text || "")
      .filter(Boolean)
      .join("\n");
  }
  if (result) {
    try {
      return JSON.stringify(record.result, null, 2);
    } catch {
      return String(record.result);
    }
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function isErrorPayload(payload: unknown): boolean {
  const record = asRecord(payload);
  if (!record) return false;
  if (record.error) return true;
  const result = asRecord(record.result);
  return Boolean(result && result.isError === true);
}

async function parseBody(res: Response): Promise<unknown> {
  const ctype = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!text) return null;
  if (ctype.includes("text/event-stream")) {
    const events = text.split("\n");
    for (const line of events) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    throw new Error("Empty MCP stream.");
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function mcpFetch(
  origin: string,
  apiKey: string,
  body: unknown,
  sessionId: string | null,
  timeoutMs: number,
): Promise<{ status: number; sessionId: string | null; payload: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-API-Key": apiKey,
      "ngrok-skip-browser-warning": "true",
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;
    const res = await fetch(`${origin}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const nextSession = res.headers.get("mcp-session-id") || sessionId;
    const payload = await parseBody(res);
    return { status: res.status, sessionId: nextSession, payload };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureSession(
  origin: string,
  apiKey: string,
  timeoutMs: number,
): Promise<string> {
  const key = sessionKey(origin, apiKey);
  const cached = sessions.get(key);
  if (cached && Date.now() - cached.initializedAt < SESSION_TTL_MS) {
    return cached.sessionId;
  }
  const init = await mcpFetch(
    origin,
    apiKey,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "omega-pool-console", version: "2.4.0" },
      },
    },
    null,
    timeoutMs,
  );
  if (init.status === 401) {
    throw new Error("Unauthorized — check the X-API-Key.");
  }
  if (init.status >= 400 || !init.sessionId) {
    throw new Error(
      `MCP initialize failed (${init.status}): ${extractText(init.payload) || "no session"}`,
    );
  }
  await mcpFetch(
    origin,
    apiKey,
    { jsonrpc: "2.0", method: "notifications/initialized" },
    init.sessionId,
    Math.min(timeoutMs, 8000),
  );
  sessions.set(key, { sessionId: init.sessionId, initializedAt: Date.now() });
  return init.sessionId;
}

export async function probeHealth(url: string): Promise<HealthResult> {
  const origin = assertPublicHttps(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${origin}/health`, {
      headers: { "ngrok-skip-browser-warning": "true" },
      signal: controller.signal,
    });
    const text = await res.text();
    let service = "";
    let transport = "";
    let port = 0;
    try {
      const parsed = JSON.parse(text) as JsonRecord;
      service = String(parsed.service ?? "");
      transport = String(parsed.transport ?? "");
      port = Number(parsed.port ?? 0) || 0;
    } catch {
      service = text.slice(0, 120);
    }
    return { ok: res.ok, status: res.status, service, transport, port, error: "" };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      service: "",
      transport: "",
      port: 0,
      error: error instanceof Error ? error.message : "Health probe failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function callMcp(options: {
  url: string;
  apiKey: string;
  method: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<McpTextResult> {
  const origin = assertPublicHttps(options.url);
  const apiKey = options.apiKey.trim();
  if (apiKey.length < 8) {
    throw new Error("API key looks too short.");
  }
  const timeoutMs = options.timeoutMs ?? 25000;
  const invoke = async (sessionId: string) =>
    mcpFetch(
      origin,
      apiKey,
      {
        jsonrpc: "2.0",
        id: Date.now() % 1_000_000,
        method: options.method,
        params: options.params,
      },
      sessionId,
      timeoutMs,
    );

  let sessionId = await ensureSession(origin, apiKey, timeoutMs);
  let response = await invoke(sessionId);
  if (response.status === 401) {
    throw new Error("Unauthorized — check the X-API-Key.");
  }
  if (response.status === 404 || response.status === 400) {
    sessions.delete(sessionKey(origin, apiKey));
    sessionId = await ensureSession(origin, apiKey, timeoutMs);
    response = await invoke(sessionId);
  }
  return {
    ok: response.status < 400 && !isErrorPayload(response.payload),
    status: response.status,
    sessionId: response.sessionId,
    text: extractText(response.payload),
  };
}

export async function callTool(options: {
  url: string;
  apiKey: string;
  name: string;
  args?: JsonRecord;
  timeoutMs?: number;
}): Promise<McpTextResult> {
  if (options.name === "termux_exec") {
    assertSafeCommand(String(options.args?.command ?? ""));
  }
  return callMcp({
    url: options.url,
    apiKey: options.apiKey,
    method: "tools/call",
    params: { name: options.name, arguments: options.args ?? {} },
    timeoutMs: options.timeoutMs,
  });
}

export async function listTools(options: {
  url: string;
  apiKey: string;
}): Promise<{ tools: ToolInfo[] }> {
  const result = await callMcp({
    url: options.url,
    apiKey: options.apiKey,
    method: "tools/list",
    timeoutMs: 20000,
  });
  try {
    const parsed = JSON.parse(result.text) as {
      tools?: Array<{ name?: string; description?: string }>;
    };
    return {
      tools: (parsed.tools ?? []).map((tool) => ({
        name: tool.name || "unknown",
        description: tool.description || "",
      })),
    };
  } catch {
    return { tools: [] };
  }
}
