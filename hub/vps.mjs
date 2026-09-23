#!/usr/bin/env node
/**
 * Omega VPS — mesh hub that reverse-connects two nodes.
 * Listens on the platform-provided port when hosted, or 8790 locally.
 */
import http from "node:http";
import { execFile } from "node:child_process";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || process.env.OMEGA_VPS_PORT || 8790);
const HOST = process.env.OMEGA_VPS_HOST || "0.0.0.0";
const CONFIG_PATH = path.join(ROOT, "config.json");
const PUBLIC_URL_PATH = path.join(ROOT, "public-url.txt");
const LOG_PATH = path.join(ROOT, "vps.log");
const PROFILE_PATH = path.join(ROOT, "profiles.enc.json");
const MAX_LOG = 200;
const MAX_OUTPUT = 32_000;

const HUB_TOOLS = [
  {
    name: "hub_ping",
    description: "Ping the Omega VPS. Returns pong plus uptime.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hub_info",
    description: "Read-only identity of this sandbox VPS.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "hub_echo",
    description: "Echo a message through the VPS so you can prove the reverse path.",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
    },
  },
  {
    name: "list_peers",
    description: "List every node reverse-connected to this VPS.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "inbox_post",
    description: "Leave a message on the VPS for the other node.",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Peer id (termux or vps)" },
        body: { type: "string" },
      },
      required: ["body"],
    },
  },
  {
    name: "inbox_read",
    description: "Read messages waiting on the VPS.",
    inputSchema: {
      type: "object",
      properties: { for: { type: "string" } },
    },
  },
  {
    name: "sandbox_exec",
    description: "Run a short shell command inside the Omega VPS sandbox.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "integer", default: 15 },
      },
      required: ["command"],
    },
  },
  {
    name: "call_peer",
    description: "Relay a tool call to another reverse-connected node.",
    inputSchema: {
      type: "object",
      properties: {
        node: { type: "string" },
        tool: { type: "string" },
        args: { type: "object" },
      },
      required: ["node", "tool"],
    },
  },
];

const FALLBACK_TERMUX_TOOLS = [
  {
    name: "termux_exec",
    description: "Run a short shell command on the connected Termux phone.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, timeout: { type: "integer", default: 20 } },
      required: ["command"],
    },
  },
  {
    name: "battery_status",
    description: "Read the connected Termux phone battery status.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "connector_health",
    description: "Read Termux connector health and status.",
    inputSchema: { type: "object", properties: {} },
  },
];

function advertisedTools(termuxTools = null) {
  const byName = new Map(HUB_TOOLS.map((tool) => [tool.name, tool]));
  for (const tool of FALLBACK_TERMUX_TOOLS) byName.set(tool.name, tool);
  const dynamicTools = termuxTools ?? state.termuxTools;
  for (const tool of dynamicTools) {
    if (tool && typeof tool.name === "string") byName.set(tool.name, tool);
  }
  return [...byName.values()];
}

function now() {
  return new Date().toISOString();
}

function logLine(entry) {
  const row = { t: now(), ...entry };
  state.transcript.unshift(row);
  if (state.transcript.length > MAX_LOG) state.transcript.length = MAX_LOG;
  try {
    writeFileSync(
      LOG_PATH,
      state.transcript
        .slice()
        .reverse()
        .map((r) => JSON.stringify(r))
        .join("\n") + "\n",
    );
  } catch {
    /* ignore */
  }
}

function loadConfig() {
  mkdirSync(ROOT, { recursive: true });
  const envConfig = {
    hubKey: process.env.OMEGA_HUB_KEY || "",
    termux: {
      url: process.env.OMEGA_TERMUX_URL || "",
      key: process.env.OMEGA_TERMUX_KEY || "",
    },
  };
  if (process.env.RENDER || process.env.NODE_ENV === "production") {
    if (!envConfig.hubKey) {
      throw new Error("Production hub requires OMEGA_HUB_KEY");
    }
    return envConfig;
  }
  if (existsSync(CONFIG_PATH)) {
    try {
      const fileConfig = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      return {
        ...fileConfig,
        ...(envConfig.hubKey ? { hubKey: envConfig.hubKey } : {}),
        termux: {
          ...(fileConfig.termux || {}),
          ...(envConfig.termux.url ? { url: envConfig.termux.url } : {}),
          ...(envConfig.termux.key ? { key: envConfig.termux.key } : {}),
        },
      };
    } catch {
      /* fall through */
    }
  }
  if (envConfig.hubKey && envConfig.termux.url && envConfig.termux.key) {
    return envConfig;
  }
  const cfg = { hubKey: randomBytes(32).toString("hex"), termux: {} };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return cfg;
}

const config = loadConfig();
const startedAt = Date.now();

const state = {
  publicUrl: existsSync(PUBLIC_URL_PATH)
    ? readFileSync(PUBLIC_URL_PATH, "utf8").trim()
    : "",
  termuxSession: null,
  termuxTools: [],
  termuxLastError: null,
  inbox: [],
  jobs: new Map(),
  waiters: [],
  sessions: new Map(),
  transcript: [],
  peers: {
    vps: {
      id: "vps",
      name: "Omega VPS",
      role: "hub",
      via: "local",
      status: "live",
      lastSeen: now(),
      tools: advertisedTools([]).map((t) => t.name),
      latencyMs: 0,
    },
    termux: {
      id: "termux",
      name: "Omega Termux",
      role: "phone",
      via: "ngrok",
      status: "connecting",
      lastSeen: null,
      tools: [],
      latencyMs: null,
      reverse: false,
    },
  },
};

function setPublicUrl(url) {
  if (!url) return;
  state.publicUrl = url.replace(/\/$/, "");
  writeFileSync(PUBLIC_URL_PATH, state.publicUrl);
}

function refreshPublicUrl() {
  try {
    if (existsSync(PUBLIC_URL_PATH)) {
      const u = readFileSync(PUBLIC_URL_PATH, "utf8").trim();
      if (u) state.publicUrl = u;
    }
  } catch {
    /* ignore */
  }
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

function extractKey(req) {
  const h = req.headers;
  return (
    h["x-api-key"] ||
    (typeof h.authorization === "string" &&
    h.authorization.toLowerCase().startsWith("bearer ")
      ? h.authorization.slice(7).trim()
      : "") ||
    ""
  );
}

function authorized(req) {
  return safeEqual(extractKey(req), config.hubKey);
}

function send(res, status, body, extra = {}) {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": extra.type || "application/json",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers":
      "Content-Type, Accept, Authorization, X-API-Key, Mcp-Session-Id",
    "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
    ...extra.headers,
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > 2_000_000) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function textResult(id, text) {
  return rpcResult(id, {
    content: [{ type: "text", text: String(text) }],
  });
}

function runShell(command, timeoutSec = 15) {
  return new Promise((resolve) => {
    const t = Math.min(Math.max(Number(timeoutSec) || 15, 1), 30);
    execFile(
      "/bin/bash",
      ["-lc", command],
      { timeout: t * 1000, maxBuffer: MAX_OUTPUT, cwd: "/workspace" },
      (err, stdout, stderr) => {
        const out = String(stdout || "").slice(0, MAX_OUTPUT);
        const er = String(stderr || "").slice(0, 4000);
        resolve({
          ok: !err,
          code: err && err.code ? err.code : 0,
          stdout: out,
          stderr: er,
        });
      },
    );
  });
}

async function termuxFetch(body, sessionId) {
  const url = `${config.termux.url.replace(/\/$/, "")}/mcp`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "x-api-key": config.termux.key,
    "ngrok-skip-browser-warning": "true",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 800) };
  }
  return { status: res.status, headers: res.headers, json, text, latencyMs };
}

async function ensureTermuxSession() {
  const init = await termuxFetch({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "omega-vps", version: "1.0.0" },
    },
  });
  if (init.status !== 200) {
    throw new Error(
      `termux initialize ${init.status}: ${JSON.stringify(init.json).slice(0, 200)}`,
    );
  }
  const sid =
    init.headers.get("mcp-session-id") ||
    init.headers.get("Mcp-Session-Id") ||
    randomUUID();
  await termuxFetch(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    sid,
  );
  const listed = await termuxFetch(
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    sid,
  );
  const tools = listed.json?.result?.tools || [];
  state.termuxSession = sid;
  state.termuxTools = tools;
  state.peers.termux.tools = tools.map((t) => t.name);
  state.peers.termux.status = "live";
  state.peers.termux.lastSeen = now();
  state.peers.termux.latencyMs = listed.latencyMs;
  state.termuxLastError = null;
  return sid;
}

async function callTermuxTool(name, args = {}) {
  let sid = state.termuxSession;
  try {
    if (!sid) sid = await ensureTermuxSession();
    const res = await termuxFetch(
      {
        jsonrpc: "2.0",
        id: Date.now() % 1_000_000,
        method: "tools/call",
        params: { name, arguments: args || {} },
      },
      sid,
    );
    if (res.status === 404 || res.status === 400) {
      sid = await ensureTermuxSession();
      return callTermuxTool(name, args);
    }
    if (res.status !== 200) {
      throw new Error(`termux ${name} HTTP ${res.status}`);
    }
    state.peers.termux.lastSeen = now();
    state.peers.termux.latencyMs = res.latencyMs;
    state.peers.termux.status = "live";
    return res.json;
  } catch (err) {
    state.termuxLastError = String(err.message || err);
    state.peers.termux.status = state.peers.termux.reverse ? "reverse" : "down";
    throw err;
  }
}

function enqueueReverseJob(tool, args) {
  const id = randomUUID();
  const job = {
    id,
    tool,
    args: args || {},
    createdAt: now(),
  };
  const waiter = state.waiters.shift();
  if (waiter) {
    waiter.resolve({ jobs: [job] });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.jobs.delete(id);
      reject(new Error("reverse job timed out"));
    }, 25_000);
    state.jobs.set(id, {
      ...job,
      dispatched: Boolean(waiter),
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
  });
}

function takeQueuedJobs() {
  const pending = [];
  for (const [id, job] of state.jobs) {
    if (job.dispatched) continue;
    if (!job.tool) continue;
    job.dispatched = true;
    pending.push({ id: job.id, tool: job.tool, args: job.args });
    if (pending.length >= 4) break;
  }
  return pending;
}

function hubInfo() {
  return {
    service: "omega-vps",
    version: "1.0.0",
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    publicUrl: state.publicUrl || null,
    cwd: "/workspace",
    peers: Object.values(state.peers).map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      via: p.via,
      reverse: Boolean(p.reverse),
      lastSeen: p.lastSeen,
    })),
  };
}

async function runHubTool(name, args = {}) {
  switch (name) {
    case "hub_ping":
      return { pong: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) };
    case "hub_info":
      return hubInfo();
    case "hub_echo":
      logLine({ kind: "echo", from: "mcp", message: args.message || "" });
      return { echoed: args.message || "", at: now(), node: "vps" };
    case "list_peers":
      return Object.values(state.peers);
    case "inbox_post": {
      const msg = {
        id: randomUUID(),
        to: args.to || "vps",
        body: String(args.body || ""),
        at: now(),
      };
      state.inbox.unshift(msg);
      if (state.inbox.length > 50) state.inbox.length = 50;
      logLine({ kind: "inbox", ...msg });
      return { ok: true, id: msg.id };
    }
    case "inbox_read": {
      const dest = args.for || "vps";
      return state.inbox.filter((m) => m.to === dest || dest === "*");
    }
    case "sandbox_exec": {
      const result = await runShell(args.command, args.timeout);
      logLine({
        kind: "sandbox_exec",
        command: String(args.command || "").slice(0, 200),
        ok: result.ok,
      });
      return result;
    }
    case "call_peer":
      return invokeNode(args.node, args.tool, args.args || {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function invokeNode(node, tool, args) {
  const target = String(node || "");
  logLine({ kind: "invoke", node: target, tool, args });
  if (target === "vps" || target === "hub") {
    const result = await runHubTool(tool, args || {});
    return { node: "vps", tool, result };
  }
  if (target === "termux" || target === "phone") {
    try {
      const json = await callTermuxTool(tool, args || {});
      const text =
        json?.result?.content?.map((c) => c.text).join("\n") ||
        JSON.stringify(json, null, 2);
      return { node: "termux", tool, result: json?.result ?? json, text };
    } catch (err) {
      if (state.peers.termux.reverse) {
        const reverseResult = await enqueueReverseJob(tool, args || {});
        return { node: "termux", tool, via: "reverse", result: reverseResult };
      }
      throw err;
    }
  }
  throw new Error(`Unknown node: ${target}`);
}

function snapshot() {
  refreshPublicUrl();
  state.peers.vps.lastSeen = now();
  state.peers.vps.status = "live";
  return {
    ok: true,
    service: "omega-vps",
    startedAt: new Date(startedAt).toISOString(),
    publicUrl: state.publicUrl || null,
    termuxUrl: config.termux.url,
    termuxConfigured: Boolean(config.termux.key),
    peers: Object.values(state.peers),
    inbox: state.inbox.slice(0, 20),
    transcript: state.transcript.slice(0, 60),
    termuxLastError: state.termuxLastError,
    reverseConnect: {
      url: state.publicUrl ? `${state.publicUrl}/v1/reverse` : null,
      mcp: state.publicUrl ? `${state.publicUrl}/mcp` : null,
      health: state.publicUrl ? `${state.publicUrl}/health` : null,
    },
  };
}

function readEncryptedProfiles() {
  try { return JSON.parse(readFileSync(PROFILE_PATH, "utf8")); } catch { return { version: 1, blob: null, updatedAt: null }; }
}

function writeEncryptedProfiles(payload) {
  writeFileSync(PROFILE_PATH, JSON.stringify({ version: 1, blob: String(payload.blob || ""), updatedAt: now() }));
}

async function handleProfile(req, res, bodyText) {
  if (req.method === "GET") { send(res, 200, readEncryptedProfiles()); return; }
  if (req.method !== "PUT") { send(res, 405, { error: "method not allowed" }); return; }
  let payload;
  try { payload = JSON.parse(bodyText || "{}"); } catch { send(res, 400, { error: "invalid json" }); return; }
  if (!payload.blob || typeof payload.blob !== "string" || payload.blob.length > 200000) { send(res, 400, { error: "invalid encrypted profile blob" }); return; }
  writeEncryptedProfiles(payload);
  send(res, 200, readEncryptedProfiles());
}

function websocketKey(request) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "vps"}`);
  return request.headers["x-api-key"] || url.searchParams.get("key") || "";
}

const meshWss = new WebSocketServer({ noServer: true });
const meshSockets = new Set();

function broadcastSnapshot() {
  const payload = JSON.stringify({ type: "snapshot", snapshot: snapshot() });
  for (const socket of meshSockets) {
    if (socket.readyState === WebSocket.OPEN) socket.send(payload);
  }
}

meshWss.on("connection", (socket) => {
  meshSockets.add(socket);
  socket.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() }));
  socket.on("close", () => meshSockets.delete(socket));
  socket.on("error", () => meshSockets.delete(socket));
});

async function handleMcp(req, res, bodyText) {
  if (req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    });
    res.write(": omega-vps keepalive\n\n");
    const iv = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);
    req.on("close", () => clearInterval(iv));
    return;
  }
  if (req.method !== "POST") {
    send(res, 405, { error: "method not allowed" });
    return;
  }
  let msg;
  try {
    msg = JSON.parse(bodyText || "{}");
  } catch {
    send(res, 400, rpcError(null, -32700, "Parse error"));
    return;
  }
  const { id, method, params } = msg;
  if (!method) {
    send(res, 202, "");
    return;
  }
  if (method === "initialize") {
    const sid = randomUUID();
    state.sessions.set(sid, { createdAt: now() });
    send(res, 200, rpcResult(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "omega-vps", version: "1.0.0" },
      instructions:
        "Omega VPS mesh hub. Reverse-connected nodes can call hub_* tools and relay to Termux.",
    }), { headers: { "mcp-session-id": sid } });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") {
    send(res, 202, "");
    return;
  }
  if (method === "ping") {
    send(res, 200, rpcResult(id, {}));
    return;
  }
  if (method === "tools/list") {
    send(res, 200, rpcResult(id, { tools: advertisedTools() }));
    return;
  }
  if (method === "tools/call") {
    try {
      const name = params?.name;
      const args = params?.arguments || {};
      const result = HUB_TOOLS.some((tool) => tool.name === name)
        ? await runHubTool(name, args)
        : await invokeNode("termux", name, args);
      send(
        res,
        200,
        textResult(id, typeof result === "string" ? result : JSON.stringify(result, null, 2)),
      );
    } catch (err) {
      send(res, 200, rpcError(id, -32000, String(err.message || err)));
    }
    return;
  }
  send(res, 200, rpcError(id, -32601, `Method not found: ${method}`));
}

async function handleReverse(req, res, pathname, bodyText) {
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = {};
  }
  const nodeId = body.node || body.id || "termux";

  if (pathname.endsWith("/hello") || pathname === "/v1/reverse") {
    state.peers.termux.reverse = true;
    state.peers.termux.via = "reverse";
    state.peers.termux.status = "live";
    state.peers.termux.lastSeen = now();
    logLine({ kind: "reverse-hello", node: nodeId });
    const advertised = Array.isArray(body.tools) ? body.tools : [];
    if (advertised.length) {
      state.termuxTools = advertised.filter((tool) => tool && typeof tool.name === "string");
      state.peers.termux.tools = state.termuxTools.map((tool) => tool.name);
    }
    send(res, 200, {
      ok: true,
      assigned: "termux",
      hub: hubInfo(),
      tools: advertisedTools().map((t) => t.name),
    });
    return;
  }

  if (pathname.endsWith("/wait")) {
    state.peers.termux.reverse = true;
    state.peers.termux.status = "live";
    state.peers.termux.lastSeen = now();
    const queued = takeQueuedJobs();
    if (queued.length) {
      send(res, 200, { jobs: queued });
      return;
    }
    const job = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.waiters = state.waiters.filter((w) => w.resolve !== resolveWrapped);
        resolve({ jobs: [] });
      }, 20_000);
      const resolveWrapped = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      state.waiters.push({ resolve: resolveWrapped });
    });
    send(res, 200, job);
    return;
  }

  if (pathname.endsWith("/result")) {
    const job = state.jobs.get(body.jobId);
    if (job && job.resolve) {
      job.resolve(body.result ?? body);
      state.jobs.delete(body.jobId);
    }
    send(res, 200, { ok: true });
    return;
  }

  if (pathname.endsWith("/heartbeat")) {
    state.peers.termux.reverse = true;
    state.peers.termux.via = "reverse";
    state.peers.termux.status = "live";
    state.peers.termux.lastSeen = now();
    send(res, 200, { ok: true, t: now() });
    return;
  }

  send(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "vps"}`);
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") {
      send(res, 204, "");
      return;
    }

    if (pathname === "/health") {
      refreshPublicUrl();
      send(res, 200, {
        ok: true,
        service: "omega-vps",
        transport: "streamable-http",
        port: PORT,
        publicUrl: state.publicUrl || null,
        peers: {
          vps: state.peers.vps.status,
          termux: state.peers.termux.status,
        },
      });
      return;
    }

    const needsAuth =
      pathname === "/mcp" ||
      pathname.startsWith("/v1/");
    if (needsAuth && !authorized(req) && pathname !== "/v1/public-url") {
      send(res, 401, { error: "unauthorized" });
      return;
    }

    if (pathname === "/v1/public-url") {
      refreshPublicUrl();
      send(res, 200, { publicUrl: state.publicUrl || null });
      return;
    }

    if (pathname === "/v1/profile") {
      const bodyText = req.method === "PUT" ? await readBody(req) : "";
      await handleProfile(req, res, bodyText);
      return;
    }

    if (pathname === "/mcp") {
      const bodyText = req.method === "POST" ? await readBody(req) : "";
      await handleMcp(req, res, bodyText);
      return;
    }

    if (pathname === "/v1/snapshot") {
      send(res, 200, snapshot());
      return;
    }

    if (pathname === "/v1/invoke" && req.method === "POST") {
      const bodyText = await readBody(req);
      const body = JSON.parse(bodyText || "{}");
      try {
        const result = await invokeNode(body.node, body.tool, body.args || {});
        send(res, 200, { ok: true, ...result });
      } catch (err) {
        send(res, 200, { ok: false, error: String(err.message || err) });
      }
      return;
    }

    if (pathname.startsWith("/v1/reverse")) {
      const bodyText = req.method === "POST" ? await readBody(req) : "";
      await handleReverse(req, res, pathname, bodyText);
      return;
    }

    send(res, 404, { error: "not found" });
  } catch (err) {
    send(res, 500, { error: String(err.message || err) });
  }
});

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || "/", `http://${request.headers.host || "vps"}`).pathname;
  const authHeaders = { ...request.headers, "x-api-key": websocketKey(request) };
  if (pathname !== "/v1/ws" || !authorized({ headers: authHeaders })) {
    socket.destroy();
    return;
  }
  meshWss.handleUpgrade(request, socket, head, (ws) => meshWss.emit("connection", ws, request));
});

setInterval(broadcastSnapshot, 5000).unref();

server.listen(PORT, HOST, async () => {
  logLine({ kind: "boot", port: PORT, host: HOST });
  console.log(`[omega-vps] listening on ${HOST}:${PORT}`);
  if (!config.termux.url || !config.termux.key) {
    console.log("[omega-vps] waiting for reverse-connected Termux");
    return;
  }
  try {
    await ensureTermuxSession();
    const batt = await callTermuxTool("battery_status", {});
    logLine({ kind: "termux-hello", via: "ngrok", battery: batt });
    console.log("[omega-vps] termux outbound MCP live");
  } catch (err) {
    console.error("[omega-vps] termux connect failed:", err.message || err);
    logLine({ kind: "termux-error", error: String(err.message || err) });
  }
});
