import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  BatteryCharging,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Folder,
  KeyRound,
  LoaderCircle,
  Lock,
  LockKeyhole,
  MessageSquare,
  Network,
  Radio,
  Route,
  Server,
  Send,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Unplug,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { callMcpTool, listMcpTools, probeMcpHealth } from "@/lib/mcp/actions";
import { askManusAssistant } from "@/lib/assistant/actions";
import { DEFAULT_MCP_URL } from "@/lib/omega/defaults";
import { useOmegaStore } from "@/lib/omega/store";
import type { BatteryInfo, ConnectorInfo } from "@/lib/omega/types";

function parseMaybeJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function parseBattery(text: string): BatteryInfo | null {
  const parsed = parseMaybeJson(text);
  if (!parsed || typeof parsed !== "object") return null;
  const rec = parsed as Record<string, unknown>;
  return {
    health: typeof rec.health === "string" ? rec.health : undefined,
    status: typeof rec.status === "string" ? rec.status : undefined,
    plugged: typeof rec.plugged === "string" ? rec.plugged : undefined,
    temperature: typeof rec.temperature === "number" ? rec.temperature : undefined,
    voltage: typeof rec.voltage === "number" ? rec.voltage : undefined,
    percentage: typeof rec.percentage === "number" ? rec.percentage : undefined,
    level: typeof rec.level === "number" ? rec.level : undefined,
  };
}

function parseConnectors(text: string): ConnectorInfo[] {
  const parsed = parseMaybeJson(text) as { connectors?: ConnectorInfo[] } | null;
  return parsed?.connectors ?? [];
}

function AssistantPanel({ creds }: { creds: { url: string; apiKey: string } }) {
  const ask = useMutation({ mutationFn: askManusAssistant });
  const relay = useMutation({ mutationFn: (body: string) => callMcpTool({ data: { ...creds, name: "inbox_post", args: { to: "termux", body }, timeoutMs: 20000 } }) });
  const readRelay = useMutation({ mutationFn: () => callMcpTool({ data: { ...creds, name: "inbox_read", args: { for: "*" }, timeoutMs: 20000 } }) });
  const [prompt, setPrompt] = useState("");
  const [termuxMessage, setTermuxMessage] = useState("");
  const [termuxReply, setTermuxReply] = useState("No Termux reply loaded.");
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const next = prompt.trim();
    if (!next || ask.isPending) return;
    try {
      const response = await ask.mutateAsync({ data: { prompt: next, history: history.slice(-8) } });
      setHistory((current) => [...current, { role: "user", content: next }, { role: "assistant", content: response.content }]);
      setPrompt("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Assistant request failed");
    }
  }
  async function sendToTermux(event: FormEvent) {
    event.preventDefault();
    const body = termuxMessage.trim();
    if (!body || relay.isPending) return;
    try { await relay.mutateAsync(body); setTermuxMessage(""); toast.success("Message sent to Termux"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Termux relay failed"); }
  }
  async function loadTermuxReplies() {
    try { const result = await readRelay.mutateAsync(); setTermuxReply(result.text || "No messages returned."); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not read Termux replies"); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4" />Manus Assistant</CardTitle>
              <CardDescription>Ask the Manus LLM from the canonical OMEGA console. This does not route to a local model.</CardDescription>
            </div>
            <Badge variant={ask.isPending ? "warn" : "live"}>{ask.isPending ? "Thinking" : "Ready"}</Badge>
          </div>
          <div className="mt-5 max-h-[430px] min-h-56 space-y-3 overflow-auto rounded-md bg-background p-4">
            {history.length ? history.map((entry, index) => (
              <div key={`${entry.role}-${index}`} className={`rounded-md p-3 text-sm ${entry.role === "user" ? "ml-8 bg-muted" : "mr-8 border border-border"}`}>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{entry.role === "user" ? "You" : "Manus"}</p>
                <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
              </div>
            )) : <p className="text-sm text-muted-foreground">The assistant response will appear here. Try asking for a deployment explanation, a test plan, or help interpreting a Termux result.</p>}
          </div>
          <form className="mt-4 space-y-3" onSubmit={submit}>
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask Manus anything about this mesh..." rows={4} />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">History stays in this browser session.</span>
              <Button type="submit" disabled={ask.isPending || !prompt.trim()}>{ask.isPending ? <LoaderCircle className="animate-spin" /> : <Sparkles className="size-4" />} Ask Manus</Button>
            </div>
          </form>
        </div>
      </Card>
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="size-4" />Termux message bridge</CardTitle>
              <CardDescription>Send from this website to the phone CLI and load replies posted back through the existing OMEGA inbox.</CardDescription>
            </div>
            <Badge variant="live">TWO-WAY</Badge>
          </div>
          <form className="mt-5 space-y-3" onSubmit={sendToTermux}>
            <Textarea value={termuxMessage} onChange={(event) => setTermuxMessage(event.target.value)} placeholder="Message the Termux CLI..." rows={4} />
            <Button type="submit" disabled={relay.isPending || !termuxMessage.trim()}>{relay.isPending ? <LoaderCircle className="animate-spin" /> : <Send className="size-4" />} Send to Termux</Button>
          </form>
          <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Termux can reply with its existing <code className="font-mono text-foreground">inbox_post</code> tool.</p><Button type="button" variant="secondary" size="sm" onClick={() => void loadTermuxReplies()} disabled={readRelay.isPending}>{readRelay.isPending ? <LoaderCircle className="animate-spin" /> : "Load replies"}</Button></div>
          <pre className="mt-3 max-h-48 overflow-auto rounded-md bg-background p-4 font-mono text-xs leading-relaxed">{termuxReply}</pre>
        </div>
      </Card>
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <CardTitle className="text-base">Routing contract</CardTitle>
          <CardDescription className="mt-1">The assistant path is additive and separate from Termux execution.</CardDescription>
          <div className="mt-5 space-y-3 text-sm">
            <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Assistant</p><p className="mt-1 font-mono text-xs">browser → Render server function → Manus LLM</p></div>
            <div className="rounded-md bg-muted p-3"><p className="text-xs text-muted-foreground">Existing command path</p><p className="mt-1 font-mono text-xs">browser → OMEGA hub → reverse Termux bridge</p></div>
            <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-live" />No Manus or hub secret is embedded in the client bundle.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function OmegaConsole({ joinKey }: { joinKey?: string }) {
  const unlocked = useOmegaStore((s) => s.unlocked);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const done = () => setHydrated(true);
    const persistApi = useOmegaStore.persist;
    void Promise.resolve(persistApi.rehydrate()).finally(done);
  }, []);

  useEffect(() => {
    if (!hydrated || !joinKey) return;
    const current = useOmegaStore.getState();
    current.unlock(current.url || DEFAULT_MCP_URL, joinKey);
  }, [hydrated, joinKey]);

  if (!hydrated || !unlocked) {
    return <UnlockGate />;
  }

  return <BridgeWorkspace />;
}

function UnlockGate() {
  const url = useOmegaStore((s) => s.url);
  const setUrl = useOmegaStore((s) => s.setUrl);
  const unlock = useOmegaStore((s) => s.unlock);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const health = useQuery({
    queryKey: ["mcp-health", url],
    queryFn: () => probeMcpHealth({ data: { url } }),
    refetchInterval: 12000,
  });

  async function onJoin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await listMcpTools({
        data: { url, apiKey: key.trim() },
      });
      unlock(url, key.trim());
      toast.success(`Joined ${result.tools.length} tools`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Join failed");
    } finally {
      setBusy(false);
    }
  }

  const live = health.data?.ok === true;

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-8 px-5 py-10">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          OMEGA // mesh activation
        </p>
        <h1 className="text-4xl font-medium tracking-tight">Bring the mesh online.</h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          One control plane for your VPS, reverse-connected Termux node, and home
          network. Activate each link once, then let OMEGA prove the path.
        </p>
      </div>
      <ActivationRail />
      <Card className="rounded-xl p-1">
        <div className="rounded-lg bg-card p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Bridge</p>
              <p className="text-xs text-muted-foreground">
                Health does not need a key. Use the OMEGA_HUB_KEY for tools.
              </p>
            </div>
            <Badge variant={live ? "live" : "warn"}>
              {live ? "Live" : health.isLoading ? "Checking" : "Offline"}
            </Badge>
          </div>
          <form className="space-y-4" onSubmit={onJoin}>
            <div className="space-y-2">
              <Label htmlFor="mcp-url">MCP URL</Label>
              <Input
                id="mcp-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-key">X-API-Key</Label>
              <Input
                id="mcp-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Omega hub key"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy || key.length < 8}>
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              Join bridge
            </Button>
            <div className="rounded-lg border border-border bg-background/70 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="flex items-center gap-2 font-medium text-foreground"><ShieldCheck className="size-3.5 text-live" /> Stable key rule</p>
              <p className="mt-1">Use the same Render secret every time. On Termux, load it from <code className="font-mono text-foreground">$HOME/omega-hub-key.txt</code>; never generate a new key during a restart.</p>
              <p className="mt-1">Canonical hub: <code className="font-mono text-foreground">omega-hub-canonical.onrender.com</code></p>
            </div>
          </form>
        </div>
      </Card>
    </main>
  );
}

function ActivationRail() {
  const steps = [
    ["01", "Connect VPS", "Authenticated hub"],
    ["02", "Pair Termux", "Reverse bridge"],
    ["03", "Reach home", "CGNAT-safe route"],
    ["04", "Verify trust", "Secrets stay local"],
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {steps.map(([number, title, detail], index) => (
        <div key={number} className="activation-step rounded-lg bg-card/70 p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">{number}</span>
            {index === 0 ? <CheckCircle2 className="size-4 text-live" /> : <CircleDot className="size-4 text-muted-foreground" />}
          </div>
          <p className="mt-3 text-xs font-medium">{title}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
        </div>
      ))}
    </div>
  );
}

function BridgeWorkspace() {
  const url = useOmegaStore((s) => s.url);
  const apiKey = useOmegaStore((s) => s.apiKey);
  const lock = useOmegaStore((s) => s.lock);
  const creds = useMemo(() => ({ url, apiKey }), [url, apiKey]);

  const health = useQuery({
    queryKey: ["mcp-health", url],
    queryFn: () => probeMcpHealth({ data: { url } }),
    refetchInterval: 10000,
  });

  const tools = useQuery({
    queryKey: ["mcp-tools", url, apiKey],
    queryFn: () => listMcpTools({ data: creds }),
  });

  const battery = useQuery({
    queryKey: ["mcp-battery", url, apiKey],
    queryFn: async () => {
      const result = await callMcpTool({
        data: { ...creds, name: "battery_status", timeoutMs: 15000 },
      });
      return parseBattery(result.text);
    },
    refetchInterval: 30000,
  });

  const live = health.data?.ok === true;
  const pct = Number(battery.data?.percentage ?? battery.data?.level ?? NaN);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              v2.4 backup relay
            </p>
          <h1 className="truncate text-lg font-medium tracking-tight">OMEGA Mesh</h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={live ? "live" : "warn"}>{live ? "Live" : "Offline"}</Badge>
            <Button variant="ghost" size="sm" onClick={() => lock()}>
              <Unplug className="size-4" />
              <span className="hidden sm:inline">Disconnect</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <MeshHero live={live} termuxTools={tools.data?.tools ?? []} creds={creds} />
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Bridge"
            value={live ? "Connected" : "Down"}
            hint={health.data?.service || "omega-termux-mcp"}
            icon={<Radio className="size-4" />}
          />
          <StatCard
            label="Tools"
            value={String(tools.data?.tools.length ?? "—")}
            hint="streamable-http :8787"
            icon={<Activity className="size-4" />}
          />
          <StatCard
            label="Battery"
            value={Number.isFinite(pct) ? `${pct}%` : "—"}
            hint={
              battery.data
                ? `${String(battery.data.status ?? "unknown")} · ${String(battery.data.plugged ?? "unplugged")}`
                : "Android battery"
            }
            icon={<BatteryCharging className="size-4" />}
          />
          <StatCard
            label="Auth"
            value="X-API-Key"
            hint="Bearer is rejected by this bridge"
            icon={<Lock className="size-4" />}
          />
        </section>

        <Tabs defaultValue="shell">
          <TabsList>
            <TabsTrigger value="mesh">Mesh</TabsTrigger>
            <TabsTrigger value="shell">Shell</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="network">Network</TabsTrigger>
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
          </TabsList>
          <TabsContent value="mesh">
            <MeshPanel creds={creds} tools={tools.data?.tools ?? []} />
          </TabsContent>
          <TabsContent value="shell">
            <ShellPanel creds={creds} />
          </TabsContent>
          <TabsContent value="files">
            <FilesPanel creds={creds} />
          </TabsContent>
          <TabsContent value="network">
            <NetworkPanel creds={creds} battery={battery.data} />
          </TabsContent>
          <TabsContent value="tools">
            <ToolsPanel creds={creds} tools={tools.data?.tools ?? []} />
          </TabsContent>
          <TabsContent value="assistant">
            <AssistantPanel creds={creds} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function MeshHero({
  live,
  termuxTools,
  creds,
}: {
  live: boolean;
  termuxTools: Array<{ name: string; description: string }>;
  creds: { url: string; apiKey: string };
}) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<string[]>([]);
  const hubReady = live;
  const termuxReady = termuxTools.length > 0;

  async function runAutopilot() {
    setRunning(true);
    setReport([]);
    const checks: Array<[string, string]> = [
      ["VPS hub", "hub_ping"],
      ["Termux bridge", "list_peers"],
      ["Network path", "network_snapshot"],
    ];
    for (const [label, name] of checks) {
      try {
        const result = await callMcpTool({ data: { ...creds, name, timeoutMs: 20000 } });
        setReport((current) => [...current, `${result.ok ? "PASS" : "WARN"}  ${label}`]);
      } catch {
        setReport((current) => [...current, `WARN  ${label} · peer not answering`]);
      }
    }
    setRunning(false);
  }

  return (
    <section className="mesh-hero overflow-hidden rounded-2xl border border-border bg-card/80 p-1">
      <div className="relative rounded-xl p-5 sm:p-6">
        <div className="mesh-grid" aria-hidden="true" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Sparkles className="size-3.5 text-warn" />
              Mission control
            </div>
            <h2 className="mt-3 max-w-xl text-3xl font-medium tracking-tight sm:text-4xl">
              A private path home, visible at a glance.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
              OMEGA turns a VPS, phone, and router into one living mesh. The autopilot checks the path instead of making you guess which hop failed.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runAutopilot} disabled={running}>
                {running ? <LoaderCircle className="animate-spin" /> : <Route className="size-4" />}
                {running ? "Tracing mesh…" : "Run mesh autopilot"}
              </Button>
              <span className="text-xs text-muted-foreground">No credentials are sent to the browser map.</span>
            </div>
            {report.length ? (
              <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
                {report.map((line) => <span key={line} className="rounded-full bg-muted px-3 py-1 font-mono text-[11px] text-muted-foreground">{line}</span>)}
              </div>
            ) : null}
          </div>
          <MeshMap hubReady={hubReady} termuxReady={termuxReady} />
        </div>
        <TrustStrip />
      </div>
    </section>
  );
}

function MeshMap({ hubReady, termuxReady }: { hubReady: boolean; termuxReady: boolean }) {
  const nodes = [
    { name: "REMOTE", detail: "split tunnel", className: "mesh-node remote" },
    { name: "VPS RELAY", detail: hubReady ? "authenticated" : "waiting", className: "mesh-node relay", ready: hubReady },
    { name: "TERMUX", detail: termuxReady ? "reverse link" : "reconnecting", className: "mesh-node termux", ready: termuxReady },
    { name: "HOME LAN", detail: "WireGuard route", className: "mesh-node home", ready: true },
  ];
  return (
    <div className="mesh-map relative min-h-64 rounded-xl bg-background/75 p-4" aria-label="OMEGA mesh topology">
      <div className="mesh-line mesh-line-a" />
      <div className="mesh-line mesh-line-b" />
      <div className="mesh-line mesh-line-c" />
      {nodes.map((node) => (
        <div key={node.name} className={`${node.className} ${node.ready ? "is-ready" : ""}`}>
          <span className="mesh-pulse" />
          <span className="font-mono text-[10px] tracking-[0.14em]">{node.name}</span>
          <span className="mt-1 text-[11px] text-muted-foreground">{node.detail}</span>
        </div>
      ))}
    </div>
  );
}

function TrustStrip() {
  return (
    <div className="mt-5 grid gap-2 border-t border-border/70 pt-4 sm:grid-cols-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-live" /><span><strong className="text-foreground">Encrypted profiles</strong> · AES-GCM backup</span></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><KeyRound className="size-4 text-warn" /><span><strong className="text-foreground">Runtime-only key</strong> · never committed</span></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><LockKeyhole className="size-4 text-live" /><span><strong className="text-foreground">Least exposure</strong> · local router credentials</span></div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <Card className="rounded-xl p-1">
      <div className="rounded-lg p-4">
        <div className="mb-3 flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
          {icon}
        </div>
        <p className="text-2xl font-medium tabular-nums tracking-tight">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
      </div>
    </Card>
  );
}

function MeshPanel({
  creds,
  tools,
}: {
  creds: { url: string; apiKey: string };
  tools: Array<{ name: string; description: string }>;
}) {
  const [result, setResult] = useState("No mesh call yet.");
  const hubTools = tools.filter((tool) => tool.name.startsWith("hub_") || tool.name === "list_peers" || tool.name === "call_peer");
  const termuxTools = tools.filter((tool) => !tool.name.startsWith("hub_") && tool.name !== "list_peers" && tool.name !== "call_peer");
  const call = useMutation({
    mutationFn: (name: string) => callMcpTool({ data: { ...creds, name, timeoutMs: 20000 } }),
    onSuccess: (response) => setResult(response.text || "Call completed without output."),
    onError: (error) => setResult(error instanceof Error ? error.message : "Mesh call failed"),
  });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <PeerCard
          icon={<CircleDot className="size-4" />}
          title="Omega Termux"
          subtitle="termux"
          path="reverse"
          status={termuxTools.length ? "Live" : "Waiting"}
          detail={`${termuxTools.length} advertised tools`}
          tools={termuxTools.slice(0, 8).map((tool) => tool.name)}
        />
        <PeerCard
          icon={<Server className="size-4" />}
          title="Omega VPS"
          subtitle="vps"
          path="local"
          status={hubTools.length ? "Live" : "Not advertised"}
          detail={hubTools.length ? `${hubTools.length} mesh tools` : "Hub peer tools are not exposed by this gateway yet"}
          tools={hubTools.slice(0, 8).map((tool) => tool.name)}
        />
      </div>
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base"><Network className="size-4" />Mesh actions</CardTitle>
              <CardDescription>Call advertised peer tools without changing the existing Shell, Files, Network, or Tools views.</CardDescription>
            </div>
            <Button variant="secondary" size="sm" disabled={call.isPending || !hubTools.length} onClick={() => call.mutate("hub_ping")}>
              {call.isPending ? <LoaderCircle className="animate-spin" /> : <Send className="size-4" />} Ping VPS
            </Button>
          </div>
          <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-background p-4 font-mono text-xs leading-relaxed">{result}</pre>
        </div>
      </Card>
    </div>
  );
}

function PeerCard({
  icon,
  title,
  subtitle,
  path,
  status,
  detail,
  tools,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  path: string;
  status: string;
  detail: string;
  tools: string[];
}) {
  return (
    <Card className="rounded-xl p-1">
      <div className="rounded-lg p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">{icon}<div><p className="text-sm font-medium">{title}</p><p className="font-mono text-xs text-muted-foreground">{subtitle}</p></div></div>
          <Badge variant={status === "Live" ? "live" : "warn"}>{status}</Badge>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-muted-foreground">Path</p><p className="mt-1 font-mono">{path}</p></div><div><p className="text-xs text-muted-foreground">Status</p><p className="mt-1 truncate">{detail}</p></div></div>
        <div className="mt-5 flex flex-wrap gap-2">{tools.length ? tools.map((tool) => <span key={tool} className="rounded-full bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">{tool}</span>) : <span className="text-xs text-muted-foreground">No tools advertised</span>}</div>
      </div>
    </Card>
  );
}

function ShellPanel({ creds }: { creds: { url: string; apiKey: string } }) {
  const history = useOmegaStore((s) => s.history);
  const pushHistory = useOmegaStore((s) => s.pushHistory);
  const [command, setCommand] = useState("uname -a");
  const outputRef = useRef<HTMLPreElement>(null);

  const run = useMutation({
    mutationFn: (cmd: string) =>
      callMcpTool({
        data: {
          ...creds,
          name: "termux_exec",
          args: { command: cmd, timeout: 30 },
          timeoutMs: 40000,
        },
      }),
    onSuccess: (result, cmd) => {
      pushHistory({ command: cmd, output: result.text, ok: result.ok });
      if (!result.ok) toast.error("Command returned an error");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Exec failed");
    },
  });

  useEffect(() => {
    outputRef.current?.scrollTo({ top: 0 });
  }, [history[0]?.id]);

  const latest = history[0];

  return (
    <Card className="rounded-xl p-1">
      <div className="rounded-lg">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TerminalSquare className="size-4" />
            termux_exec
          </CardTitle>
          <CardDescription>
            Isolated shell on the phone. Catastrophic commands are blocked here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <pre
            ref={outputRef}
            className="max-h-80 min-h-52 overflow-auto rounded-md bg-background p-4 font-mono text-xs leading-relaxed text-secondary-foreground"
          >
            {latest
              ? `$ ${latest.command}\n\n${latest.output}`
              : "No commands yet. Output from the phone appears here."}
          </pre>
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (!command.trim()) return;
              run.mutate(command.trim());
            }}
          >
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              aria-label="Shell command"
            />
            <Button type="submit" disabled={run.isPending} className="sm:w-32">
              {run.isPending ? <LoaderCircle className="animate-spin" /> : "Run"}
            </Button>
          </form>
          {history.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {history.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="max-w-full truncate rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setCommand(entry.command)}
                >
                  {entry.command}
                </button>
              ))}
            </div>
          ) : null}
        </CardContent>
      </div>
    </Card>
  );
}

function FilesPanel({ creds }: { creds: { url: string; apiKey: string } }) {
  const cwd = useOmegaStore((s) => s.cwd);
  const setCwd = useOmegaStore((s) => s.setCwd);
  const [path, setPath] = useState(cwd);
  const [listing, setListing] = useState("");
  const [filePath, setFilePath] = useState("");
  const [fileBody, setFileBody] = useState("");

  const list = useMutation({
    mutationFn: (target: string) =>
      callMcpTool({
        data: {
          ...creds,
          name: "termux_exec",
          args: {
            command: `ls -la -- ${JSON.stringify(target)}`,
            timeout: 20,
          },
          timeoutMs: 30000,
        },
      }),
    onSuccess: (result, target) => {
      setListing(result.text);
      setCwd(target);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "List failed"),
  });

  const read = useMutation({
    mutationFn: (target: string) =>
      callMcpTool({
        data: {
          ...creds,
          name: "read_file",
          args: { path: target },
          timeoutMs: 25000,
        },
      }),
    onSuccess: (result) => setFileBody(result.text),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Read failed"),
  });

  const write = useMutation({
    mutationFn: () =>
      callMcpTool({
        data: {
          ...creds,
          name: "write_file",
          args: { path: filePath, content: fileBody },
          timeoutMs: 25000,
        },
      }),
    onSuccess: () => toast.success("Wrote file"),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Write failed"),
  });

  useEffect(() => {
    if (!listing) list.mutate(path);
    // initial listing only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="rounded-xl p-1">
        <div className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Folder className="size-4" />
              Directory
            </CardTitle>
            <CardDescription>Lists through the Termux shell.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                list.mutate(path || ".");
              }}
            >
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="font-mono"
                spellCheck={false}
              />
              <Button type="submit" disabled={list.isPending} className="sm:w-28">
                {list.isPending ? <LoaderCircle className="animate-spin" /> : "List"}
              </Button>
            </form>
            <pre className="max-h-80 overflow-auto rounded-md bg-background p-4 font-mono text-xs leading-relaxed">
              {list.isPending ? "Listing…" : listing || "Empty listing"}
            </pre>
          </CardContent>
        </div>
      </Card>
      <Card className="rounded-xl p-1">
        <div className="rounded-lg">
          <CardHeader>
            <CardTitle className="text-base">File</CardTitle>
            <CardDescription>read_file / write_file on the phone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="~/omega_mcp_bridge.py"
                className="font-mono"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!filePath || read.isPending}
                onClick={() => read.mutate(filePath)}
                className="sm:w-28"
              >
                {read.isPending ? <LoaderCircle className="animate-spin" /> : "Read"}
              </Button>
            </div>
            <Textarea
              value={fileBody}
              onChange={(e) => setFileBody(e.target.value)}
              className="min-h-48 font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!filePath || write.isPending}
              onClick={() => write.mutate()}
            >
              {write.isPending ? <LoaderCircle className="animate-spin" /> : "Write"}
            </Button>
          </CardContent>
        </div>
      </Card>
    </div>
  );
}

function NetworkPanel({
  creds,
  battery,
}: {
  creds: { url: string; apiKey: string };
  battery: BatteryInfo | null | undefined;
}) {
  const [snapshot, setSnapshot] = useState("");
  const snap = useMutation({
    mutationFn: () =>
      callMcpTool({
        data: { ...creds, name: "network_snapshot", timeoutMs: 25000 },
      }),
    onSuccess: (result) => setSnapshot(result.text),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Snapshot failed"),
  });

  useEffect(() => {
    snap.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
      <Card className="rounded-xl p-1">
        <div className="rounded-lg">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wifi className="size-4" />
                network_snapshot
              </CardTitle>
              <CardDescription>Interfaces, DNS, routes, listeners.</CardDescription>
            </div>
            <Button variant="secondary" size="sm" onClick={() => snap.mutate()} disabled={snap.isPending}>
              {snap.isPending ? <LoaderCircle className="animate-spin" /> : "Refresh"}
            </Button>
          </CardHeader>
          <CardContent>
            <pre className="max-h-96 overflow-auto rounded-md bg-background p-4 font-mono text-xs leading-relaxed">
              {snap.isPending && !snapshot ? "Collecting snapshot" : snapshot || "Collecting snapshot"}
            </pre>
          </CardContent>
        </div>
      </Card>
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Device
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            {[
              ["Health", battery?.health ?? null],
              ["Status", battery?.status ?? null],
              ["Plugged", battery?.plugged ?? null],
              ["Temp", battery?.temperature != null ? `${battery.temperature} C` : null],
              ["Voltage", battery?.voltage != null ? `${battery.voltage} mV` : null],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono text-xs tabular-nums">{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Card>
    </div>
  );
}

function ToolsPanel({
  creds,
  tools,
}: {
  creds: { url: string; apiKey: string };
  tools: Array<{ name: string; description: string }>;
}) {
  const [query, setQuery] = useState("");
  const [searchOut, setSearchOut] = useState("");
  const [clip, setClip] = useState("");
  const [openclaw, setOpenclaw] = useState("");

  const connectors = useQuery({
    queryKey: ["mcp-connectors", creds.url, creds.apiKey],
    queryFn: async () => {
      const result = await callMcpTool({
        data: { ...creds, name: "connector_health", timeoutMs: 20000 },
      });
      return parseConnectors(result.text);
    },
  });

  const search = useMutation({
    mutationFn: (q: string) =>
      callMcpTool({
        data: {
          ...creds,
          name: "web_search",
          args: { query: q },
          timeoutMs: 40000,
        },
      }),
    onSuccess: (result) => setSearchOut(result.text),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Search failed"),
  });

  const clipboard = useMutation({
    mutationFn: async (mode: "get" | "set") => {
      if (mode === "get") {
        return callMcpTool({
          data: { ...creds, name: "clipboard_get", timeoutMs: 15000 },
        });
      }
      return callMcpTool({
        data: {
          ...creds,
          name: "clipboard_set",
          args: { text: clip },
          timeoutMs: 15000,
        },
      });
    },
    onSuccess: (result, mode) => {
      if (mode === "get") setClip(result.text);
      else toast.success("Clipboard updated");
    },
  });

  const hands = useMutation({
    mutationFn: () =>
      callMcpTool({
        data: {
          ...creds,
          name: "openclaw_hands",
          args: { action: "status" },
          timeoutMs: 20000,
        },
      }),
    onSuccess: (result) => setOpenclaw(result.text),
    onError: (error) => toast.error(error instanceof Error ? error.message : "OpenClaw failed"),
  });

  return (
    <div className="grid gap-4">
      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <p className="text-sm font-medium">Connectors</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {(connectors.data ?? []).map((item) => (
              <div key={item.name} className="rounded-md bg-muted px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <Badge variant={item.available ? "live" : "mute"}>
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{item.detail}</p>
              </div>
            ))}
            {connectors.isLoading ? (
              <p className="text-sm text-muted-foreground">Reading connector health</p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-xl p-1">
          <div className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-base">web_search</CardTitle>
              <CardDescription>Runs through the OMEGA web connector.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (query.trim()) search.mutate(query.trim());
                }}
              >
                <Input value={query} onChange={(e) => setQuery(e.target.value)} />
                <Button type="submit" disabled={search.isPending} className="sm:w-28">
                  {search.isPending ? <LoaderCircle className="animate-spin" /> : "Search"}
                </Button>
              </form>
              <pre className="max-h-64 overflow-auto rounded-md bg-background p-4 font-mono text-xs">
                {searchOut || "Results appear here"}
              </pre>
            </CardContent>
          </div>
        </Card>
        <Card className="rounded-xl p-1">
          <div className="rounded-lg">
            <CardHeader>
              <CardTitle className="text-base">Clipboard / OpenClaw</CardTitle>
              <CardDescription>Phone clipboard and Hands status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={clip}
                onChange={(e) => setClip(e.target.value)}
                className="min-h-24"
                placeholder="Clipboard text"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => clipboard.mutate("get")}
                  disabled={clipboard.isPending}
                >
                  Read clipboard
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => clipboard.mutate("set")}
                  disabled={clipboard.isPending || !clip}
                >
                  Set clipboard
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => hands.mutate()}
                  disabled={hands.isPending}
                >
                  OpenClaw status
                </Button>
              </div>
              {openclaw ? (
                <pre className="max-h-40 overflow-auto rounded-md bg-background p-4 font-mono text-xs">
                  {openclaw}
                </pre>
              ) : null}
            </CardContent>
          </div>
        </Card>
      </div>

      <Card className="rounded-xl p-1">
        <div className="rounded-lg p-5">
          <p className="text-sm font-medium">Advertised tools</p>
          <ul className="mt-3 divide-y divide-border">
            {tools.map((tool) => (
              <li key={tool.name} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{tool.name}</p>
                  <p className="text-xs text-muted-foreground">{tool.description}</p>
                </div>
                <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
