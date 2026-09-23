const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_TOOL_RESULT_CHARS = 12000;

export type McpBridgeConfig = {
  url: string;
  key: string;
};

export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

type JsonRpcResponse = {
  result?: { tools?: McpTool[]; content?: Array<{ type?: string; text?: string }> };
  error?: { message?: string };
};

function normaliseUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function assertBridge(config: McpBridgeConfig) {
  if (!config.url || !/^https?:\/\//i.test(config.url)) throw new Error("A valid OMEGA MCP URL is required.");
  if (!config.key || config.key.length < 8) throw new Error("A valid OMEGA hub key is required.");
}

export function isCommandTool(name: string) {
  return name.toLowerCase() === "termux_exec";
}

function isReadOnlyTool(name: string) {
  const lower = name.toLowerCase();
  if (["termux_exec", "shell", "exec", "run_command", "inbox_post", "write_file", "delete_file", "deploy", "routeros_command"].includes(lower)) return false;
  return /(^|_)(health|status|snapshot|list|read|get|search|inspect|view|check|info|battery|peers|tools)(_|$)/.test(lower);
}

export function filterAssistantTools(tools: McpTool[]) {
  return tools.filter(tool => isReadOnlyTool(tool.name) || isCommandTool(tool.name));
}

function toModelTools(tools: McpTool[]) {
  return filterAssistantTools(tools).map(tool => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: isCommandTool(tool.name)
        ? `${tool.description || "Execute a Termux command"} Requires explicit operator confirmation before execution.`
        : `${tool.description || "Read-only OMEGA MCP tool"} Read-only assistant access; no writes.`,
      parameters: tool.inputSchema || { type: "object", properties: {}, additionalProperties: false },
    },
  }));
}

export function extractMcpText(payload: JsonRpcResponse) {
  const content = payload.result?.content;
  if (Array.isArray(content)) {
    return content.map(item => item.text || "").filter(Boolean).join("\n").slice(0, MAX_TOOL_RESULT_CHARS);
  }
  return JSON.stringify(payload.result ?? payload).slice(0, MAX_TOOL_RESULT_CHARS);
}

export async function mcpRequest(config: McpBridgeConfig, method: string, params: Record<string, unknown> = {}, session?: string | null) {
  assertBridge(config);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "X-API-Key": config.key,
  };
  if (session) headers["Mcp-Session-Id"] = session;
  const response = await fetch(`${normaliseUrl(config.url)}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
  });
  const text = await response.text();
  let payload: JsonRpcResponse = {};
  try { payload = text ? JSON.parse(text) as JsonRpcResponse : {}; } catch { throw new Error("OMEGA MCP returned a non-JSON response."); }
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `OMEGA MCP request failed (${response.status})`);
  return { payload, session: response.headers.get("mcp-session-id") || session || null };
}

export async function discoverAssistantTools(config: McpBridgeConfig) {
  const initial = await mcpRequest(config, "initialize", {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "OMEGA Cloud Assistant", version: "1.0.0" },
  });
  await mcpRequest(config, "notifications/initialized", {}, initial.session);
  const listed = await mcpRequest(config, "tools/list", {}, initial.session);
  const tools = listed.payload.result?.tools || [];
  return { tools: filterAssistantTools(tools), session: listed.session };
}

export async function callAssistantTool(config: McpBridgeConfig, session: string | null, name: string, args: Record<string, unknown>, options: { allowCommandExecution?: boolean } = {}) {
  if (isCommandTool(name) && !options.allowCommandExecution) {
    return { session, text: `Command approval is required before executing: ${String(args.command || "(empty command)")}` };
  }
  if (!isReadOnlyTool(name) && !isCommandTool(name)) {
    return { session, text: `Tool ${name} is blocked for assistant automation because it may mutate state. Use the visible Terminal/Tools approval flow instead.` };
  }
  const result = await mcpRequest(config, "tools/call", { name, arguments: args }, session);
  return { session: result.session, text: extractMcpText(result.payload) };
}

export function modelToolsForMcp(tools: McpTool[]) {
  return toModelTools(tools);
}
