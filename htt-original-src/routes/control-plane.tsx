import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, ArrowLeftRight, ExternalLink, Radio, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getHubSnapshot, invokeHub } from "@/lib/hub/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/control-plane")({ component: ControlPlane });

function tone(status: string) {
  if (status === "live" || status === "reverse") return "bg-live";
  if (status === "connecting") return "bg-warn";
  return "bg-down";
}

function ControlPlane() {
  const [node, setNode] = useState("termux");
  const [tool, setTool] = useState("connector_health");
  const [args, setArgs] = useState("{}");
  const [result, setResult] = useState("");

  const snap = useQuery({
    queryKey: ["hub-snapshot"],
    queryFn: getHubSnapshot,
    refetchInterval: 2500,
  });
  const data = snap.data;
  const peers = data?.peers ?? [];
  const live = peers.filter((p) => p.status === "live" || p.status === "reverse").length;
  const termux = peers.find((p) => p.id === "termux");
  const vps = peers.find((p) => p.id === "vps");

  const invoke = useMutation({
    mutationFn: async () => {
      const parsed = args.trim() ? JSON.parse(args) : {};
      return invokeHub({ data: { node, tool, argsJson: JSON.stringify(parsed) } });
    },
    onSuccess: (r) => {
      setResult(r.text);
      void snap.refetch();
    },
    onError: (e) => setResult(String(e)),
  });

  return (
    <main className="min-h-screen overflow-x-hidden bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/95 px-4 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full border border-accent text-accent">Ω</div>
            <div>
              <p className="font-mono text-xs tracking-[0.16em] text-faint">OMEGA CONTROL PLANE</p>
              <p className="text-xs text-muted">ARCHITECTURE • RELAY • WORKERS • TOOLS</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 font-mono text-[11px] text-muted">
            <span className={cn("size-1.5 rounded-full", data?.ok ? "bg-live" : "bg-down")} />
            {data?.ok ? "ONLINE" : "CONNECTING"}
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[220px_1fr]">
        <nav className="h-fit rounded-3xl bg-surface p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
          <p className="px-3 pb-2 pt-1 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Control</p>
          <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg">Overview</div>
          <a className="mt-1 block rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg" href="#relay">Relay / VPS</a>
          <a className="mt-1 block rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg" href="#tools">Tools</a>
          <p className="px-3 pb-2 pt-5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Existing application</p>
          <Link className="block rounded-xl px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg" to="/">Mesh / VPS dashboard</Link>
        </nav>

        <div className="min-w-0 space-y-6">
          <section>
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-faint">Omega / unified surface</p>
                <h1 className="mt-2 text-3xl font-medium tracking-tight sm:text-4xl">Control Plane</h1>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  Additive control surface for the existing OMEGA mesh. The original dashboard remains available at the Mesh / VPS tab.
                </p>
              </div>
              <Link to="/" className="inline-flex items-center gap-2 self-start rounded-xl border border-line bg-surface px-3 py-2 text-sm text-muted hover:text-fg">
                Open existing dashboard <ExternalLink className="size-4" />
              </Link>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Workers / peers", String(peers.length), live ? `${live} live` : "waiting"],
              ["Termux", termux?.status ?? "waiting", termux?.via ?? "no path"],
              ["VPS", vps?.status ?? "waiting", vps?.via ?? "no path"],
              ["Reverse path", data?.reverseConnect?.health ?? "waiting", data?.reverseConnect?.mcp ?? "not advertised"],
            ].map(([label, value, detail]) => (
              <article key={label} className="rounded-2xl bg-surface p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
                <p className="mt-1 text-xs text-muted">{detail}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {[termux, vps].map((peer) => (
              <article key={peer?.id ?? "missing"} className="rounded-3xl bg-surface p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Node</p>
                    <h2 className="mt-1 text-lg">{peer?.name ?? "Waiting"}</h2>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">
                    <span className={cn("size-1.5 rounded-full", tone(peer?.status ?? "down"))} />
                    {peer?.status ?? "down"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-faint">Path</p><p className="mt-1">{peer?.reverse ? "reverse" : peer?.via ?? "—"}</p></div>
                  <div><p className="text-xs text-faint">Latency</p><p className="mt-1 font-mono">{peer?.latencyMs == null ? "—" : `${peer.latencyMs} ms`}</p></div>
                </div>
              </article>
            ))}
          </section>

          <section id="relay" className="rounded-3xl bg-surface p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="flex items-center gap-2"><ArrowLeftRight className="size-4 text-accent" /><h2 className="text-sm font-medium">Relay / VPS</h2></div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-faint">Public URL</p><p className="mt-1 break-all font-mono text-xs">{data?.publicUrl ?? "—"}</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-faint">Reverse MCP</p><p className="mt-1 break-all font-mono text-xs">{data?.reverseConnect?.mcp ?? "—"}</p></div>
              <div className="rounded-xl bg-surface-2 p-3"><p className="text-xs text-faint">Termux URL</p><p className="mt-1 break-all font-mono text-xs">{data?.termuxUrl ?? "—"}</p></div>
            </div>
          </section>

          <section id="tools" className="rounded-3xl bg-surface p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]">
            <div className="flex items-center gap-2"><Terminal className="size-4 text-accent" /><h2 className="text-sm font-medium">Call a node</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-faint">Node<select className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-fg" value={node} onChange={(e) => setNode(e.target.value)}><option value="termux">termux</option><option value="vps">vps</option></select></label>
              <label className="text-xs text-faint">Tool<input className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-2 px-3 font-mono text-sm text-fg" value={tool} onChange={(e) => setTool(e.target.value)} /></label>
            </div>
            <label className="mt-3 block text-xs text-faint">Arguments JSON<textarea className="mt-1 min-h-24 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-fg" value={args} onChange={(e) => setArgs(e.target.value)} /></label>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs text-muted"><Activity className="size-4" /> Live refresh: 2.5s</span>
              <Button type="button" disabled={invoke.isPending} onClick={() => invoke.mutate()}>{invoke.isPending ? "Calling…" : "Run"}</Button>
            </div>
            <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-bg p-4 font-mono text-xs leading-relaxed text-muted">{result || "Results land here."}</pre>
          </section>
        </div>
      </div>
    </main>
  );
}
