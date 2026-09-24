import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { checkLocalProvider, completeOmegaAssistant, streamLocalOmegaAssistant } from "../assistant";
import { addChatMessage, getConversation, listChatMessages, listChatMemories } from "../db";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sandboxStream } from "../sandboxShell";

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.post("/api/llm", async (req, res) => {
    try {
      const result = await completeOmegaAssistant(req.body);
      res.json({ ok: true, ...result });
    } catch (error) {
      console.error("[LLM] Request failed", error);
      const message = error instanceof Error ? error.message : "Assistant request failed";
      res.status(message === "A user prompt is required." ? 400 : 502).json({ ok: false, error: message });
    }
  });
  app.get("/api/local-llm/health", async (_req, res) => res.json(await checkLocalProvider()));
  app.post("/api/sandbox-shell/stream", async (req, res) => {
    const { bridge, command, timeout } = req.body || {};
    if (!bridge || typeof bridge.url !== "string" || typeof bridge.key !== "string" || typeof command !== "string" || !command.trim()) return res.status(400).json({ error: "bridge and command are required." });
    try {
      const upstream = await sandboxStream(bridge, command.trim(), Number(timeout) || 30);
      if (!upstream.ok || !upstream.body) return res.status(502).json({ error: await upstream.text().catch(() => "Sandbox stream failed") });
      res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
      } finally {
        if (!res.writableEnded) res.end();
      }
    } catch (error) {
      if (!res.headersSent) res.status(502).json({ error: error instanceof Error ? error.message : "Sandbox stream failed" });
      else if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ type: "error", text: error instanceof Error ? error.message : "Sandbox stream failed" })}\n\n`); res.end(); }
    }
  });
  app.post("/api/local-llm/stream", async (req, res) => {
    const { clientId, conversationId, prompt } = req.body || {};
    if (typeof clientId !== "string" || clientId.length < 16 || !Number.isInteger(conversationId) || typeof prompt !== "string" || !prompt.trim()) return res.status(400).json({ error: "clientId, conversationId, and prompt are required." });
    const conversation = await getConversation(clientId, conversationId);
    if (!conversation) return res.status(404).json({ error: "Conversation not found." });
    const history = await listChatMessages(clientId, conversationId);
    const memories = await listChatMemories(clientId);
    const messages = [...history.map((message) => ({ role: message.role as "user" | "assistant", content: message.content })), { role: "user" as const, content: prompt.trim() }];
    await addChatMessage({ conversationId, role: "user", content: prompt.trim(), model: "local-qwen2.5-7b" });
    const upstream = await streamLocalOmegaAssistant(messages, memories.map((memory) => `- ${memory.content}`).join("\n"));
    if (!upstream.ok || !upstream.body) return res.status(502).json({ error: await upstream.text().catch(() => "Local provider request failed") });
    res.status(200).set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    let buffer = "";
    let content = "";
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
            const token = parsed.choices?.[0]?.delta?.content || "";
            if (token) { content += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
            if (parsed.usage) res.write(`data: ${JSON.stringify({ usage: parsed.usage })}\n\n`);
          } catch { /* ignore incomplete provider events */ }
        }
      }
      if (content) await addChatMessage({ conversationId, role: "assistant", content, model: "qwen2.5:7b" });
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (error) {
      if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: error instanceof Error ? error.message : "Stream interrupted" })}\n\n`); res.end(); }
    }
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = parseInt(process.env.PORT || "3000", 10);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer().catch(console.error);
