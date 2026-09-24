import http from "node:http";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const token = process.env.SANDBOX_SHELL_TOKEN;
const port = Number(process.env.PORT || 11436);
if (!token) throw new Error("SANDBOX_SHELL_TOKEN is required");

const tools = [
  { name: "sandbox_exec", description: "Run an approved operator shell command in the current temporary sandbox.", inputSchema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "integer" } }, required: ["command"] } },
  { name: "sandbox_health", description: "Read the current sandbox bridge health.", inputSchema: { type: "object", properties: {} } },
];
process.on("uncaughtException", (error) => console.error("bridge uncaught", error));
process.on("unhandledRejection", (error) => console.error("bridge rejection", error));
function send(res, status, payload, headers = {}) { const body = JSON.stringify(payload); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body), ...headers }); res.end(body); }
function authorized(req) { return req.headers["x-api-key"] === token || req.headers.authorization === `Bearer ${token}`; }
function run(command, timeout) {
  return new Promise((resolve) => execFile("/bin/bash", ["-lc", command], { timeout: Math.min(Math.max(Number(timeout) || 30, 1), 120), maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, code: error?.code || 0, stdout: stdout.slice(0, 24000), stderr: stderr.slice(0, 4000), host: "manus-sandbox" })));
}
function streamCommand(command, timeout, res) {
  const child = spawn("/bin/bash", ["-lc", command], { stdio: ["ignore", "pipe", "pipe"] });
  const timer = setTimeout(() => child.kill("SIGTERM"), Math.min(Math.max(Number(timeout) || 30, 1), 120) * 1000);
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
  const write = (type, text) => res.write(`data: ${JSON.stringify({ type, text })}\n\n`);
  child.stdout.on("data", (chunk) => write("stdout", chunk.toString()));
  child.stderr.on("data", (chunk) => write("stderr", chunk.toString()));
  child.on("close", (code, signal) => { clearTimeout(timer); write("done", JSON.stringify({ ok: code === 0, code: code ?? -1, signal })); res.end(); });
  res.on("close", () => { clearTimeout(timer); child.kill("SIGTERM"); });
}
const server = http.createServer(async (req, res) => {
  if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
  const url = new URL(req.url || "/", `http://${req.headers.host || "sandbox"}`);
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true, service: "sandbox-shell", temporary: true, tools: tools.map((tool) => tool.name) });
  if (req.method === "POST" && url.pathname === "/stream") {
    let body = {}; try { body = JSON.parse(await new Promise((resolve, reject) => { let data = ""; req.on("data", (chunk) => { data += chunk; }); req.on("end", () => resolve(data)); req.on("error", reject); })); } catch { return send(res, 400, { error: "invalid JSON" }); }
    if (typeof body.command !== "string" || !body.command.trim()) return send(res, 400, { error: "command is required" });
    return streamCommand(body.command, body.timeout, res);
  }
  if (req.method !== "POST" || url.pathname !== "/mcp") return send(res, 404, { error: "not found" });
  let body = {}; try { body = JSON.parse(await new Promise((resolve, reject) => { let data = ""; req.on("data", (chunk) => { data += chunk; if (data.length > 200000) reject(new Error("request too large")); }); req.on("end", () => resolve(data)); req.on("error", reject); })); } catch { return send(res, 400, { error: "invalid JSON" }); }
  console.log("mcp method", body.method, "id", body.id);
  const id = body.id ?? null;
  if (body.method === "initialize") return send(res, 200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "manus-sandbox-shell", version: "1.0.0" } }, }, { "Mcp-Session-Id": randomUUID() });
  if (body.method === "notifications/initialized") return send(res, 200, { jsonrpc: "2.0", id, result: {} });
  if (body.method === "tools/list") return send(res, 200, { jsonrpc: "2.0", id, result: { tools } });
  if (body.method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    if (name === "sandbox_health") return send(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ ok: true, host: "manus-sandbox", temporary: true }) }] } });
    if (name === "sandbox_exec") {
      if (typeof args.command !== "string" || !args.command.trim()) return send(res, 200, { jsonrpc: "2.0", id, error: { code: -32602, message: "command is required" } });
      const result = await run(args.command, args.timeout);
      return send(res, 200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    }
    return send(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
  }
  return send(res, 200, { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
});
server.listen(port, "0.0.0.0", () => console.log(`Sandbox shell bridge listening on port ${port}`));
