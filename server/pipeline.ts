/**
 * HTT3 multi-model pipeline
 *
 * Flow:
 *   1. Researcher  — takes the operator instruction, may use read-only MCP tools,
 *                    gathers context, produces a brief for the implementer
 *   2. Implementer — writes code / completes the task from the research brief
 *   3. Critic      — critiques the draft and lists concrete improvements
 *   4. Implementer — revises the draft using the critique
 *   5. Presenter   — same model as Researcher; delivers the final answer to the operator
 *
 * All Forge calls stay server-side. Destructive MCP tools remain blocked.
 */

import { ENV } from "./_core/env";
import type { InvokeResult } from "./_core/llm";
import {
  callAssistantTool,
  discoverAssistantTools,
  isCommandTool,
  modelToolsForMcp,
  type McpBridgeConfig,
} from "./mcp";
import { isChatModel, type ChatModel, MODEL_OPTIONS } from "./assistant";

const MAX_OUTPUT_TOKENS = 8000;
const MAX_MCP_ROUNDS = 4;
const MAX_PROMPT_CHARS = 120000;

export type PipelineRole = "researcher" | "implementer" | "critic";

export type PipelineStageId =
  | "research"
  | "implement"
  | "critique"
  | "revise"
  | "present";

export type PipelineStageStatus = "pending" | "running" | "done" | "error";

export type PipelineStage = {
  id: PipelineStageId;
  role: PipelineRole;
  model: ChatModel;
  label: string;
  status: PipelineStageStatus;
  content?: string;
  toolsUsed?: number;
  error?: string;
};

export type PipelineModelAssignment = {
  researcher: ChatModel;
  implementer: ChatModel;
  critic: ChatModel;
};

/** Sensible defaults across the three families already in MODEL_OPTIONS */
export const DEFAULT_PIPELINE_MODELS: PipelineModelAssignment = {
  researcher: "claude-sonnet-4-6",
  implementer: "gpt-5.5",
  critic: "gemini-3.1-pro-preview",
};

const ROLE_SYSTEM: Record<PipelineRole, string> = {
  researcher: `You are the RESEARCHER in a three-model OMEGA pipeline (HTT3).
Your job:
1. Understand the operator's instruction precisely.
2. Use any available read-only MCP tools to inspect mesh state, peers, or context when relevant.
3. Search your knowledge and any tool results for facts needed to complete the task.
4. Produce a clear RESEARCH BRIEF for the Implementer. Include:
   - Goal restatement
   - Constraints and safety notes
   - Relevant facts / tool findings
   - Suggested approach and file/module targets if code is involved
Do NOT write final user-facing prose or full implementations. Hand off a brief only.
Never claim access to a system unless a tool result actually provided that information.
Writes, deletes, deployments, and network mutations are blocked.`,

  implementer: `You are the IMPLEMENTER in a three-model OMEGA pipeline (HTT3).
You receive either a research brief or a research brief plus a critique.
Your job is to produce the actual deliverable: code, configuration, plan, or completed task output.
Be concrete and complete. Prefer working code and explicit steps over vague advice.
If you receive a critique, revise your previous draft to address every concrete point.
Do not ask the operator questions; the pipeline continues automatically.
Do not claim external system access without evidence from prior stages.`,

  critic: `You are the CRITIC in a three-model OMEGA pipeline (HTT3).
You receive the operator goal, the research brief, and the implementer's draft.
Your job is to critique and improve:
- Correctness, safety, and missing edge cases
- Clarity and structure
- Alignment with the original goal
- Concrete, actionable revision notes the Implementer can apply
Be rigorous but fair. Do not rewrite the whole deliverable yourself; list improvements.
End with a short "Revision checklist" the Implementer must satisfy.`,
};

const PRESENTER_ADDON = `
You are now the PRESENTER (same model as Researcher).
You receive the full pipeline transcript: research brief, draft, critique, and revised draft.
Write the final response to the human operator.
Be clear, direct, and useful. Include the revised deliverable (code or plan) when present.
Summarise what the pipeline did only briefly if it helps the operator trust the result.
Do not invent tool results that were not provided.`;

type ForgeMessage = Record<string, unknown>;
type ForgeResponse = InvokeResult & {
  choices: Array<{
    message: {
      role: string;
      content?: unknown;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string | null;
  }>;
};

function extractText(result: ForgeResponse): string {
  const content = result.choices[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter(
        (part): part is { type: "text"; text: string } =>
          Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text"),
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
  }
  return "";
}

function modelRequest(model: ChatModel, messages: ForgeMessage[], tools?: ReturnType<typeof modelToolsForMcp>) {
  const request: Record<string, unknown> = { model, messages };
  if (tools?.length) {
    request.tools = tools;
    request.tool_choice = "auto";
  }
  if (model.startsWith("gpt-")) request.max_completion_tokens = MAX_OUTPUT_TOKENS;
  else request.max_tokens = MAX_OUTPUT_TOKENS;
  return request;
}

async function forgeCompletion(
  model: ChatModel,
  messages: ForgeMessage[],
  tools?: ReturnType<typeof modelToolsForMcp>,
): Promise<ForgeResponse> {
  const apiKey = ENV.forgeApiKey;
  if (!apiKey) throw new Error("Forge backend is not configured on this deployment.");
  const baseUrl = (ENV.forgeApiUrl || "https://forge.manus.ai").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(modelRequest(model, messages, tools)),
  });
  const result = (await response.json().catch(() => null)) as
    | ForgeResponse
    | { error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(
      (result as { error?: { message?: string } } | null)?.error?.message ||
        `Forge request failed (${response.status})`,
    );
  }
  return result as ForgeResponse;
}

/** Single model turn; Researcher may use read-only MCP tools. Command tools are never auto-executed. */
async function runModelTurn(opts: {
  model: ChatModel;
  system: string;
  userContent: string;
  bridge?: McpBridgeConfig;
  allowTools: boolean;
}): Promise<{ content: string; toolsUsed: number }> {
  let mcpTools: ReturnType<typeof modelToolsForMcp> = [];
  let mcpSession: string | null = null;
  if (opts.allowTools && opts.bridge?.url && opts.bridge.key) {
    const discovered = await discoverAssistantTools(opts.bridge);
    mcpTools = modelToolsForMcp(discovered.tools);
    mcpSession = discovered.session;
  }

  const transcript: ForgeMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.userContent.slice(0, MAX_PROMPT_CHARS) },
  ];
  let toolsUsed = 0;

  for (let round = 0; round <= MAX_MCP_ROUNDS; round += 1) {
    const result = await forgeCompletion(opts.model, transcript, opts.allowTools ? mcpTools : undefined);
    const assistantMessage = result.choices[0]?.message;
    if (!assistantMessage) throw new Error("Forge returned an empty response.");
    const calls = assistantMessage.tool_calls || [];
    if (!calls.length || !opts.bridge || !opts.allowTools) {
      const content = extractText(result);
      if (!content) throw new Error("Forge returned an empty response.");
      return { content, toolsUsed };
    }
    transcript.push({
      role: "assistant",
      content: assistantMessage.content ?? null,
      tool_calls: calls,
    });
    for (const call of calls.slice(0, 4)) {
      toolsUsed += 1;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      if (isCommandTool(call.function.name)) {
        transcript.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            blocked: true,
            reason: "Command tools require explicit operator approval and are not available in the pipeline research stage.",
          }),
        });
        continue;
      }
      const toolResult = await callAssistantTool(opts.bridge, mcpSession, call.function.name, args);
      mcpSession = toolResult.session;
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: toolResult.text,
      });
    }
  }
  throw new Error("MCP tool loop reached its safety limit before producing a final research response.");
}

export function resolvePipelineModels(input?: Partial<PipelineModelAssignment>): PipelineModelAssignment {
  const pick = (value: unknown, fallback: ChatModel): ChatModel =>
    isChatModel(value) ? value : fallback;
  return {
    researcher: pick(input?.researcher, DEFAULT_PIPELINE_MODELS.researcher),
    implementer: pick(input?.implementer, DEFAULT_PIPELINE_MODELS.implementer),
    critic: pick(input?.critic, DEFAULT_PIPELINE_MODELS.critic),
  };
}

export type PipelineRunInput = {
  prompt: string;
  models?: Partial<PipelineModelAssignment>;
  bridge?: McpBridgeConfig;
  /** Optional progress callback for streaming UI later */
  onStage?: (stage: PipelineStage) => void;
};

export type PipelineRunResult = {
  models: PipelineModelAssignment;
  stages: PipelineStage[];
  finalContent: string;
  totalToolsUsed: number;
};

function stageMeta(
  id: PipelineStageId,
  role: PipelineRole,
  model: ChatModel,
): Omit<PipelineStage, "status"> {
  const labels: Record<PipelineStageId, string> = {
    research: "Research & gather context",
    implement: "Implement / write deliverable",
    critique: "Critique & improve",
    revise: "Revise from critique",
    present: "Present final answer",
  };
  return { id, role, model, label: labels[id] };
}

export async function runHtt3Pipeline(input: PipelineRunInput): Promise<PipelineRunResult> {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) throw new Error("A user prompt is required.");
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error("Prompt exceeds maximum length.");

  const models = resolvePipelineModels(input.models);
  const stages: PipelineStage[] = [
    { ...stageMeta("research", "researcher", models.researcher), status: "pending" },
    { ...stageMeta("implement", "implementer", models.implementer), status: "pending" },
    { ...stageMeta("critique", "critic", models.critic), status: "pending" },
    { ...stageMeta("revise", "implementer", models.implementer), status: "pending" },
    { ...stageMeta("present", "researcher", models.researcher), status: "pending" },
  ];

  const emit = (index: number, patch: Partial<PipelineStage>) => {
    stages[index] = { ...stages[index], ...patch };
    input.onStage?.(stages[index]);
  };

  let totalToolsUsed = 0;
  let research = "";
  let draft = "";
  let critique = "";
  let revised = "";
  let finalContent = "";

  // 1. Research
  emit(0, { status: "running" });
  try {
    const result = await runModelTurn({
      model: models.researcher,
      system: ROLE_SYSTEM.researcher,
      userContent: `Operator instruction:\n\n${prompt}`,
      bridge: input.bridge,
      allowTools: true,
    });
    research = result.content;
    totalToolsUsed += result.toolsUsed;
    emit(0, { status: "done", content: research, toolsUsed: result.toolsUsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research stage failed.";
    emit(0, { status: "error", error: message });
    throw error;
  }

  // 2. Implement
  emit(1, { status: "running" });
  try {
    const result = await runModelTurn({
      model: models.implementer,
      system: ROLE_SYSTEM.implementer,
      userContent: `Operator goal:\n${prompt}\n\n--- RESEARCH BRIEF ---\n${research}\n\nProduce the deliverable now.`,
      allowTools: false,
    });
    draft = result.content;
    emit(1, { status: "done", content: draft, toolsUsed: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Implement stage failed.";
    emit(1, { status: "error", error: message });
    throw error;
  }

  // 3. Critique
  emit(2, { status: "running" });
  try {
    const result = await runModelTurn({
      model: models.critic,
      system: ROLE_SYSTEM.critic,
      userContent: `Operator goal:\n${prompt}\n\n--- RESEARCH BRIEF ---\n${research}\n\n--- IMPLEMENTER DRAFT ---\n${draft}\n\nCritique this draft and produce a revision checklist.`,
      allowTools: false,
    });
    critique = result.content;
    emit(2, { status: "done", content: critique, toolsUsed: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Critique stage failed.";
    emit(2, { status: "error", error: message });
    throw error;
  }

  // 4. Revise
  emit(3, { status: "running" });
  try {
    const result = await runModelTurn({
      model: models.implementer,
      system: ROLE_SYSTEM.implementer,
      userContent: `Operator goal:\n${prompt}\n\n--- RESEARCH BRIEF ---\n${research}\n\n--- YOUR PREVIOUS DRAFT ---\n${draft}\n\n--- CRITIC FEEDBACK ---\n${critique}\n\nRevise the draft to satisfy the revision checklist. Output the improved deliverable only.`,
      allowTools: false,
    });
    revised = result.content;
    emit(3, { status: "done", content: revised, toolsUsed: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revise stage failed.";
    emit(3, { status: "error", error: message });
    throw error;
  }

  // 5. Present
  emit(4, { status: "running" });
  try {
    const result = await runModelTurn({
      model: models.researcher,
      system: ROLE_SYSTEM.researcher + "\n" + PRESENTER_ADDON,
      userContent: `Operator goal:\n${prompt}\n\n--- RESEARCH ---\n${research}\n\n--- FIRST DRAFT ---\n${draft}\n\n--- CRITIQUE ---\n${critique}\n\n--- REVISED DELIVERABLE ---\n${revised}\n\nWrite the final response to the operator.`,
      allowTools: false,
    });
    finalContent = result.content;
    emit(4, { status: "done", content: finalContent, toolsUsed: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Present stage failed.";
    emit(4, { status: "error", error: message });
    throw error;
  }

  return { models, stages, finalContent, totalToolsUsed };
}

export { MODEL_OPTIONS };
