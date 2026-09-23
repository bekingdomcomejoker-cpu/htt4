import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { callTool, listTools, probeHealth } from "./client.server";

const creds = {
  url: z.string().url(),
  apiKey: z.string().min(8),
};

const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const probeMcpHealth = createServerFn({ method: "POST" })
  .validator(z.object({ url: z.string().url() }))
  .handler(async ({ data }) => probeHealth(data.url));

export const listMcpTools = createServerFn({ method: "POST" })
  .validator(z.object(creds))
  .handler(async ({ data }) => listTools(data));

export const callMcpTool = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...creds,
      name: z.string().min(1),
      args: z.record(z.string(), jsonScalar).optional(),
      timeoutMs: z.number().int().min(1000).max(120000).optional(),
    }),
  )
  .handler(async ({ data }) =>
    callTool({
      url: data.url,
      apiKey: data.apiKey,
      name: data.name,
      args: data.args,
      timeoutMs: data.timeoutMs,
    }),
  );
