import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InvokeResult } from "./_core/llm";
vi.mock("./_core/env", () => ({
  ENV: { forgeApiUrl: "https://forge.example.test", forgeApiKey: "test-forge-key" },
}));
import { completeOmegaAssistant, extractAssistantText, normalizeAssistantMessages, MAX_PROMPT_CHARS } from "./assistant";

function result(content: string): InvokeResult {
  return { id: "test-response", created: 0, model: "claude-sonnet-4-6", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] };
}

const bridge = { url: "https://omega.example", key: "test-hub-key-123" };

describe("OMEGA assistant", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(result("OMEGA_ASSISTANT_OK")), { status: 200, headers: { "content-type": "application/json" } })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("normalizes only safe chat roles and bounds message history", () => {
    const messages = normalizeAssistantMessages({ messages: [{ role: "tool", content: "ignore me" }, ...Array.from({ length: 14 }, (_, index) => ({ role: "user", content: `message-${index}` }))] });
    expect(messages).toHaveLength(14);
    expect(messages[0]).toEqual({ role: "user", content: "message-0" });
    expect(messages.at(-1)).toEqual({ role: "user", content: "message-13" });
  });

  it("uses the server-side Forge transport and returns the assistant text", async () => {
    await expect(completeOmegaAssistant({ prompt: "Reply with exactly OMEGA_ASSISTANT_OK" })).resolves.toEqual({ model: "claude-sonnet-4-6", content: "OMEGA_ASSISTANT_OK", toolsUsed: 0 });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/v1/chat/completions"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "Content-Type": "application/json" }) }));
  });

  it("injects bounded persistent memory into the system context", async () => {
    await completeOmegaAssistant({ prompt: "Use my preference", memoryContext: "- Prefers concise deployment notes" });
    const request = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.messages[0].content).toContain("Persistent operator memory");
    expect(body.messages[0].content).toContain("Prefers concise deployment notes");
  });

  it("accepts the expanded prompt ceiling", () => {
    expect(MAX_PROMPT_CHARS).toBe(120000);
    expect(normalizeAssistantMessages({ prompt: "x".repeat(120000) })[0]?.content).toHaveLength(120000);
  });

  it("uses a read-only MCP tool and returns its result to the model", async () => {
    const responses = [
      new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-1" } }),
      new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ result: { tools: [{ name: "mesh_status", description: "Read mesh status", inputSchema: { type: "object", properties: {} } }] } }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "mesh_status", arguments: "{}" } }] }, finish_reason: "tool_calls" }], model: "claude-sonnet-4-6" }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ result: { content: [{ type: "text", text: "TERMUX_LIVE" }] } }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "Termux is live." }, finish_reason: "stop" }], model: "claude-sonnet-4-6" }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    await expect(completeOmegaAssistant({ prompt: "Check the mesh", bridge })).resolves.toEqual({ model: "claude-sonnet-4-6", content: "Termux is live.", toolsUsed: 1 });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[4]?.[0])).toContain("/mcp");
  });

  it("pauses before a model-proposed Termux command and returns the exact approval payload", async () => {
    const responses = [
      new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-approval" } }),
      new Response(JSON.stringify({ result: {} }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ result: { tools: [{ name: "termux_exec", description: "Execute a command", inputSchema: { type: "object", properties: { command: { type: "string" } } } }] } }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call-ls", type: "function", function: { name: "termux_exec", arguments: JSON.stringify({ command: "ls -la" }) } }] }, finish_reason: "tool_calls" }], model: "claude-sonnet-4-6" }), { status: 200, headers: { "content-type": "application/json" } }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => responses.shift()!));
    await expect(completeOmegaAssistant({ prompt: "Please list the files", bridge })).resolves.toMatchObject({ content: expect.stringContaining("ls -la"), pendingTool: { name: "termux_exec", arguments: { command: "ls -la" } } });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects empty prompts before calling Forge", async () => {
    await expect(completeOmegaAssistant({ prompt: "   " })).rejects.toThrow("A user prompt is required.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces an upstream Forge error without exposing the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503, headers: { "content-type": "application/json" } })));
    await expect(completeOmegaAssistant({ prompt: "test" })).rejects.toThrow("upstream unavailable");
  });

  it("extracts text parts from multimodal helper responses", () => {
    expect(extractAssistantText({ ...result("ignored"), choices: [{ index: 0, message: { role: "assistant", content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }, finish_reason: "stop" }] })).toBe("first\nsecond");
  });
});
