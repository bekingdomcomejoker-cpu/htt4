import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { addChatMessage, createChatMemory, createConversation, deleteChatMemory, getConversation, listChatMemories, listChatMessages, listConversations, updateConversationModel } from "./db";
import { checkLocalProvider, completeOmegaAssistant, MODEL_OPTIONS, type ChatModel } from "./assistant";
import { callAssistantTool, discoverAssistantTools, isCommandTool, type McpBridgeConfig } from "./mcp";
import { pipelineRouter } from "./pipelineRouter";
import { sandboxExec, sandboxHealth } from "./sandboxShell";
const clientIdSchema = z.string().min(16).max(128);
const modelSchema = z.enum(MODEL_OPTIONS.map((option) => option.id) as [ChatModel, ...ChatModel[]]);
const bridgeConfigSchema = z.object({ url: z.string().url().max(500), key: z.string().min(8).max(512) });
const bridgeSchema = bridgeConfigSchema.optional();

export const appRouter = router({
  system: systemRouter,
  pipeline: pipelineRouter,
  sandbox: router({
    health: publicProcedure.input(bridgeConfigSchema).query(({ input }) => sandboxHealth(input)),
    exec: publicProcedure.input(z.object({ bridge: bridgeConfigSchema, command: z.string().trim().min(1).max(120000), timeout: z.number().int().min(1).max(120).optional() })).mutation(({ input }) => sandboxExec(input.bridge, input.command, input.timeout)),
  }),
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  chat: router({
    models: publicProcedure.query(() => MODEL_OPTIONS),
    providerHealth: publicProcedure.input(z.object({ model: modelSchema.optional() }).optional()).query(async ({ input }) => input?.model === "local-qwen2.5-7b" ? checkLocalProvider() : { ok: true, model: "forge", endpoint: "server-side Forge", latencyMs: null, error: undefined }),
    conversations: publicProcedure.input(z.object({ clientId: clientIdSchema })).query(({ input }) => listConversations(input.clientId)),
    messages: publicProcedure.input(z.object({ clientId: clientIdSchema, conversationId: z.number().int().positive() })).query(({ input }) => listChatMessages(input.clientId, input.conversationId)),
    memories: publicProcedure.input(z.object({ clientId: clientIdSchema })).query(({ input }) => listChatMemories(input.clientId)),
    saveMemory: publicProcedure.input(z.object({ clientId: clientIdSchema, content: z.string().trim().min(1).max(2000) })).mutation(({ input }) => createChatMemory(input.clientId, input.content)),
    deleteMemory: publicProcedure.input(z.object({ clientId: clientIdSchema, memoryId: z.number().int().positive() })).mutation(async ({ input }) => {
      await deleteChatMemory(input.clientId, input.memoryId);
      return { success: true } as const;
    }),
    create: publicProcedure.input(z.object({ clientId: clientIdSchema, title: z.string().max(180).optional(), model: modelSchema })).mutation(({ input }) => createConversation(input.clientId, input.title || "New OMEGA chat", input.model)),
    setModel: publicProcedure.input(z.object({ clientId: clientIdSchema, conversationId: z.number().int().positive(), model: modelSchema })).mutation(async ({ input }) => {
      const conversation = await getConversation(input.clientId, input.conversationId);
      if (!conversation) throw new Error("Conversation not found.");
      await updateConversationModel(input.clientId, input.conversationId, input.model);
      return { model: input.model };
    }),
    ask: publicProcedure.input(z.object({ clientId: clientIdSchema, conversationId: z.number().int().positive(), model: modelSchema, prompt: z.string().trim().min(1).max(120000), bridge: bridgeSchema })).mutation(async ({ input }) => {
      const conversation = await getConversation(input.clientId, input.conversationId);
      if (!conversation) throw new Error("Conversation not found.");
      const history = await listChatMessages(input.clientId, input.conversationId);
      const memories = await listChatMemories(input.clientId);
      const messages = [...history.map((message) => ({ role: message.role, content: message.content })), { role: "user" as const, content: input.prompt }];
      await addChatMessage({ conversationId: input.conversationId, role: "user", content: input.prompt, model: input.model });
      try {
        const result = await completeOmegaAssistant({ model: input.model, messages, memoryContext: memories.map((memory) => `- ${memory.content}`).join("\n"), bridge: input.bridge as McpBridgeConfig | undefined });
        await addChatMessage({ conversationId: input.conversationId, role: "assistant", content: result.content, model: result.model });
        return result;
      } catch (error) {
        throw error;
      }
    }),
    execute: publicProcedure.input(z.object({ clientId: clientIdSchema, conversationId: z.number().int().positive(), model: modelSchema, name: z.string().min(1).max(80), arguments: z.record(z.string(), z.unknown()), bridge: bridgeConfigSchema })).mutation(async ({ input }) => {
      const conversation = await getConversation(input.clientId, input.conversationId);
      if (!conversation) throw new Error("Conversation not found.");
      if (!isCommandTool(input.name)) throw new Error("Only the explicit Termux command tool can be approved from the assistant lane.");
      const discovered = await discoverAssistantTools(input.bridge as McpBridgeConfig);
      if (!discovered.tools.some((tool) => tool.name === input.name)) throw new Error("The requested command tool is not advertised by the current bridge.");
      const result = await callAssistantTool(input.bridge as McpBridgeConfig, discovered.session, input.name, input.arguments, { allowCommandExecution: true });
      await addChatMessage({ conversationId: input.conversationId, role: "assistant", content: `Executed \`${String(input.arguments.command || "") }\`\n\n${result.text}`, model: input.model });
      return { model: input.model, content: result.text, toolsUsed: 1 };
    }),
  }),
});

export type AppRouter = typeof appRouter;
