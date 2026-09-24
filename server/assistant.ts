import { ENV } from "./_core/env";
import type { InvokeResult, Message } from "./_core/llm";
import { callAssistantTool, discoverAssistantTools, isCommandTool, modelToolsForMcp, type McpBridgeConfig } from "./mcp";

export const MAX_PROMPT_CHARS = 120000;
const MAX_CONTEXT_MESSAGES = 80;
const MAX_OUTPUT_TOKENS = 8000;
const MAX_MCP_ROUNDS = 6;
const DEFAULT_MODEL = "claude-sonnet-4-6" as const;
const SYSTEM_PROMPT =
    "You are the OMEGA cloud assistant. Be precise, practical, and honest about what you can or cannot execute. You may inspect mesh, Termux, and connected service state with the provided MCP tools. You may propose a Termux command, but the operator must explicitly approve it before execution. Never claim to have accessed an external system unless a tool result actually provided that information. Writes, deletes, deployments, inbox mutations, and network mutations are blocked from this assistant lane.";

export const MODEL_OPTIONS = [
  { id: "local-qwen2.5-7b", label: "Local Qwen2.5 7B", family: "Local / Ollama", description: "Private CPU model on the configured host" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "Anthropic", description: "Balanced reasoning and coding" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", family: "Anthropic", description: "High-capability reasoning" },
  { id: "claude-opus-4-7", label: "Claude Opus 4.7", family: "Anthropic", description: "Highest-capability reasoning" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", family: "Anthropic", description: "Fast everyday responses" },
  { id: "gpt-5.5", label: "GPT-5.5", family: "OpenAI", description: "Flagship reasoning and coding" },
  { id: "gpt-5", label: "GPT-5", family: "OpenAI", description: "Strong general reasoning" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", family: "OpenAI", description: "Fast, lower-cost workhorse" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", family: "OpenAI", description: "Fastest lightweight option" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", family: "Google", description: "Long-context multimodal reasoning" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", family: "Google", description: "Fast long-context responses" },
] as const;

export type ChatModel = (typeof MODEL_OPTIONS)[number]["id"];
type IncomingMessage = { role?: unknown; content?: unknown };
type ForgeMessage = Record<string, unknown>;
type ForgeResponse = InvokeResult & { choices: Array<{ message: { role: string; content?: unknown; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }; finish_reason: string | null }> };

type AssistantBody = { model?: unknown; messages?: unknown; prompt?: unknown; memoryContext?: unknown; bridge?: McpBridgeConfig };

const LOCAL_MODEL_ID = "local-qwen2.5-7b" as const;

export function isChatModel(value: unknown): value is ChatModel { return MODEL_OPTIONS.some((option) => option.id === value); }

export function normalizeAssistantMessages(body: unknown): Message[] {
  const payload = body && typeof body === "object" ? body as AssistantBody : {};
  const requestedMessages = Array.isArray(payload.messages) ? payload.messages : [{ role: "user", content: payload.prompt }];
  return requestedMessages
    .filter((message): message is IncomingMessage => {
      if (!message || typeof message !== "object") return false;
      const candidate = message as IncomingMessage;
      return ["system", "user", "assistant"].includes(String(candidate.role)) && typeof candidate.content === "string";
    })
    .slice(-MAX_CONTEXT_MESSAGES)
    .map(message => ({ role: message.role as "system" | "user" | "assistant", content: String(message.content).slice(0, MAX_PROMPT_CHARS) }));
}

export function extractAssistantText(result: ForgeResponse): string {
  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text")).map(part => part.text).join("\n").trim();
  return "";
}

function modelToolRequest(model: ChatModel, messages: ForgeMessage[], tools?: ReturnType<typeof modelToolsForMcp>) {
  const request: Record<string, unknown> = { model: model === LOCAL_MODEL_ID ? "qwen2.5:7b" : model, messages };
  if (tools?.length) {
    request.tools = tools;
    request.tool_choice = "auto";
  }
  if (model.startsWith("gpt-")) request.max_completion_tokens = MAX_OUTPUT_TOKENS;
  else request.max_tokens = MAX_OUTPUT_TOKENS;
  return request;
}

async function forgeCompletion(model: ChatModel, messages: ForgeMessage[], tools?: ReturnType<typeof modelToolsForMcp>) {
  const isLocal = model === LOCAL_MODEL_ID;
  const apiKey = isLocal ? ENV.localLlmApiKey : ENV.forgeApiKey;
  if (!isLocal && !apiKey) throw new Error("Forge backend is not configured on this deployment.");
  const baseUrl = (isLocal ? ENV.localLlmApiUrl : ENV.forgeApiUrl || "https://forge.manus.ai").replace(/\/+$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(modelToolRequest(model, messages, tools)),
  });
  const result = await response.json().catch(() => null) as ForgeResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error((result as { error?: { message?: string } } | null)?.error?.message || `Forge request failed (${response.status})`);
  return result as ForgeResponse;
}

export async function completeOmegaAssistant(body: unknown) {
  const payload = body && typeof body === "object" ? body as AssistantBody : {};
  const model: ChatModel = isChatModel(payload.model) ? payload.model : DEFAULT_MODEL;
  const messages = normalizeAssistantMessages(body);
  if (!messages.some(message => message.role === "user" && typeof message.content === "string" && message.content.trim())) throw new Error("A user prompt is required.");

  let mcpTools: ReturnType<typeof modelToolsForMcp> = [];
  let mcpSession: string | null = null;
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  const bridge = payload.bridge && typeof payload.bridge === "object" ? payload.bridge : undefined;
  if (bridge?.url && bridge.key) {
    const discovered = await discoverAssistantTools(bridge);
    mcpTools = modelToolsForMcp(discovered.tools);
    mcpSession = discovered.session;
  }

  const memoryContext = typeof payload.memoryContext === "string" ? payload.memoryContext.trim().slice(0, 12000) : "";
  const systemContent = memoryContext ? `${SYSTEM_PROMPT}\n\nPersistent operator memory (use only when relevant; do not invent or overwrite it):\n${memoryContext}` : SYSTEM_PROMPT;
  const transcript: ForgeMessage[] = [{ role: "system", content: systemContent }, ...messages.map(message => ({ role: message.role, content: message.content as string }))];
  let toolCalls = 0;
  for (let round = 0; round <= MAX_MCP_ROUNDS; round += 1) {
    const result = await forgeCompletion(model, transcript, mcpTools);
    usage.promptTokens += result.usage?.prompt_tokens || 0;
    usage.completionTokens += result.usage?.completion_tokens || 0;
    usage.totalTokens += result.usage?.total_tokens || 0;
    usage.requests += 1;
    const assistantMessage = result.choices[0]?.message;
    if (!assistantMessage) throw new Error("Forge returned an empty response.");
    const calls = assistantMessage.tool_calls || [];
    if (!calls.length || !bridge) {
      const content = extractAssistantText(result);
      if (!content) throw new Error("Forge returned an empty response.");
      return { model: result.model || model, content, toolsUsed: toolCalls, usage };
    }
    transcript.push({ role: "assistant", content: assistantMessage.content ?? null, tool_calls: calls });
    for (const call of calls.slice(0, 4)) {
      toolCalls += 1;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { args = {}; }
      if (isCommandTool(call.function.name)) {
        const command = typeof args.command === "string" ? args.command.trim() : "";
        if (!command) return { model: result.model || model, content: "The assistant proposed an empty Termux command, so nothing was executed.", toolsUsed: toolCalls, pendingTool: null, usage };
        return { model: result.model || model, content: `Command approval required before execution:\n\n\`${command}\``, toolsUsed: toolCalls, pendingTool: { name: call.function.name, arguments: args }, usage };
      }
      const toolResult = await callAssistantTool(bridge, mcpSession, call.function.name, args);
      mcpSession = toolResult.session;
      transcript.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: toolResult.text });
    }
  }
  throw new Error("The MCP tool loop reached its safety limit before the assistant produced a final response.");
}
