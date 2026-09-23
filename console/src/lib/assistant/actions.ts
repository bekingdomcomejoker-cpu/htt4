import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const message = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(12000),
});

const input = z.object({
  prompt: z.string().min(1).max(12000),
  history: z.array(message).max(10).optional(),
});

export const askManusAssistant = createServerFn({ method: "POST" })
  .validator(input)
  .handler(async ({ data }) => {
    const forgeOrigin = (process.env.BUILT_IN_FORGE_API_URL || "").replace(/\/+$/, "");
    const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
    if (!forgeOrigin || !forgeKey) throw new Error("Manus Forge is not configured on the Render server.");
    const messages = [
      { role: "system" as const, content: "You are the OMEGA cloud assistant. Be precise, practical, and honest. Do not claim to have accessed Termux, the VPS, or external systems unless a separate tool call provided that result." },
      ...(data.history ?? []),
      { role: "user" as const, content: data.prompt },
    ];
    const response = await fetch(`${forgeOrigin}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${forgeKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ model: "gpt-5-mini", messages, max_completion_tokens: 1200 }),
    });
    const payload = (await response.json().catch(() => null)) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!response.ok || !content) {
      throw new Error(payload?.error?.message || `Manus assistant unavailable (${response.status})`);
    }
    return { model: "gpt-5-mini", content };
  });
