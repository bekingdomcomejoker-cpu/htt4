import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RefreshCw, Send, ShieldCheck, TerminalSquare } from "lucide-react";
import { trpc } from "@/lib/trpc";

type Client = { url: string; key: string };
const HISTORY_KEY = "omega-sandbox-shell-history";

export function SandboxShellView({ client, notify }: { client: Client; notify: (text: string) => void }) {
  const bridge = useMemo(() => ({ url: client.url, key: client.key }), [client.key, client.url]);
  const [command, setCommand] = useState("pwd && uname -a");
  const [output, setOutput] = useState("Sandbox shell ready. Commands execute in the current temporary Manus sandbox.");
  const [history, setHistory] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const healthQuery = trpc.sandbox.health.useQuery(bridge, { refetchInterval: 15000, retry: 1 });
  const live = Boolean(healthQuery.data?.ok);

  useEffect(() => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 30))); } catch { /* storage is optional */ } }, [history]);

  async function run() {
    const value = command.trim();
    if (!value || busy || !live) return;
    setBusy(true); setOutput(""); setHistory((current) => [value, ...current.filter((item) => item !== value)].slice(0, 30));
    try {
      const response = await fetch("/api/sandbox-shell/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bridge, command: value, timeout: 120 }) });
      if (!response.ok || !response.body) throw new Error((await response.text()) || `Sandbox stream failed (${response.status})`);
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read(); if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "stdout" || event.type === "stderr") setOutput((current) => current + event.text);
          if (event.type === "done") { const result = JSON.parse(event.text); if (!result.ok) setOutput((current) => `${current}\n[exit ${result.code}]\n`); }
          if (event.type === "error") throw new Error(event.text);
        }
      }
      notify("Sandbox stream complete");
    } catch (error) { setOutput((current) => `${current}\n${error instanceof Error ? error.message : "Sandbox stream failed"}`); notify("Sandbox command failed"); }
    finally { setBusy(false); }
  }

  return <div className="view">
    <div className="view-heading"><div><div className="eyebrow"><span className="eyebrow-line" />Temporary reverse link / 010</div><h2>Sandbox Shell.</h2><p>Run commands inside the current Manus sandbox through the authenticated OMEGA session. Output arrives live as stdout and stderr are produced.</p></div><span className={`badge badge-${live ? "live" : "warn"}`}><span className={`status-dot ${live ? "live" : ""}`} />{healthQuery.isLoading ? "CHECKING" : live ? "BRIDGE LIVE" : "OFFLINE"}</span></div>
    <div className="terminal-panel"><div className="terminal-top"><div className="terminal-dots"><i /><i /><i /></div><span>manus-sandbox / authenticated reverse link</span><span className={`badge badge-${live ? "live" : "warn"}`}><ShieldCheck size={13} />{live ? "KEY VERIFIED" : "KEY NOT VERIFIED"}</span></div><div className="terminal-output"><div className="output-line"><span className="prompt">sandbox@manus:$</span> {command}</div><pre>{output}</pre>{busy && <div className="running-line"><Loader2 size={14} className="spin" /> streaming sandbox output...</div>}</div><div className="terminal-input"><span>$</span><input value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !busy) void run(); }} spellCheck={false} /><button onClick={() => void run()} disabled={!command.trim() || busy || !live}>{busy ? <Loader2 size={16} className="spin" /> : <Send size={16} />} Run</button></div></div>
    <div className="command-hints"><span>SAFE STARTERS</span><button onClick={() => setCommand("pwd && ls -la")}>files</button><button onClick={() => setCommand("uname -a && free -h")}>system</button><button onClick={() => setCommand("git -C /home/ubuntu/htt4-webdev status --short --branch")}>website status</button><button onClick={() => void healthQuery.refetch()}><RefreshCw size={13} /> refresh</button></div>
    <div className="panel"><div className="panel-title"><span>COMMAND HISTORY</span><History size={15} /></div>{history.length ? <div className="command-history">{history.map((item) => <button type="button" key={item} onClick={() => setCommand(item)}><code>{item}</code></button>)}</div> : <div className="empty-runner"><History size={18} /><p>No commands run in this browser session.</p></div>}</div>
    <div className="notice"><TerminalSquare size={16} /><span><strong>Session boundary:</strong> this is a temporary, key-protected shell bridge. It is not a persistent server; attach a persistent node when you need it to survive this sandbox session.</span></div>
  </div>;
}
