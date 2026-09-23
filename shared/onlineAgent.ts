export const ONLINE_AGENT_DEFAULT_MODEL = "claude-sonnet-4-6";

export function formatOnlineAgentPrompt(prompt: string): string {
  const normalized = prompt.trim();
  if (!normalized) throw new Error("An online-agent prompt is required.");
  return `@onlineagent ${normalized}`;
}

export function formatLornaAgentProbe(): string {
  return "lorna2 --node agent --quiet -p \"/node agent\"";
}
