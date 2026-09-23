import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import {
  runHtt3Pipeline,
  resolvePipelineModels,
  DEFAULT_PIPELINE_MODELS,
  type PipelineModelAssignment,
  type PipelineRunResult,
  type PipelineStage,
} from "./pipeline";
import { MODEL_OPTIONS, type ChatModel } from "./assistant";
import type { McpBridgeConfig } from "./mcp";

const modelSchema = z.enum(MODEL_OPTIONS.map((option) => option.id) as [ChatModel, ...ChatModel[]]);
const bridgeConfigSchema = z.object({
  url: z.string().url().max(500),
  key: z.string().min(8).max(512),
});
const pipelineInputSchema = z.object({
  prompt: z.string().trim().min(1).max(120000),
  researcher: modelSchema.optional(),
  implementer: modelSchema.optional(),
  critic: modelSchema.optional(),
  bridge: bridgeConfigSchema.optional(),
});

type PipelineJob = {
  jobId: string;
  status: "running" | "done" | "error";
  stages: PipelineStage[];
  result?: PipelineRunResult;
  error?: string;
};

const jobs = new Map<string, PipelineJob>();

function initialStages(models: PipelineModelAssignment): PipelineStage[] {
  return [
    { id: "research", role: "researcher", model: models.researcher, label: "Research & gather context", status: "pending" },
    { id: "implement", role: "implementer", model: models.implementer, label: "Implement / write deliverable", status: "pending" },
    { id: "critique", role: "critic", model: models.critic, label: "Critique & improve", status: "pending" },
    { id: "revise", role: "implementer", model: models.implementer, label: "Revise from critique", status: "pending" },
    { id: "present", role: "researcher", model: models.researcher, label: "Present final answer", status: "pending" },
  ];
}

export const pipelineRouter = router({
  defaults: publicProcedure.query(() => ({
    models: DEFAULT_PIPELINE_MODELS,
    catalog: MODEL_OPTIONS,
    stages: initialStages(DEFAULT_PIPELINE_MODELS).map(({ id, role, label }) => ({ id, role, label })),
  })),

  start: publicProcedure.input(pipelineInputSchema).mutation(({ input }) => {
    const models = resolvePipelineModels({ researcher: input.researcher, implementer: input.implementer, critic: input.critic } as Partial<PipelineModelAssignment>);
    const jobId = crypto.randomUUID();
    const job: PipelineJob = { jobId, status: "running", stages: initialStages(models) };
    jobs.set(jobId, job);

    void runHtt3Pipeline({
      prompt: input.prompt,
      models,
      bridge: input.bridge as McpBridgeConfig | undefined,
      onStage: (stage) => {
        const current = jobs.get(jobId);
        if (current) current.stages = current.stages.map((item) => item.id === stage.id ? stage : item);
      },
    }).then((result) => {
      const current = jobs.get(jobId);
      if (current) {
        current.status = "done";
        current.result = result;
        current.stages = result.stages;
      }
    }).catch((error) => {
      const current = jobs.get(jobId);
      if (current) {
        current.status = "error";
        current.error = error instanceof Error ? error.message : "Pipeline failed.";
      }
    });

    return { jobId };
  }),

  status: publicProcedure.input(z.object({ jobId: z.string().uuid() })).query(({ input }) => {
    const job = jobs.get(input.jobId);
    if (!job) throw new Error("Pipeline job not found or expired.");
    return {
      jobId: job.jobId,
      status: job.status,
      stages: job.stages,
      finalContent: job.result?.finalContent || "",
      totalToolsUsed: job.result?.totalToolsUsed || 0,
      error: job.error || null,
    };
  }),

  // Kept for non-streaming callers that already use the original package contract.
  run: publicProcedure.input(pipelineInputSchema).mutation(async ({ input }) => {
    const models = resolvePipelineModels({ researcher: input.researcher, implementer: input.implementer, critic: input.critic } as Partial<PipelineModelAssignment>);
    return runHtt3Pipeline({ prompt: input.prompt, models, bridge: input.bridge as McpBridgeConfig | undefined });
  }),
});
