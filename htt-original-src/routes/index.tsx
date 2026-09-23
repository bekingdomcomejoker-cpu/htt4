import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowLeftRight,
  Check,
  Copy,
  Radio,
  Server,
  Smartphone,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHubSnapshot, invokeHub, type HubSnapshot, type Peer } from "@/lib/hub/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

const PRESETS: Array<{ node: string; tool: string; label: string; args?: Record<string, unknown> }> = [
  { node: "termux", tool: "battery_status", label: "Termux battery" },
  { node: "termux", tool: "connector_health", label: "Termux connectors" },
  { node: "vps", tool: "hub_info", label: "VPS identity" },
  { node: "vps", tool: "hub_ping", label: "VPS ping" },
  { node: "vps", tool: "list_peers", label: "List peers" },
  {
    node: "vps",
    tool: "sandbox_exec",
    label: "VPS uname",
    args: { command: "uname -a && hostname && date -u" },
  },
  {
    node: "termux",
    tool: "termux_exec",
    label: "Termux uname",
    args: { command: "uname -a && echo reverse-path-ok" },
  },
  {
    node: "vps",
    tool: "hub_echo",
    label: "Echo to VPS",
    args: { message: "termux calling the sandbox" },
  },
];

function statusTone(status: string) {
  if (status === "live" || status === "reverse") return "bg-live";
  if (status === "connecting") return "bg-warn";
  return "bg-down";
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!value) {
    return (
      <div className="rounded-xl bg-surface-2 px-3 py-2">
        <p className="text-xs font-medium text-faint">{label}</p>
        <p className="mt-1 text-sm text-muted">Waiting for tunnel</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-faint">{label}</p>
        <button
          type="button"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-fg"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </button>
      </div>
      <p className={cn("mt-1 break-all text-sm text-fg", mono && "font-mono text-[11px] leading-relaxed")}>
        {value}
      </p>
    </div>
  );
}

function NodeCard({ peer }: { peer: Peer }) {
  const Icon = peer.id === "termux" ? Smartphone : Server;
  return (
    <article className="min-w-0 rounded-3xl bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-surface-2 text-accent">
            <Icon className="size-5" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="text-base font-medium tracking-tight">{peer.name}</h2>
            <p className="font-mono text-xs text-faint">{peer.id}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">
          <span className={cn("size-1.5 rounded-full", statusTone(peer.status))} />
          {peer.status}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-faint">Path</dt>
          <dd className="mt-1 text-fg">
            {peer.reverse ? "reverse" : peer.via}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-faint">Latency</dt>
          <dd className="mt-1 font-mono tabular-nums text-fg">
            {peer.latencyMs == null ? "—" : `${peer.latencyMs} ms`}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-faint">Last seen</dt>
          <dd className="mt-1 font-mono text-xs text-muted">{peer.lastSeen ?? "not yet"}</dd>
        </div>
      </dl>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {(peer.tools.length ? peer.tools : ["waiting"]).slice(0, 8).map((tool) => (
          <span
            key={tool}
            className="rounded-md bg-surface-2 px-2 py-1 font-mono text-[10px] tracking-wide text-muted"
          >
            {tool}
          </span>
        ))}
        {peer.tools.length > 8 ? (
          <span className="rounded-md px-2 py-1 font-mono text-[10px] text-faint">
            +{peer.tools.length - 8}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function Home() {
  const [node, setNode] = useState("termux");
  const [tool, setTool] = useState("battery_status");
  const [argsText, setArgsText] = useState("{}");
  const [lastResult, setLastResult] = useState<string>("");

  const snap = useQuery({
    queryKey: ["hub-snapshot"],
    queryFn: () => getHubSnapshot(),
    refetchInterval: 2500,
  });

  const data: HubSnapshot | undefined = snap.data;
  const peers = data?.peers ?? [];
  const vps = peers.find((p) => p.id === "vps");
  const termux = peers.find((p) => p.id === "termux");

  const invoke = useMutation({
    mutationFn: (input: { node: string; tool: string; args?: Record<string, unknown> }) =>
      invokeHub({ data: { node: input.node, tool: input.tool, argsJson: JSON.stringify(input.args || {}) } }),
    onSuccess: (res) => {
      setLastResult(res.text);
      void snap.refetch();
    },
    onError: (err) => setLastResult(String(err)),
  });

  const reverseCmd = useMemo(() => {
    if (!data?.publicUrl || !data.hubKey) return "";
    return `OMEGA_HUB_URL='${data.publicUrl}' OMEGA_HUB_KEY='${data.hubKey}' nohup python3 "$HOME/omega_reverse.py" > "$HOME/.omega-reverse.log" 2>&1 &`;
  }, [data?.publicUrl, data?.hubKey]);

  const liveCount = peers.filter((p) => p.status === "live" || p.status === "reverse").length;

  async function runPreset(preset: (typeof PRESETS)[number]) {
    setNode(preset.node);
    setTool(preset.tool);
    setArgsText(JSON.stringify(preset.args || {}, null, 2));
    invoke.mutate({ node: preset.node, tool: preset.tool, args: preset.args || {} });
  }

  function runManual() {
    let args: Record<string, unknown> = {};
    try {
      args = argsText.trim() ? (JSON.parse(argsText) as Record<string, unknown>) : {};
    } catch {
      setLastResult("Arguments must be valid JSON.");
      return;
    }
    invoke.mutate({ node, tool, args });
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-bg px-4 pb-16 pt-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] tracking-[0.22em] text-faint uppercase">
              Omega mesh
            </p>
            <h1 className="mt-2 text-3xl font-medium tracking-tight text-fg sm:text-4xl">
              VPS
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
              Both directions are live. This sandbox is the hub. Termux is a peer.
              Either side can call the other through the VPS.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/control-plane" className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted hover:text-fg">
              Control Plane
            </Link>
          </div>
          <div className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <Radio className="size-4 text-live" />
            <div>
              <p className="text-xs text-faint">Mesh</p>
              <p className="font-mono text-sm tabular-nums text-fg">
                {liveCount}/{Math.max(peers.length, 2)} live
              </p>
            </div>
          </div>
        </header>

        <section className="grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
          {termux ? <NodeCard peer={termux} /> : <div className="rounded-3xl bg-surface p-4 text-muted">Termux connecting</div>}
          <div className="hidden flex-col items-center justify-center gap-2 lg:flex">
            <ArrowLeftRight className="size-5 text-accent" />
            <span className="font-mono text-[10px] tracking-[0.18em] text-faint uppercase">
              reverse
            </span>
          </div>
          {vps ? <NodeCard peer={vps} /> : <div className="rounded-3xl bg-surface p-4 text-muted">VPS booting</div>}
        </section>

        <section className="min-w-0 rounded-3xl bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            <h2 className="text-sm font-medium">Credentials for the reverse path</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CopyField label="Your hub key" value={data?.hubKey || ""} />
            <CopyField label="Public VPS URL" value={data?.publicUrl || ""} />
            <CopyField label="VPS MCP" value={data?.reverseConnect.mcp || ""} />
            <CopyField label="Termux MCP (outbound from hub)" value={data?.termuxUrl || ""} />
          </div>
          <div className="mt-3">
            <CopyField label="Termux reverse-connect" value={reverseCmd} />
          </div>
          {data?.termuxLastError ? (
            <p className="mt-3 text-sm text-down">{data.termuxLastError}</p>
          ) : null}
        </section>

        <section className="grid min-w-0 gap-4 lg:grid-cols-5">
          <div className="min-w-0 rounded-3xl bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:col-span-3">
            <div className="mb-4 flex items-center gap-2">
              <Terminal className="size-4 text-accent" />
              <h2 className="text-sm font-medium">Call a node</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => runPreset(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-faint">Node</span>
                <select
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg"
                  value={node}
                  onChange={(e) => setNode(e.target.value)}
                >
                  <option value="termux">termux</option>
                  <option value="vps">vps</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-faint">Tool</span>
                <input
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono text-sm text-fg"
                  value={tool}
                  onChange={(e) => setTool(e.target.value)}
                />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="text-xs font-medium text-faint">Arguments JSON</span>
              <textarea
                className="mt-1 min-h-24 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-fg"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </label>
            <div className="mt-3 flex justify-end">
              <Button type="button" onClick={runManual} disabled={invoke.isPending}>
                {invoke.isPending ? "Calling" : "Run"}
              </Button>
            </div>
            <pre className="mt-4 max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-bg p-4 font-mono text-xs leading-relaxed text-muted">
              {lastResult || "Results land here."}
            </pre>
          </div>

          <div className="min-w-0 rounded-3xl bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:col-span-2">
            <h2 className="text-sm font-medium">Transcript</h2>
            <ul className="mt-3 space-y-2">
              {(data?.transcript ?? []).slice(0, 14).map((row, i) => (
                <li
                  key={String(row.t ?? i)}
                  className="rounded-xl bg-surface-2 px-3 py-2"
                >
                  <p className="font-mono text-[10px] text-faint">{String(row.t ?? "")}</p>
                  <p className="mt-1 font-mono text-xs text-fg">{String(row.kind ?? "event")}</p>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted">
                    {row.detail}
                  </p>
                </li>
              ))}
              {!data?.transcript?.length ? (
                <li className="text-sm text-muted">No events yet.</li>
              ) : null}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
