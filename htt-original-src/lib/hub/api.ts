import { createServerFn } from "@tanstack/react-start";

const HUB = process.env.OMEGA_VPS_ORIGIN || "http://127.0.0.1:8790";

async function hubKey(): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  const raw = await readFile("/workspace/hub/config.json", "utf8");
  const cfg = JSON.parse(raw) as { hubKey: string };
  return cfg.hubKey;
}

async function hubFetch(path: string, init?: RequestInit) {
  const key = await hubKey();
  const res = await fetch(`${HUB}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: text.slice(0, 400) };
  }
}

export type Peer = {
  id: string;
  name: string;
  role: string;
  via: string;
  status: string;
  lastSeen: string | null;
  tools: string[];
  latencyMs: number | null;
  reverse?: boolean;
};

export type TranscriptRow = {
  t: string;
  kind: string;
  detail: string;
};

export type HubSnapshot = {
  ok: boolean;
  service: string;
  startedAt: string;
  publicUrl: string | null;
  hubKey: string;
  termuxUrl: string;
  termuxConfigured: boolean;
  peers: Peer[];
  inbox: Array<{ id: string; to: string; body: string; at: string }>;
  transcript: TranscriptRow[];
  termuxLastError: string | null;
  reverseConnect: {
    url: string | null;
    mcp: string | null;
    health: string | null;
  };
  error?: string;
};

function asPeer(value: unknown): Peer {
  const p = (value ?? {}) as Record<string, unknown>;
  const tools = Array.isArray(p.tools) ? p.tools.map(String) : [];
  return {
    id: String(p.id ?? ""),
    name: String(p.name ?? ""),
    role: String(p.role ?? ""),
    via: String(p.via ?? ""),
    status: String(p.status ?? "down"),
    lastSeen: p.lastSeen == null ? null : String(p.lastSeen),
    tools,
    latencyMs: typeof p.latencyMs === "number" ? p.latencyMs : null,
    reverse: Boolean(p.reverse),
  };
}

function emptySnapshot(error: string): HubSnapshot {
  return {
    ok: false,
    error,
    service: "omega-vps",
    startedAt: "",
    publicUrl: null,
    hubKey: "",
    termuxUrl: "",
    termuxConfigured: false,
    peers: [],
    inbox: [],
    transcript: [],
    termuxLastError: null,
    reverseConnect: { url: null, mcp: null, health: null },
  };
}

export const getHubSnapshot = createServerFn({ method: "POST" }).handler(
  async (): Promise<HubSnapshot> => {
    try {
      const raw = await hubFetch("/v1/snapshot");
      const reverse = (raw.reverseConnect ?? {}) as Record<string, unknown>;
      const inbox = Array.isArray(raw.inbox) ? raw.inbox : [];
      const transcript = Array.isArray(raw.transcript) ? raw.transcript : [];
      return {
        ok: Boolean(raw.ok),
        service: String(raw.service ?? "omega-vps"),
        startedAt: String(raw.startedAt ?? ""),
        publicUrl: raw.publicUrl ? String(raw.publicUrl) : null,
        hubKey: String(raw.hubKey ?? ""),
        termuxUrl: String(raw.termuxUrl ?? ""),
        termuxConfigured: Boolean(raw.termuxConfigured),
        peers: Array.isArray(raw.peers) ? raw.peers.map(asPeer) : [],
        inbox: inbox.map((row) => {
          const m = row as Record<string, unknown>;
          return {
            id: String(m.id ?? ""),
            to: String(m.to ?? ""),
            body: String(m.body ?? ""),
            at: String(m.at ?? ""),
          };
        }),
        transcript: transcript.map((row) => {
          const m = row as Record<string, unknown>;
          return {
            t: String(m.t ?? ""),
            kind: String(m.kind ?? "event"),
            detail: JSON.stringify(m).slice(0, 240),
          };
        }),
        termuxLastError: raw.termuxLastError ? String(raw.termuxLastError) : null,
        reverseConnect: {
          url: reverse.url ? String(reverse.url) : null,
          mcp: reverse.mcp ? String(reverse.mcp) : null,
          health: reverse.health ? String(reverse.health) : null,
        },
      };
    } catch (err) {
      return emptySnapshot(err instanceof Error ? err.message : "VPS unreachable");
    }
  },
);

export const invokeHub = createServerFn({ method: "POST" })
  .validator((input: { node: string; tool: string; argsJson: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean; text: string }> => {
    let args: Record<string, string | number | boolean | null> = {};
    if (data.argsJson.trim()) {
      const parsed: unknown = JSON.parse(data.argsJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, string | number | boolean | null>;
      }
    }
    const raw = await hubFetch("/v1/invoke", {
      method: "POST",
      body: JSON.stringify({
        node: data.node,
        tool: data.tool,
        args,
      }),
    });
    return {
      ok: Boolean(raw.ok),
      text: JSON.stringify(raw, null, 2).slice(0, 8000),
    };
  });
