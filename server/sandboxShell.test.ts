import { describe, expect, it } from "vitest";

describe("sandbox shell bridge secret", () => {
  it("authenticates against the configured lightweight health endpoint", async () => {
    const baseUrl = process.env.SANDBOX_SHELL_URL;
    const key = process.env.SANDBOX_SHELL_KEY;
    expect(baseUrl).toBeTruthy();
    expect(key).toBeTruthy();
    const response = await fetch(`${String(baseUrl).replace(/\/$/, "")}/health`, {
      headers: { "X-API-Key": String(key) },
    });
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ ok: true, service: "sandbox-shell", temporary: true });
  });
});
