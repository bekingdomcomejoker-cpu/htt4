import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { ChatMessageContent } from "@/components/ChatMessageContent";
import PipelineView from "@/components/PipelineView";
import { ModelChatView } from "@/components/ModelChatView";
import { formatLornaAgentProbe, formatOnlineAgentPrompt } from "@shared/onlineAgent";
import {
	  Activity,
	  BatteryCharging,
	  BookmarkPlus,
	  ChevronDown,
	  ChevronLeft,
	  ChevronRight,
	  CircleDot,
  Clipboard,
  Cloud,
  Command,
  FileCode2,
  FolderOpen,
  GitBranch,
  Github,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  Menu,
  MessageCircle,
  Network,
  Radio,
  RefreshCw,
  Router as RouterIcon,
  Search,
  Send,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";

const DEFAULT_URL = "https://omega-hub-canonical.onrender.com";

type Tool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
type Health = { ok: boolean; service?: string; transport?: string; port?: number; peers?: { vps?: string; termux?: string } };
type Snapshot = { peers?: Array<{ id: string; name: string; role: string; via: string; status: string; lastSeen: string | null; tools: string[]; latencyMs: number | null }>; inbox?: Array<{ id: string; to: string; from?: string; body: string; at: string }>; termuxLastError?: string | null; reverseConnect?: { url?: string | null } };

type McpClient = { url: string; key: string; session: string | null };

function normaliseUrl(value: string) { return value.trim().replace(/\/+$/, ""); }

function contentText(payload: any): string {
  const result = payload?.result ?? payload;
  if (Array.isArray(result?.content)) return result.content.map((item: any) => item?.text ?? "").filter(Boolean).join("\n");
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

function jsonText(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function mcpRequest(client: McpClient, method: string, params: Record<string, unknown> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", "X-API-Key": client.key };
  if (client.session) headers["Mcp-Session-Id"] = client.session;
  const response = await fetch(`${normaliseUrl(client.url)}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  const session = response.headers.get("mcp-session-id");
  if (session) client.session = session;
  const payload = await readResponse(response);
  if (!response.ok || payload?.error) throw new Error(payload?.error?.message || `MCP request failed (${response.status})`);
  return payload;
}

async function initialise(client: McpClient) {
  if (client.session) return;
  await mcpRequest(client, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "OMEGA Operator Console", version: "3.0.0" } });
  await mcpRequest(client, "notifications/initialized");
}

async function listTools(client: McpClient): Promise<Tool[]> {
  await initialise(client);
  const payload = await mcpRequest(client, "tools/list");
  return payload?.result?.tools ?? [];
}

async function callTool(client: McpClient, name: string, args: Record<string, unknown> = {}) {
  await initialise(client);
  const payload = await mcpRequest(client, "tools/call", { name, arguments: args });
  return contentText(payload);
}

async function health(url: string): Promise<Health> {
  const response = await fetch(`${normaliseUrl(url)}/health`, { cache: "no-store" });
  return await response.json();
}

async function snapshot(client: McpClient): Promise<Snapshot> {
  const response = await fetch(`${normaliseUrl(client.url)}/v1/snapshot`, { headers: { "X-API-Key": client.key }, cache: "no-store" });
  if (!response.ok) throw new Error(`Snapshot failed (${response.status})`);
  return response.json();
}

function base64(bytes: Uint8Array) { return btoa(String.fromCharCode(...Array.from(bytes))); }
function unbase64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
async function profileKey(passphrase: string) { const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase)); return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]); }
async function encryptProfiles(profiles: unknown[], passphrase: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await profileKey(passphrase); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(profiles))); return `${base64(iv)}.${base64(new Uint8Array(data))}`; }
async function decryptProfiles(blob: string, passphrase: string) { const [iv, data] = blob.split("."); const key = await profileKey(passphrase); const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(iv) }, key, unbase64(data)); return JSON.parse(new TextDecoder().decode(plain)); }

function StatusDot({ live }: { live: boolean }) { return <span className={`status-dot ${live ? "live" : ""}`} />; }
function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "live" | "warn" }) { return <span className={`badge badge-${tone}`}><StatusDot live={tone === "live"} />{children}</span>; }
function IconButton({ children, onClick, label }: { children: ReactNode; onClick?: () => void; label: string }) { return <button type="button" className="icon-button" onClick={onClick} aria-label={label}>{children}</button>; }

function Unlock({ onUnlock }: { onUnlock: (client: McpClient, tools: Tool[], health: Health) => void }) {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [live, setLive] = useState<boolean | null>(null);
  async function check() {
    try { const result = await health(url); setLive(result.ok); } catch { setLive(false); }
  }
  useEffect(() => { void check(); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const client: McpClient = { url, key: key.trim(), session: null };
    try { const [result, status] = await Promise.all([listTools(client), health(url)]); onUnlock(client, result, status); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to unlock the bridge."); }
    finally { setBusy(false); }
  }
  return <div className="unlock-page">
    <div className="unlock-grid" />
    <div className="unlock-shell">
      <div className="unlock-brand"><div className="omega-mark">Ω</div><div><div className="brand-title">OMEGA <span>OPERATOR</span></div><div className="brand-caption">VPS / TERMUX MESH CONTROL PLANE</div></div></div>
      <div className="unlock-card">
        <div className="eyebrow"><span className="eyebrow-line" />SECURE BRIDGE ACCESS</div>
        <h1>Unlock the<br /><em>mesh.</em></h1>
        <p className="unlock-copy">Connect to the Omega hub to inspect peers, discover tools, run commands, and operate both the VPS and reverse-connected Termux node from one surface.</p>
        <form onSubmit={submit} className="unlock-form">
          <label>Hub MCP URL<input value={url} onChange={(event) => setUrl(event.target.value)} spellCheck={false} autoComplete="off" /></label>
          <label>OMEGA_HUB_KEY<div className="secret-input"><KeyRound size={15} /><input value={key} onChange={(event) => setKey(event.target.value)} type="password" placeholder="Paste runtime key" autoComplete="off" /><span className={live ? "key-state good" : "key-state"}>{live === null ? "checking" : live ? "online" : "offline"}</span></div></label>
          {message && <div className="error-box">{message}</div>}
          <button className="unlock-button" type="submit" disabled={busy || key.length < 8}>{busy ? <Loader2 size={16} className="spin" /> : <LockKeyhole size={16} />} {busy ? "Negotiating session..." : "Unlock operator console"}<span>↗</span></button>
        </form>
        <div className="unlock-foot"><ShieldCheck size={14} /> Key stays in this browser session. It is never embedded in the site.</div>
      </div>
      <div className="unlock-status"><span><StatusDot live={live === true} /> {live ? "HUB ONLINE" : "WAITING FOR HUB"}</span><span>STREAMABLE HTTP / MCP</span><span>OMEGA v3.0</span></div>
    </div>
  </div>;
}

const nav = [
  { id: "overview", label: "Overview", icon: Activity },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
  { id: "gateway", label: "Cloud CLI", icon: Command },
  { id: "pipeline", label: "HTT3 Pipeline", icon: GitBranch },
  { id: "modelchat", label: "Model Chat", icon: MessageCircle },
  { id: "mesh", label: "Node Mesh", icon: Network },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "network", label: "Network", icon: Network },
  { id: "router", label: "MikroTik", icon: RouterIcon },
  { id: "tools", label: "Tools", icon: Zap },
  { id: "inbox", label: "Inbox", icon: Send },
];

function AppShell({ client, initialTools, initialHealth, onLock }: { client: McpClient; initialTools: Tool[]; initialHealth: Health; onLock: () => void }) {
	  const [active, setActive] = useState("overview");
	  const [navCollapsed, setNavCollapsed] = useState(() => {
	    try {
	      return localStorage.getItem("omega-nav-collapsed") === "1";
	    } catch {
	      return false;
	    }
	  });
	  const [tools, setTools] = useState(initialTools);
  const [status, setStatus] = useState(initialHealth);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [battery, setBattery] = useState<any>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [toasts, setToasts] = useState<string[]>([]);
  const notify = (text: string) => { setToasts((current) => [...current, text]); window.setTimeout(() => setToasts((current) => current.slice(1)), 2600); };
  async function refresh() {
    setRefreshing(true);
    try { const [nextHealth, nextTools, nextSnap] = await Promise.all([health(client.url), listTools(client), snapshot(client)]); setStatus(nextHealth); setTools(nextTools); setSnap(nextSnap); const batteryText = await callTool(client, "battery_status").catch(() => ""); setBattery(jsonText(batteryText)); notify("Mesh state refreshed"); }
    catch (error) { notify(error instanceof Error ? error.message : "Refresh failed"); }
    finally { setRefreshing(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnect: number | null = null;
    const connect = () => {
      const wsUrl = `${normaliseUrl(client.url).replace(/^http/, "ws")}/v1/ws?key=${encodeURIComponent(client.key)}`;
      socket = new WebSocket(wsUrl);
      socket.onopen = () => setRealtime(true);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === "snapshot") setSnap(message.snapshot);
        } catch { /* ignore malformed heartbeat */ }
      };
      socket.onclose = () => {
        setRealtime(false);
        reconnect = window.setTimeout(connect, 5000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { if (reconnect) window.clearTimeout(reconnect); socket?.close(); };
  }, [client.url, client.key]);
  const hubLive = status.ok && status.peers?.vps === "live";
  const termuxPeer = snap?.peers?.find((peer) => peer.id === "termux");
	  return <div className={`operator-app ${navCollapsed ? "nav-collapsed" : ""}`}>
	    <aside className={`operator-sidebar ${mobileNav ? "open" : ""}`}>
	      <div className="operator-brand"><div className="small-mark">Ω</div><div><div className="brand-title">OMEGA <span>OPERATOR</span></div><div className="brand-caption">MESH CONTROL PLANE</div></div><button type="button" className="nav-collapse-btn" title={navCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => { setNavCollapsed((prev) => { const next = !prev; try { localStorage.setItem("omega-nav-collapsed", next ? "1" : "0"); } catch { /* ignore */ } return next; }); }}>{navCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button><IconButton label="Close navigation" onClick={() => setMobileNav(false)}><X size={17} /></IconButton></div>
      <div className="connection-card"><div className="connection-top"><span className="connection-label">BRIDGE STATUS</span><Badge tone={hubLive ? "live" : "warn"}>{hubLive ? "LIVE" : "OFFLINE"}</Badge></div><div className="connection-url"><span className="status-dot live" />{new URL(normaliseUrl(client.url)).hostname}</div><div className="connection-detail">MCP / port {status.port || "—"}</div></div>
      <div className="nav-caption">CONTROL SURFACES</div>
      <nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={`side-nav-item ${active === id ? "active" : ""}`} onClick={() => { setActive(id); setMobileNav(false); }}><Icon size={16} /><span>{label}</span>{id === "inbox" && snap?.inbox?.length ? <b className="nav-count">{snap.inbox.length}</b> : null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="peer-mini"><div className="mini-peer"><StatusDot live={true} /><span>VPS</span><b>LIVE</b></div><div className="mini-peer"><StatusDot live={termuxPeer?.status === "live"} /><span>TERMUX</span><b>{termuxPeer?.status === "live" ? "LIVE" : "WAITING"}</b></div></div><a href="https://github.com/bekingdomcomejoker-cpu/htt" target="_blank" rel="noreferrer" className="source-link"><Github size={15} /> canonical / htt <Link2 size={13} /></a><button className="disconnect-link" onClick={onLock}><LockKeyhole size={14} /> Lock console</button></div>
    </aside>
    {mobileNav && <div className="mobile-overlay" onClick={() => setMobileNav(false)} />}
    <main className="operator-main">
      <header className="operator-header"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="header-title"><span>OMEGA /</span><strong>{nav.find((item) => item.id === active)?.label}</strong></div><div className="header-actions"><span className="realtime-status"><StatusDot live={realtime} />{realtime ? "LIVE SYNC" : "POLLING"}</span><span className="header-clock">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><IconButton label="Refresh mesh" onClick={() => void refresh()}>{refreshing ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}</IconButton><div className="avatar">OP</div></div></header>
      <div className="operator-content">{active === "overview" && <Overview status={status} snap={snap} tools={tools} battery={battery} onNavigate={setActive} />} {active === "terminal" && <TerminalView client={client} tools={tools} notify={notify} />} {active === "gateway" && <GatewayView client={client} notify={notify} />} {active === "pipeline" && <PipelineView client={client} notify={notify} />} {active === "modelchat" && <ModelChatView client={client} notify={notify} />} {active === "mesh" && <NodeMeshView client={client} snap={snap} notify={notify} />} {active === "files" && <FilesView client={client} notify={notify} />} {active === "network" && <NetworkView client={client} battery={battery} notify={notify} />} {active === "router" && <MikrotikView client={client} notify={notify} />} {active === "tools" && <ToolsView client={client} tools={tools} notify={notify} />} {active === "inbox" && <InboxView client={client} snap={snap} notify={notify} />}</div>
    </main>
    <div className="toast-stack">{toasts.map((toast, index) => <div className="toast" key={`${toast}-${index}`}><StatusDot live={true} />{toast}</div>)}</div>
  </div>;
}

function SectionHead({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: ReactNode }) { return <div className="view-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{eyebrow}</div><h2>{title}</h2><p>{copy}</p></div>{action}</div>; }
function Stat({ label, value, hint, icon: Icon, tone = "default" }: { label: string; value: string; hint: string; icon: any; tone?: string }) { return <div className={`metric-card tone-${tone}`}><div className="metric-top"><span>{label}</span><Icon size={17} /></div><strong>{value}</strong><small>{hint}</small></div>; }

function Overview({ status, snap, tools, battery, onNavigate }: { status: Health; snap: Snapshot | null; tools: Tool[]; battery: any; onNavigate: (id: string) => void }) {
  const vps = snap?.peers?.find((peer) => peer.id === "vps"); const termux = snap?.peers?.find((peer) => peer.id === "termux"); const pct = battery?.percentage ?? battery?.level;
  return <div className="view overview-view"><SectionHead eyebrow="Operator overview / 001" title="The mesh, at a glance." copy="One control plane for the VPS runtime and the reverse-connected Termux peer." action={<Badge tone={status.ok ? "live" : "warn"}>{status.ok ? "ALL SYSTEMS MAPPED" : "BRIDGE OFFLINE"}</Badge>} />
    <div className="metric-grid"><Stat label="Bridge" value={status.ok ? "Connected" : "Down"} hint={status.service || "omega-vps"} icon={Radio} tone="cyan" /><Stat label="Tools" value={String(tools.length)} hint="advertised over MCP" icon={Zap} tone="violet" /><Stat label="Termux" value={termux?.status === "live" ? "Live" : "Waiting"} hint={termux?.tools?.length ? `${termux.tools.length} peer tools` : "start omega_reverse.py"} icon={CircleDot} tone="amber" /><Stat label="Battery" value={pct === undefined ? "—" : `${pct}%`} hint={battery?.status ? `${battery.status} · ${battery.plugged || "unplugged"}` : "Android telemetry"} icon={BatteryCharging} tone="green" /></div>
    <div className="overview-grid"><div className="panel peer-panel"><div className="panel-title"><span>PEER FABRIC</span><button onClick={() => onNavigate("network")}>inspect network ↗</button></div><PeerRow icon={Server} name="Omega VPS" role="hub / local" status={vps?.status || "live"} detail={`${vps?.tools?.length || 0} hub tools`} tone="cyan" /><PeerRow icon={Wifi} name="Omega Termux" role="phone / reverse" status={termux?.status || "connecting"} detail={termux?.tools?.length ? `${termux.tools.length} tools advertised` : "waiting for bridge"} tone="amber" /><div className="mesh-bar"><span>path health</span><div className="bar-track"><i style={{ width: termux?.status === "live" ? "100%" : "50%" }} /></div><b>{termux?.status === "live" ? "2 / 2" : "1 / 2"} peers live</b></div></div><div className="panel quick-panel"><div className="panel-title"><span>QUICK ACTIONS</span><Command size={15} /></div><QuickAction icon={TerminalSquare} label="Open terminal" copy="Run on VPS or Termux" onClick={() => onNavigate("terminal")} /><QuickAction icon={FolderOpen} label="Browse files" copy="Inspect the connected node" onClick={() => onNavigate("files")} /><QuickAction icon={Zap} label="Discover tools" copy={`${tools.length} tools available`} onClick={() => onNavigate("tools")} /><QuickAction icon={Send} label="Open inbox" copy={`${snap?.inbox?.length || 0} messages waiting`} onClick={() => onNavigate("inbox")} /></div></div>
    <div className="runtime-strip"><div><span className="strip-label">CANONICAL RUNTIME</span><strong>omega-hub-canonical</strong><small>https://omega-hub-canonical.onrender.com</small></div><div className="strip-divider" /><div><span className="strip-label">REVERSE CONNECTOR</span><strong>{snap?.reverseConnect?.url ? "endpoint assigned" : "awaiting Termux"}</strong><small>{snap?.reverseConnect?.url || "Run omega_reverse.py on the phone"}</small></div><div className="strip-action"><ShieldCheck size={17} /><span>Secrets stay in runtime config</span></div></div>
  </div>;
}
function PeerRow({ icon: Icon, name, role, status, detail, tone }: { icon: any; name: string; role: string; status: string; detail: string; tone: string }) { const live = status === "live"; return <div className="peer-row"><div className={`peer-icon ${tone}`}><Icon size={17} /></div><div className="peer-name"><strong>{name}</strong><small>{role}</small></div><div className="peer-detail"><span className={live ? "green-text" : "amber-text"}><StatusDot live={live} />{live ? "LIVE" : "WAITING"}</span><small>{detail}</small></div></div>; }
function QuickAction({ icon: Icon, label, copy, onClick }: { icon: any; label: string; copy: string; onClick: () => void }) { return <button className="quick-action" onClick={onClick}><span className="quick-icon"><Icon size={16} /></span><span><strong>{label}</strong><small>{copy}</small></span><span className="quick-arrow">↗</span></button>; }

function TerminalView({ client, tools, notify }: { client: McpClient; tools: Tool[]; notify: (text: string) => void }) { const [target, setTarget] = useState<"vps" | "termux">("termux"); const [command, setCommand] = useState("ip route && ip -4 addr"); const [output, setOutput] = useState("Select a target and run a command."); const [busy, setBusy] = useState(false); const termuxAvailable = tools.some((tool) => tool.name === "termux_exec"); async function run() { setBusy(true); try { const text = await callTool(client, target === "termux" ? "termux_exec" : "sandbox_exec", { command, timeout: 20 }); setOutput(text); } catch (error) { setOutput(error instanceof Error ? error.message : "Command failed"); notify("Command failed"); } finally { setBusy(false); } } return <div className="view"><SectionHead eyebrow="Execution surface / 002" title="Terminal relay." copy="Run bounded commands on the VPS or the connected Termux node." action={<div className="target-switch"><button className={target === "termux" ? "selected" : ""} onClick={() => setTarget("termux")}><Wifi size={14} />Termux</button><button className={target === "vps" ? "selected" : ""} onClick={() => setTarget("vps")}><Server size={14} />VPS</button></div>} /><div className="terminal-panel"><div className="terminal-top"><div className="terminal-dots"><i /><i /><i /></div><span>{target === "termux" ? "termux@redmi13c" : "omega@vps"}:~</span><Badge tone={target === "termux" ? (termuxAvailable ? "live" : "warn") : "live"}>{target === "termux" ? (termuxAvailable ? "CONNECTED" : "WAITING") : "LOCAL"}</Badge></div><div className="terminal-output"><div className="output-line"><span className="prompt">{target === "termux" ? "termux" : "omega"}@mesh:$</span> {command}</div><pre>{output}</pre>{busy && <div className="running-line"><Loader2 size={14} className="spin" /> executing on {target}...</div>}</div><div className="terminal-input"><span>$</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void run(); }} spellCheck={false} /><button onClick={() => void run()} disabled={busy || !command.trim()}>{busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Run</button></div></div><div className="command-hints"><span>SAFE STARTERS</span><button onClick={() => setCommand("ip route && ip -4 addr")}>network</button><button onClick={() => setCommand("pwd && ls -la")}>files</button><button onClick={() => setCommand("uname -a")}>system</button><button onClick={() => setCommand("getprop ro.product.model")}>device</button></div></div>; }

function FilesView({ client, notify }: { client: McpClient; notify: (text: string) => void }) { const [path, setPath] = useState("$HOME"); const [output, setOutput] = useState("No directory loaded."); const [busy, setBusy] = useState(false); async function browse() { setBusy(true); try { const text = await callTool(client, "termux_exec", { command: `cd ${path || "$HOME"} && pwd && ls -la`, timeout: 20 }); setOutput(text); } catch (error) { setOutput(error instanceof Error ? error.message : "Unable to browse files"); notify("File browse failed"); } finally { setBusy(false); } } return <div className="view"><SectionHead eyebrow="Filesystem surface / 003" title="Files on the peer." copy="Inspect the Termux filesystem through the authenticated reverse bridge." action={<button className="outline-button" onClick={() => void browse()}><RefreshCw size={14} /> Refresh</button>} /><div className="file-browser"><div className="path-bar"><FolderOpen size={16} /><input value={path} onChange={(event) => setPath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void browse(); }} spellCheck={false} /><button onClick={() => void browse()} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : "Open"}</button></div><pre className="code-output">{output}</pre></div><div className="notice"><ShieldCheck size={16} /><span>File operations are executed through <code>termux_exec</code>. The hub never stores the phone filesystem.</span></div></div>; }

function NetworkView({ client, battery, notify }: { client: McpClient; battery: any; notify: (text: string) => void }) { const [output, setOutput] = useState("No network probe yet."); const [busy, setBusy] = useState(false); async function probe() { setBusy(true); try { const text = await callTool(client, "termux_exec", { command: "echo '--- addresses ---'; ip -4 addr 2>/dev/null || ifconfig; echo '--- routes ---'; ip route 2>/dev/null || route -n; echo '--- gateway ---'; ip route 2>/dev/null | awk '/default/ {print $3; exit}'", timeout: 20 }); setOutput(text); } catch (error) { setOutput(error instanceof Error ? error.message : "Network probe failed"); notify("Network probe failed"); } finally { setBusy(false); } } return <div className="view"><SectionHead eyebrow="Connectivity surface / 004" title="Network & telemetry." copy="Read the peer’s actual LAN address, gateway, and device telemetry—through the bridge." action={<button className="primary-small" onClick={() => void probe()}>{busy ? <Loader2 size={14} className="spin" /> : <Search size={14} />} Probe Termux</button>} /><div className="network-grid"><div className="panel network-card"><div className="panel-title"><span>PHONE TELEMETRY</span><BatteryCharging size={15} /></div><div className="big-reading">{battery?.percentage ?? battery?.level ?? "—"}<span>{battery ? "%" : ""}</span></div><div className="telemetry-row"><span>status</span><b>{battery?.status || "not queried"}</b></div><div className="telemetry-row"><span>power</span><b>{battery?.plugged || "—"}</b></div><div className="telemetry-row"><span>health</span><b>{battery?.health || "—"}</b></div></div><div className="panel network-card network-output"><div className="panel-title"><span>LIVE NETWORK PROBE</span><Wifi size={15} /></div><pre className="code-output">{output}</pre></div></div><div className="notice amber-notice"><Wifi size={16} /><span>Use the result’s <code>default via</code> address as the router address in the MikroTik Back To Home app. Do not guess it.</span></div></div>; }

function MikrotikView({ client, notify }: { client: McpClient; notify: (text: string) => void }) {
  type Profile = { id: string; name: string; address: string; user: string };
  const [address, setAddress] = useState("192.168.88.1");
  const [user, setUser] = useState("admin");
  const [profileName, setProfileName] = useState("Home router");
  const [profiles, setProfiles] = useState<Profile[]>(() => { try { return JSON.parse(localStorage.getItem("omega-mikrotik-profiles") || "[]"); } catch { return []; } });
  const [command, setCommand] = useState("/system identity print");
  const [output, setOutput] = useState("No RouterOS command run yet.");
  const [reachability, setReachability] = useState("Not checked");
  const [credentialStatus, setCredentialStatus] = useState("Not tested");
  const [syncPass, setSyncPass] = useState("");
  const [syncStatus, setSyncStatus] = useState("Encrypted sync is off");
  const [busy, setBusy] = useState(false);
  const presets = ["/system identity print", "/system resource print", "/ip address print", "/ip cloud print", "/interface/wireguard/print detail"];
  function persist(next: Profile[]) { setProfiles(next); localStorage.setItem("omega-mikrotik-profiles", JSON.stringify(next)); }
  function saveProfile() { const name = profileName.trim() || address.trim(); const next = [...profiles.filter((profile) => profile.id !== name), { id: name, name, address: address.trim(), user: user.trim() }]; persist(next); notify("MikroTik profile saved locally"); }
  function loadProfile(profile: Profile) { setProfileName(profile.name); setAddress(profile.address); setUser(profile.user); notify(`Loaded ${profile.name}`); }
  async function reach() { if (!address.trim()) return; setBusy(true); setReachability("Checking..."); try { const text = await callTool(client, "termux_exec", { command: `ping -c 1 -W 2 ${JSON.stringify(address.trim())}`, timeout: 10 }); setReachability(/1 received|1 packets transmitted.*1 received|0% packet loss/i.test(text) ? "Reachable" : "Unreachable"); } catch { setReachability("Unreachable"); } finally { setBusy(false); } }
  async function testCredentials() { if (!address.trim() || !user.trim()) return; setBusy(true); setCredentialStatus("Testing..."); try { const text = await callTool(client, "termux_exec", { command: `\"$HOME/mikrotik.sh\" ${JSON.stringify(address.trim())} ${JSON.stringify(user.trim())} ${JSON.stringify("/system identity print")}`, timeout: 30 }); if (/authentication|login|password|permission denied|not authorized|invalid user/i.test(text)) setCredentialStatus("Authentication failed"); else if (/timeout|unreachable|no route|connection refused|could not resolve/i.test(text)) setCredentialStatus("Network failure"); else setCredentialStatus("Credentials accepted"); } catch { setCredentialStatus("Test unavailable"); } finally { setBusy(false); } }
  async function run() { if (!address.trim() || !user.trim() || !command.trim()) return; setBusy(true); try { const shell = `\"$HOME/mikrotik.sh\" ${JSON.stringify(address.trim())} ${JSON.stringify(user.trim())} ${JSON.stringify(command.trim())}`; setOutput(await callTool(client, "termux_exec", { command: shell, timeout: 30 })); } catch (error) { setOutput(error instanceof Error ? error.message : "RouterOS command failed"); notify("RouterOS command failed"); } finally { setBusy(false); } }
  async function syncToHub() { if (syncPass.length < 8) { setSyncStatus("Use an 8+ character sync passphrase"); return; } try { const blob = await encryptProfiles(profiles, syncPass); const response = await fetch(`${normaliseUrl(client.url)}/v1/profile`, { method: "PUT", headers: { "content-type": "application/json", "X-API-Key": client.key }, body: JSON.stringify({ blob }) }); if (!response.ok) throw new Error(`Sync failed (${response.status})`); setSyncStatus(`Encrypted backup saved ${new Date().toLocaleTimeString()}`); } catch (error) { setSyncStatus(error instanceof Error ? error.message : "Sync failed"); } }
  async function syncFromHub() { if (syncPass.length < 8) { setSyncStatus("Use the same 8+ character sync passphrase"); return; } try { const response = await fetch(`${normaliseUrl(client.url)}/v1/profile`, { headers: { "X-API-Key": client.key }, cache: "no-store" }); const payload = await response.json(); if (!payload.blob) { setSyncStatus("No encrypted backup found"); return; } const next = await decryptProfiles(payload.blob, syncPass); persist(next); setSyncStatus(`Encrypted backup restored ${new Date().toLocaleTimeString()}`); } catch { setSyncStatus("Could not decrypt backup: check the passphrase"); } }
  return <div className="view"><SectionHead eyebrow="Router surface / 005" title="MikroTik controls." copy="Check reachability, verify credentials separately, and read the router through the existing Termux MikroTik helper." action={<Badge tone={reachability === "Reachable" ? "live" : "neutral"}><RouterIcon size={12} /> {reachability.toUpperCase()}</Badge>} /><div className="router-layout"><div className="panel router-config"><div className="panel-title"><span>ROUTER TARGET</span><RouterIcon size={15} /></div><label>PROFILE NAME<input value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><label>ADDRESS<input value={address} onChange={(event) => setAddress(event.target.value)} spellCheck={false} /></label><label>USERNAME<input value={user} onChange={(event) => setUser(event.target.value)} spellCheck={false} /></label><div className="router-actions"><button className="outline-button" onClick={() => void reach()} disabled={busy}><Search size={14} /> Test reachability</button><button className="outline-button" onClick={() => void testCredentials()} disabled={busy}><KeyRound size={14} /> Test credentials</button><button className="outline-button" onClick={saveProfile}><BookmarkPlus size={14} /> Save profile</button></div><div className="router-status-grid"><span>NETWORK <b>{reachability}</b></span><span>CREDENTIALS <b>{credentialStatus}</b></span></div><div className="router-note"><ShieldCheck size={15} /><span>Uses <code>$HOME/mikrotik.sh</code> on Termux; this site stores only profile name, address, and username in this browser.</span></div><div className="profile-list">{profiles.length ? profiles.map((profile) => <div className="profile-row" key={profile.id}><button onClick={() => loadProfile(profile)}><strong>{profile.name}</strong><small>{profile.user}@{profile.address}</small></button><button className="profile-delete" aria-label={`Delete ${profile.name}`} onClick={() => persist(profiles.filter((item) => item.id !== profile.id))}><Trash2 size={13} /></button></div>) : <span className="profile-empty">No saved targets yet.</span>}</div><div className="sync-box"><div className="panel-title"><span>ENCRYPTED PROFILE SYNC</span><ShieldCheck size={14} /></div><input type="password" value={syncPass} onChange={(event) => setSyncPass(event.target.value)} placeholder="Shared sync passphrase (8+ chars)" autoComplete="off" /><div className="router-actions"><button className="outline-button" onClick={() => void syncFromHub()}><Cloud size={14} /> Restore</button><button className="outline-button" onClick={() => void syncToHub()}><Cloud size={14} /> Backup</button></div><small>{syncStatus}</small></div></div><div className="panel router-console"><div className="panel-title"><span>ROUTEROS COMMAND</span><TerminalSquare size={15} /></div><textarea value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} /><div className="router-presets">{presets.map((preset) => <button key={preset} onClick={() => setCommand(preset)}>{preset}</button>)}</div><button className="primary-small" onClick={() => void run()} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <RouterIcon size={14} />} Run RouterOS command</button><pre className="code-output router-output">{output}</pre></div></div><div className="notice"><RouterIcon size={16} /><span>Reachability uses ICMP. Credential testing runs a read-only <code>/system identity print</code> through the Termux helper, so authentication errors are reported separately.</span></div></div>;
}
function ToolsView({ client, tools, notify }: { client: McpClient; tools: Tool[]; notify: (text: string) => void }) { const [selected, setSelected] = useState<Tool | null>(null); const [args, setArgs] = useState("{}"); const [result, setResult] = useState(""); const [search, setSearch] = useState(""); const filtered = tools.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(search.toLowerCase())); async function run() { if (!selected) return; try { const parsed = JSON.parse(args || "{}"); setResult(await callTool(client, selected.name, parsed)); } catch (error) { setResult(error instanceof Error ? error.message : "Tool call failed"); notify("Tool call failed"); } } return <div className="view"><SectionHead eyebrow="Capability surface / 006" title="Tool registry." copy="Every action the hub advertises, including the live Termux peer tools." action={<div className="tool-count"><Zap size={14} />{tools.length} advertised</div>} /><div className="tools-layout"><div className="tool-list"><div className="tool-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter tools..." /></div>{filtered.map((tool) => <button key={tool.name} className={`tool-row ${selected?.name === tool.name ? "selected" : ""}`} onClick={() => { setSelected(tool); setResult(""); }}><span className="tool-symbol"><Zap size={13} /></span><span><strong>{tool.name}</strong><small>{tool.description || "No description"}</small></span><ChevronDown size={15} /></button>)}</div><div className="tool-runner panel"><div className="panel-title"><span>{selected ? selected.name : "SELECT A TOOL"}</span><Settings2 size={15} /></div>{selected ? <><p className="runner-description">{selected.description}</p><label className="json-label">ARGUMENTS<textarea value={args} onChange={(event) => setArgs(event.target.value)} spellCheck={false} /></label><button className="primary-small" onClick={() => void run()}><Zap size={14} /> Run tool</button>{result && <pre className="code-output runner-output">{result}</pre>}</> : <div className="empty-runner"><Zap size={21} /><p>Choose a tool to inspect its contract and run it through the bridge.</p></div>}</div></div></div>; }

type BrowserModel = { id: string; label: string; family: string; description: string };
type StoredChatMessage = { id: number; role: "user" | "assistant"; content: string; model: string | null; createdAt: string | Date };

function getBrowserClientId() {
  const key = "omega-chat-client-id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `browser-${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
  return created;
}

function downloadChat(filename: string, body: string, type: string) {
  const blob = new Blob([body], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportChat(messages: StoredChatMessage[], format: "json" | "text" | "markdown") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "json") {
    downloadChat(`omega-chat-${stamp}.json`, JSON.stringify(messages, null, 2), "application/json");
    return;
  }
  const text = messages.map((message) => `[${new Date(message.createdAt).toISOString()}] ${message.role.toUpperCase()}${message.model ? ` (${message.model})` : ""}\n${message.content}`).join("\n\n---\n\n");
  if (format === "markdown") downloadChat(`omega-chat-${stamp}.md`, `# OMEGA Chat Export\n\n${text}`, "text/markdown;charset=utf-8");
  else downloadChat(`omega-chat-${stamp}.txt`, text, "text/plain;charset=utf-8");
}

function GatewayView({ client, notify }: { client: McpClient; notify: (text: string) => void }) {
  const [command, setCommand] = useState("curl -fsS http://127.0.0.1:8787/health");
  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("Cloud CLI ready. Ask the Manus assistant here, or run a command through the authenticated Omega hub.");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [termuxMessage, setTermuxMessage] = useState("");
  const [termuxReply, setTermuxReply] = useState("No Termux reply loaded.");
  const [termuxStatus, setTermuxStatus] = useState("Idle");
  const [watchingTermux, setWatchingTermux] = useState(false);
  const [onlinePrompt, setOnlinePrompt] = useState("");
  const [onlineStatus, setOnlineStatus] = useState("Idle");
  const [clientId] = useState(getBrowserClientId);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [pendingCommand, setPendingCommand] = useState<{ name: string; arguments: Record<string, unknown> } | null>(null);
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6");
  const creatingInitial = useRef(false);
  const utils = trpc.useUtils();
  const modelsQuery = trpc.chat.models.useQuery();
  const conversationsQuery = trpc.chat.conversations.useQuery({ clientId });
  const messagesQuery = trpc.chat.messages.useQuery(
    { clientId, conversationId: conversationId || 0 },
    { enabled: conversationId !== null },
  );
  const createConversation = trpc.chat.create.useMutation({
    onSuccess: async (conversation) => {
      setConversationId(conversation.id);
      setSelectedModel(conversation.model);
      await utils.chat.conversations.invalidate({ clientId });
      await utils.chat.messages.invalidate({ clientId, conversationId: conversation.id });
    },
    onError: (error) => notify(error.message),
  });
  const setModel = trpc.chat.setModel.useMutation({ onError: (error) => notify(error.message) });
  const askConversation = trpc.chat.ask.useMutation({
    onSuccess: async (result) => {
      setOutput(`[${result.model}]\n\n${result.content}`);
      if (result.pendingTool) setPendingCommand(result.pendingTool as { name: string; arguments: Record<string, unknown> });
      else setPrompt("");
      setSent(true);
      notify(result.toolsUsed ? `Assistant replied after ${result.toolsUsed} MCP tool call${result.toolsUsed === 1 ? "" : "s"}` : "Manus assistant replied and saved the message");
      if (conversationId !== null) {
        await utils.chat.messages.invalidate({ clientId, conversationId });
        await utils.chat.conversations.invalidate({ clientId });
      }
    },
    onError: (error) => {
      setOutput(error.message);
      notify("Assistant request failed");
    },
    onSettled: () => setBusy(false),
  });
  const executeCommand = trpc.chat.execute.useMutation({
    onSuccess: async (result) => {
      setPendingCommand(null);
      if (conversationId !== null) {
        await utils.chat.messages.invalidate({ clientId, conversationId });
        await utils.chat.conversations.invalidate({ clientId });
        // Wait for the persisted assistant message before updating the visible
        // output. Otherwise the messages query can briefly return its cached
        // pre-approval value and overwrite the command result until reload.
        await utils.chat.messages.refetch({ clientId, conversationId });
      }
      setOutput(`[${result.model}]\n\n${result.content}`);
      setPrompt("");
      setSent(true);
      notify("Approved Termux command executed");
    },
    onError: (error) => {
      setOutput(error.message);
      notify("Approved Termux command failed");
    },
    onSettled: () => setBusy(false),
  });

  useEffect(() => {
    if (conversationId !== null || conversationsQuery.isLoading || creatingInitial.current) return;
    const first = conversationsQuery.data?.[0];
    if (first) {
      setConversationId(first.id);
      setSelectedModel(first.model);
      return;
    }
    creatingInitial.current = true;
    createConversation.mutate({ clientId, title: "OMEGA assistant chat", model: selectedModel as never });
  }, [clientId, conversationId, conversationsQuery.data, conversationsQuery.isLoading]);

  useEffect(() => {
    const latest = messagesQuery.data?.at(-1);
    if (latest) setOutput(`[${latest.model || selectedModel}]\n\n${latest.content}`);
  }, [messagesQuery.data, selectedModel]);

  const models = (modelsQuery.data || []) as BrowserModel[];
  const activeConversation = conversationsQuery.data?.find((conversation) => conversation.id === conversationId);
  const currentMessages = (messagesQuery.data || []) as StoredChatMessage[];

  async function run() {
    if (!command.trim()) return;
    setBusy(true); setSent(false);
    try { setOutput(await callTool(client, "termux_exec", { command: command.trim(), timeout: 30 })); }
    catch (error) { setOutput(error instanceof Error ? error.message : "Cloud CLI request failed"); notify("Cloud CLI request failed"); }
    finally { setBusy(false); }
  }

  function askManus() {
    if (!prompt.trim() || !conversationId || askConversation.isPending) return;
    setBusy(true); setSent(false);
    askConversation.mutate({ clientId, conversationId, model: selectedModel as never, prompt: prompt.trim(), bridge: { url: client.url, key: client.key } });
  }

  function chooseModel(model: string) {
    setSelectedModel(model);
    if (conversationId) setModel.mutate({ clientId, conversationId, model: model as never });
  }

  function newChat() {
    createConversation.mutate({ clientId, title: "New OMEGA chat", model: selectedModel as never });
  }

  async function copyConversation() {
    const text = currentMessages.map((message) => `${message.role.toUpperCase()}${message.model ? ` (${message.model})` : ""}\n${message.content}`).join("\n\n---\n\n");
    await navigator.clipboard.writeText(text);
    notify("Conversation copied to clipboard");
  }

  function approveCommand() {
    if (!pendingCommand || !conversationId) return;
    executeCommand.mutate({ clientId, conversationId, model: selectedModel as never, name: pendingCommand.name, arguments: pendingCommand.arguments, bridge: { url: client.url, key: client.key } });
  }

  async function sendToTermux() {
    if (!termuxMessage.trim()) return;
    setBusy(true); setTermuxStatus("Sending...");
    try { await callTool(client, "inbox_post", { to: "termux", body: termuxMessage.trim() }); setTermuxMessage(""); setTermuxStatus("Queued"); notify("Message queued for Termux"); }
    catch (error) { setTermuxStatus(error instanceof Error ? error.message : "Send failed"); notify("Termux message failed"); }
    finally { setBusy(false); }
  }

  async function loadTermuxReplies() {
    setBusy(true); setWatchingTermux(true); setTermuxStatus("Loading inbox...");
    try { const text = await callTool(client, "inbox_read", { for: "*" }); setTermuxReply(text); setTermuxStatus("Loaded"); }
    catch (error) { setTermuxStatus(error instanceof Error ? error.message : "Load failed"); }
    finally { setBusy(false); setWatchingTermux(false); }
  }
  async function queueOnlineAgent() {
    if (!onlinePrompt.trim()) return;
    setBusy(true); setOnlineStatus("Queueing @onlineagent...");
    try {
      await callTool(client, "inbox_post", { to: "termux", body: formatOnlineAgentPrompt(onlinePrompt) });
      setOnlinePrompt(""); setOnlineStatus("Queued for Lorna on Termux"); notify("@onlineagent prompt queued");
    } catch (error) { setOnlineStatus(error instanceof Error ? error.message : "Online-agent queue failed"); notify("Online-agent queue failed"); }
    finally { setBusy(false); }
  }

  async function probeLornaAgent() {
    setBusy(true); setOnlineStatus("Running lorna2 --node agent...");
    try {
      const result = await callTool(client, "termux_exec", { command: formatLornaAgentProbe(), timeout: 60 });
      setOutput(result); setOnlineStatus("Lorna agent probe completed"); notify("Lorna agent probe completed");
    } catch (error) { setOnlineStatus(error instanceof Error ? error.message : "Lorna agent probe failed"); notify("Lorna agent probe failed"); }
    finally { setBusy(false); }
  }

  return <div className="view"><SectionHead eyebrow="Cloud gateway / 007" title="Your CLI in the cloud." copy="Choose a model, ask the Manus assistant, and keep the conversation across browser refreshes. Read-only bridge inspection is automatic; Termux commands require explicit approval." action={<Badge tone={sent ? "live" : "neutral"}>{sent ? "ASSISTANT + MCP ONLINE" : "MANUS LLM"}</Badge>} /><div className="gateway-grid"><div className="terminal-panel gateway-terminal"><div className="terminal-top"><div className="terminal-dots"><i /><i /><i /></div><span>omega-cloud-cli / assistant + termux</span><Badge tone="live">DUAL PATH</Badge></div><div className="terminal-output gateway-output"><div className="output-line"><span className="prompt">omega@cloud:$</span> {command}</div><pre>{output}</pre>{busy && <div className="running-line"><Loader2 size={14} className="spin" /> processing request...</div>}</div><div className="terminal-input"><span>$</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void run(); }} spellCheck={false} /><button onClick={() => void run()} disabled={busy || !command.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />} Run on Termux</button></div></div><div className="panel gateway-composer"><div className="panel-title"><span>ASK THE MANUS ASSISTANT</span><Command size={15} /></div><p>This lane can inspect the bridge automatically. If the model proposes a Termux command, the exact command appears below for your approval before execution.</p><div className="chat-toolbar"><label>MODEL<select value={selectedModel} onChange={(event) => chooseModel(event.target.value)} disabled={modelsQuery.isLoading || createConversation.isPending}>{models.map((model) => <option key={model.id} value={model.id}>{model.label} · {model.family}</option>)}</select></label><div className="chat-toolbar-actions"><button className="outline-button" onClick={() => exportChat(currentMessages, "json")} disabled={!currentMessages.length}><FileCode2 size={14} /> JSON</button><button className="outline-button" onClick={() => exportChat(currentMessages, "text")} disabled={!currentMessages.length}><Clipboard size={14} /> Text</button><button className="outline-button" onClick={() => exportChat(currentMessages, "markdown")} disabled={!currentMessages.length}><FileCode2 size={14} /> Markdown</button><button className="outline-button" onClick={() => void copyConversation()} disabled={!currentMessages.length}><Clipboard size={14} /> Copy all</button><button className="outline-button" onClick={newChat} disabled={createConversation.isPending}><BookmarkPlus size={14} /> New chat</button></div></div><div className="conversation-list"><div className="conversation-list-title">SAVED CONVERSATIONS</div>{(conversationsQuery.data || []).map((conversation) => <button type="button" key={conversation.id} className={`conversation-item ${conversation.id === conversationId ? "active" : ""}`} onClick={() => { setConversationId(conversation.id); setSelectedModel(conversation.model); setPendingCommand(null); }}><span>{conversation.title}</span><small>Updated {new Date(conversation.updatedAt).toLocaleDateString()}</small></button>)}</div><div className="chat-memory"><span>{activeConversation?.title || "Starting browser memory..."}</span><small>{currentMessages.length} saved messages · refresh-safe</small></div><div className="chat-history">{currentMessages.slice(-6).map((message) => <div className={`history-line ${message.role}`} key={message.id}><b>{message.role === "user" ? "YOU" : "MANUS"}</b><ChatMessageContent content={message.content} /></div>)}</div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); askManus(); } }} maxLength={120000} placeholder="Ask the Manus assistant anything..." /><button className="primary-small" onClick={askManus} disabled={busy || askConversation.isPending || !prompt.trim() || !conversationId}>{busy || askConversation.isPending ? <Loader2 size={14} className="spin" /> : <Command size={14} />} Ask Manus + MCP</button>{pendingCommand && <div className="command-approval"><div><strong>COMMAND APPROVAL REQUIRED</strong><p>The assistant wants to run this command on Termux:</p><code>{String(pendingCommand.arguments.command || "")}</code></div><div className="approval-actions"><button className="primary-small" onClick={approveCommand} disabled={executeCommand.isPending}>{executeCommand.isPending ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />} Approve and execute</button><button className="outline-button" onClick={() => setPendingCommand(null)} disabled={executeCommand.isPending}>Cancel</button></div></div>}<div className="gateway-contract"><span>ASSISTANT + MCP PATH</span><code>browser → server → selected model ⇄ MCP inspection / approved Termux command</code><span>TERMUX PATH</span><code>browser → Render hub → reverse bridge → Termux</code></div></div><div className="panel gateway-composer gateway-relay"><div className="panel-title"><span>TWO-WAY TERMUX RELAY</span><Send size={15} /></div><p>Send a message to the phone CLI, then load the response from the existing Omega inbox.</p><textarea value={termuxMessage} onChange={(event) => setTermuxMessage(event.target.value)} placeholder="Message the Termux CLI..." /><div className="gateway-relay-actions"><button className="primary-small" onClick={() => void sendToTermux()} disabled={busy || !termuxMessage.trim()}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send to Termux</button><button className="outline-button" onClick={() => void loadTermuxReplies()} disabled={busy}><RefreshCw size={14} /> {watchingTermux ? "Loading..." : "Load replies"}</button></div><div className="gateway-status">{termuxStatus}</div><pre className="gateway-reply">{termuxReply}</pre></div><div className="panel gateway-composer online-agent-panel"><div className="panel-title"><span>LORNA ONLINE AGENT</span><Sparkles size={15} /></div><p>Queue an <code>@onlineagent</code> prompt for the Termux dispatcher. The Forge key stays on Termux; this website never stores it.</p><textarea value={onlinePrompt} onChange={(event) => setOnlinePrompt(event.target.value)} placeholder="Ask Claude Sonnet 4.6 through @onlineagent..." /><div className="gateway-relay-actions"><button className="primary-small" onClick={() => void queueOnlineAgent()} disabled={busy || !onlinePrompt.trim()}><Send size={14} /> Queue @onlineagent</button><button className="outline-button" onClick={() => void probeLornaAgent()} disabled={busy}><TerminalSquare size={14} /> Run /node agent probe</button></div><div className="gateway-status">{onlineStatus}</div></div></div><div className="notice"><ShieldCheck size={16} /><span>Chat history is stored server-side for this browser's local client ID. Forge credentials remain server-side. Commands require explicit approval; writes and destructive tools remain blocked.</span></div></div>;
}

function InboxView({ client, snap, notify }: { client: McpClient; snap: Snapshot | null; notify: (text: string) => void }) { const [messages, setMessages] = useState(snap?.inbox || []); const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); async function reload() { try { const text = await callTool(client, "inbox_read", { for: "*" }); const parsed = jsonText(text); if (Array.isArray(parsed)) setMessages(parsed); } catch (error) { notify(error instanceof Error ? error.message : "Inbox read failed"); } } async function send() { if (!body.trim()) return; setBusy(true); try { await callTool(client, "inbox_post", { to: "termux", body: body.trim() }); setBody(""); await reload(); notify("Message queued for Termux"); } catch (error) { notify(error instanceof Error ? error.message : "Message failed"); } finally { setBusy(false); } } return <div className="view"><SectionHead eyebrow="Peer messaging / 006" title="Inbox relay." copy="Leave messages on the hub for the reverse-connected node, even when it is briefly offline." action={<button className="outline-button" onClick={() => void reload()}><RefreshCw size={14} /> Refresh</button>} /><div className="inbox-grid"><div className="panel composer"><div className="panel-title"><span>POST TO TERMUX</span><Send size={15} /></div><textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a message for the connected phone..." /><button className="primary-small" onClick={() => void send()} disabled={busy || !body.trim()}>{busy ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Queue message</button></div><div className="panel message-list"><div className="panel-title"><span>RECENT MESSAGES</span><span className="message-count">{messages.length}</span></div>{messages.length ? messages.map((message) => <div className="message" key={message.id}><div className="message-meta"><span>{message.to}</span><time>{new Date(message.at).toLocaleString()}</time></div><p>{message.body}</p></div>) : <div className="empty-runner"><Send size={20} /><p>No messages waiting on the hub.</p></div>}</div></div></div>; }

function NodeMeshView({ client, snap, notify }: { client: McpClient; snap: Snapshot | null; notify: (text: string) => void }) {
  type MeshMessage = { id?: string | number; to: string; from?: string; body: string; at?: string };
  const nodes = [
    { id: "vps", label: "NODE 1", name: "Omega VPS", role: "hub / server" },
    { id: "termux", label: "NODE 2", name: "Termux device", role: "phone / reverse" },
    { id: "cloud", label: "NODE 3", name: "Cloud CLI", role: "operator / browser" },
  ];
  const [messages, setMessages] = useState<MeshMessage[]>((snap?.inbox || []) as MeshMessage[]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [targets, setTargets] = useState<Record<string, string>>({ vps: "termux", termux: "vps", cloud: "termux" });
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const parsed = jsonText(await callTool(client, "inbox_read", { for: "*" }));
      if (Array.isArray(parsed)) setMessages(parsed as MeshMessage[]);
    } catch (error) { notify(error instanceof Error ? error.message : "Mesh inbox read failed"); }
  }
  async function send(from: string) {
    const body = drafts[from]?.trim(); const to = targets[from];
    if (!body || !to) return;
    setBusy(true);
    try {
      await callTool(client, "inbox_post", { to, body: `[${from}] ${body}` });
      setDrafts((current) => ({ ...current, [from]: "" }));
      await reload();
      notify(`${from.toUpperCase()} → ${to.toUpperCase()} queued`);
    } catch (error) { notify(error instanceof Error ? error.message : "Mesh message failed"); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (snap?.inbox) setMessages(snap.inbox as MeshMessage[]); }, [snap]);
  useEffect(() => { const timer = window.setInterval(() => { void reload(); }, 7000); return () => window.clearInterval(timer); }, [client.url, client.key]);
  const statusFor = (id: string) => snap?.peers?.find((peer) => peer.id === id)?.status || (id === "vps" ? "live" : "waiting");
  const messagesFor = (id: string) => messages.filter((message) => message.to === id || message.from === id);
  return <div className="view"><SectionHead eyebrow="Inter-node messaging / 009" title="Node mesh." copy="Three Cloud CLI lanes on one shared inbox. Send between nodes and watch the traffic return through the authenticated OMEGA hub." action={<button className="outline-button" onClick={() => void reload()} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh mesh</button>} /><div className="mesh-banner"><div><span className="strip-label">SHARED TRANSPORT</span><strong>OMEGA INBOX / STREAMABLE HTTP</strong><small>Messages are routed by node address; hub credentials stay in this browser session.</small></div><Badge tone={messages.length ? "live" : "neutral"}>{messages.length} MESSAGES</Badge></div><div className="node-mesh-grid">{nodes.map((node) => { const live = statusFor(node.id) === "live"; const nodeMessages = messagesFor(node.id).slice(-8); const recipients = nodes.filter((candidate) => candidate.id !== node.id); return <section className="panel node-card" key={node.id}><div className="node-card-head"><div><span className="node-label">{node.label}</span><h3>{node.name}</h3><small>{node.role}</small></div><Badge tone={live ? "live" : "warn"}>{live ? "LIVE" : "WAITING"}</Badge></div><div className="node-message-list">{nodeMessages.length ? nodeMessages.map((message, index) => <div className="node-message" key={`${message.id || message.at || "message"}-${index}`}><div><b>{message.from || "HUB"}</b><span>{message.to}</span></div><p>{message.body}</p><time>{message.at ? new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "queued"}</time></div>) : <div className="node-empty"><Network size={17} /><span>No traffic for this node yet.</span></div>}</div><div className="node-composer"><select value={targets[node.id]} onChange={(event) => setTargets((current) => ({ ...current, [node.id]: event.target.value }))}>{recipients.map((recipient) => <option key={recipient.id} value={recipient.id}>Send to {recipient.label}</option>)}</select><textarea value={drafts[node.id] || ""} onChange={(event) => setDrafts((current) => ({ ...current, [node.id]: event.target.value }))} placeholder={`Message from ${node.label.toLowerCase()}...`} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void send(node.id); } }} /><button className="primary-small" onClick={() => void send(node.id)} disabled={busy || !drafts[node.id]?.trim()}><Send size={14} /> Send from {node.label}</button></div></section>; })}</div><div className="notice"><Network size={16} /><span><strong>Routing note:</strong> Node addresses default to <code>vps</code>, <code>termux</code>, and <code>cloud</code>. If the hub advertises different peer IDs, update the target addresses in the bridge contract before using those lanes.</span></div></div>;
}

export default function Home() {
  const [client, setClient] = useState<McpClient | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [status, setStatus] = useState<Health>({ ok: false });
  const boot = (nextClient: McpClient, nextTools: Tool[], nextHealth: Health) => { setClient(nextClient); setTools(nextTools); setStatus(nextHealth); };
  return client ? <AppShell client={client} initialTools={tools} initialHealth={status} onLock={() => setClient(null)} /> : <Unlock onUnlock={boot} />;
}
