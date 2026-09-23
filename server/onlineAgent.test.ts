import { describe, expect, it } from "vitest";
import { formatLornaAgentProbe, formatOnlineAgentPrompt } from "../shared/onlineAgent";

describe("online agent relay", () => {
  it("prefixes prompts for the Termux dispatcher", () => {
    expect(formatOnlineAgentPrompt("  reply with exactly: onlineagent-ok  ")).toBe("@onlineagent reply with exactly: onlineagent-ok");
  });

  it("rejects empty prompts", () => {
    expect(() => formatOnlineAgentPrompt(" \n ")).toThrow("prompt is required");
  });

  it("provides the explicit lorna2 agent probe command", () => {
    expect(formatLornaAgentProbe()).toBe('lorna2 --node agent --quiet -p "/node agent"');
  });
});
