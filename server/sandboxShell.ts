import { ENV } from "./_core/env";

export type SandboxBridge = { url: string; key: string };

function configured() {
  if (!ENV.sandboxShellUrl || !ENV.sandboxShellKey) throw new Error("Sandbox shell bridge is not configured for this deployment.");
  return { url: ENV.sandboxShellUrl.replace(/\/$/, ""), key: ENV.sandboxShellKey };
}

async function jsonRequest(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", "content-type": "application/json", ...(init.headers || {}) } });
  const text = await response.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text || "Empty response" }; }
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || payload?.error || `Sandbox bridge failed (${response.status})`);
  return payload;
}

async function validateHub(bridge: SandboxBridge) {
  const response = await fetch(`${bridge.url.replace(/\/$/, "")}/v1/snapshot`, { headers: { "X-API-Key": bridge.key }, cache: "no-store" });
  if (!response.ok) throw new Error("The OMEGA hub key could not be validated for the sandbox relay.");
}

export async function sandboxHealth(bridge: SandboxBridge) {
  await validateHub(bridge);
  const config = configured();
  return jsonRequest(`${config.url}/health`, { headers: { "X-API-Key": config.key } });
}

export async function sandboxExec(bridge: SandboxBridge, command: string, timeout = 30) {
  await validateHub(bridge);
  const config = configured();
  const payload = await jsonRequest(`${config.url}/mcp`, {
    method: "POST",
    headers: { "X-API-Key": config.key },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: "sandbox_exec", arguments: { command, timeout: Math.min(Math.max(timeout, 1), 120) } } }),
  });
  const text = payload?.result?.content?.map((item: any) => item?.text || "").filter(Boolean).join("\n") || JSON.stringify(payload, null, 2);
  return { text };
}

export async function sandboxStream(bridge: SandboxBridge, command: string, timeout = 30) {
  await validateHub(bridge);
  const config = configured();
  return fetch(`${config.url}/stream`, {
    method: "POST",
    headers: { accept: "text/event-stream", "content-type": "application/json", "X-API-Key": config.key },
    body: JSON.stringify({ command, timeout: Math.min(Math.max(timeout, 1), 120) }),
  });
}
