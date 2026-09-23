/**
 * HTT3 Pipeline tab — three-model chain using the existing Cloud CLI catalog.
 *
 * Wire into Home.tsx:
 *   1. Add to nav: { id: "pipeline", label: "HTT3 Pipeline", icon: GitBranch }
 *   2. Import PipelineView and render when active === "pipeline"
 *   3. Pass client + notify like GatewayView
 */

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChatMessageContent } from "@/components/ChatMessageContent";
import {
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Send,
  Sparkles,
  AlertCircle,
} from "lucide-react";

type McpClient = { url: string; key: string; session: string | null };

type StageStatus = "pending" | "running" | "done" | "error";

type Stage = {
  id: string;
  role: string;
  model: string;
  label: string;
  status: StageStatus;
  content?: string;
  toolsUsed?: number;
  error?: string;
};

function SectionHead({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="view-heading">
      <div>
        <div className="eyebrow">
          <span className="eyebrow-line" />
          {eyebrow}
        </div>
        <h2>{title}</h2>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "live" | "warn";
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className={`status-dot ${tone === "live" ? "live" : ""}`} />
      {children}
    </span>
  );
}

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "running") return <Loader2 size={16} className="spin" />;
  if (status === "done") return <CheckCircle2 size={16} />;
  if (status === "error") return <AlertCircle size={16} />;
  return <Circle size={16} />;
}

export function PipelineView({
  client,
  notify,
}: {
  client: McpClient;
  notify: (text: string) => void;
}) {
  const defaultsQuery = trpc.pipeline.defaults.useQuery();
  const startPipeline = trpc.pipeline.start.useMutation({
    onError: (error) => notify(error.message),
  });

  const catalog = defaultsQuery.data?.catalog ?? [];
  const defaultModels = defaultsQuery.data?.models;

  const [prompt, setPrompt] = useState("");
  const [researcher, setResearcher] = useState("claude-sonnet-4-6");
  const [implementer, setImplementer] = useState("gpt-5.5");
  const [critic, setCritic] = useState("gemini-3.1-pro-preview");
  const [stages, setStages] = useState<Stage[]>([]);
  const [finalContent, setFinalContent] = useState("");
  const [expanded, setExpanded] = useState<string | null>("present");
  const [jobId, setJobId] = useState<string | null>(null);
  const pipelineStatus = trpc.pipeline.status.useQuery(
    { jobId: jobId || "00000000-0000-0000-0000-000000000000" },
    { enabled: Boolean(jobId), refetchInterval: (query) => query.state.data?.status === "running" ? 700 : false },
  );

  // Sync defaults once loaded
  useEffect(() => {
    if (defaultModels) {
      setResearcher(defaultModels.researcher);
      setImplementer(defaultModels.implementer);
      setCritic(defaultModels.critic);
    }
  }, [defaultModels?.researcher, defaultModels?.implementer, defaultModels?.critic]);

  useEffect(() => {
    const status = pipelineStatus.data;
    if (!status) return;
    setStages(status.stages as Stage[]);
    if (status.finalContent) setFinalContent(status.finalContent);
    if (status.status === "error" && status.error) notify(status.error);
  }, [pipelineStatus.data, notify]);

  const busy = startPipeline.isPending || pipelineStatus.data?.status === "running";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;
    setJobId(null);
    setStages([]);
    setFinalContent("");
    setExpanded(null);
    try {
      const result = await startPipeline.mutateAsync({
        prompt: prompt.trim(),
        researcher: researcher as never,
        implementer: implementer as never,
        critic: critic as never,
        bridge: { url: client.url, key: client.key },
      });
      setJobId(result.jobId);
      notify("Pipeline started · watching stage progress live");
    } catch {
      // onError already notifies
    }
  }

  const modelSelect = (
    label: string,
    value: string,
    onChange: (v: string) => void,
    roleHint: string,
  ) => (
    <label className="pipeline-model-pick">
      <span className="pipeline-model-label">
        {label}
        <small>{roleHint}</small>
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={busy}>
        {catalog.map((m: { id: string; label: string; family: string }) => (
          <option key={m.id} value={m.id}>
            {m.label} · {m.family}
          </option>
        ))}
        {!catalog.length && <option value={value}>{value}</option>}
      </select>
    </label>
  );

  return (
    <div className="view pipeline-view">
      <SectionHead
        eyebrow="HTT3 pipeline / multi-model"
        title="Research → build → critique → revise → answer."
        copy="Three models from the Cloud CLI catalog. Model 1 researches (MCP/tools allowed). Model 2 implements. Model 3 critiques. Model 2 revises. Model 1 presents the final answer to you."
        action={
          <Badge tone={finalContent ? "live" : busy ? "warn" : "neutral"}>
            {busy ? "RUNNING" : finalContent ? "COMPLETE" : "READY"}
          </Badge>
        }
      />

      <div className="pipeline-layout">
        <form className="panel pipeline-compose" onSubmit={submit}>
          <div className="panel-title">
            <span>
              <GitBranch size={15} /> MODEL ASSIGNMENT
            </span>
          </div>
          <div className="pipeline-models">
            {modelSelect("Model 1 · Researcher / Presenter", researcher, setResearcher, "Context + final voice")}
            {modelSelect("Model 2 · Implementer", implementer, setImplementer, "Code & task work")}
            {modelSelect("Model 3 · Critic", critic, setCritic, "Review & checklist")}
          </div>
          <label className="pipeline-prompt">
            <span>Your instruction</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="Describe what you need. Model 1 will research, Model 2 will implement, Model 3 will critique…"
              disabled={busy}
              spellCheck
            />
          </label>
          <button type="submit" className="unlock-button pipeline-run" disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            {busy ? "Pipeline running…" : "Run HTT3 pipeline"}
            <span>↗</span>
          </button>
        </form>

        <div className="panel pipeline-stages">
          <div className="panel-title">
            <span>STAGE TRACE</span>
            {stages.length > 0 && (
              <button type="button" onClick={() => setExpanded(expanded ? null : "present")}>
                {expanded ? "collapse" : "expand"} ↗
              </button>
            )}
          </div>
          {!stages.length && !busy && (
            <p className="pipeline-empty">Stages appear here after you run a pipeline.</p>
          )}
          {busy && !stages.length && (
            <div className="running-line">
              <Loader2 size={14} className="spin" /> starting research stage…
            </div>
          )}
          <ol className="pipeline-stage-list">
            {(stages.length
              ? stages
              : defaultsQuery.data?.stages?.map((s: { id: string; role: string; label: string }) => ({
                  ...s,
                  model: "—",
                  status: "pending" as StageStatus,
                })) || []
            ).map((stage: Stage) => (
              <li
                key={stage.id}
                className={`pipeline-stage status-${stage.status} ${expanded === stage.id ? "open" : ""}`}
              >
                <button
                  type="button"
                  className="pipeline-stage-head"
                  onClick={() => setExpanded(expanded === stage.id ? null : stage.id)}
                  disabled={!stage.content && stage.status !== "error"}
                >
                  <StageIcon status={stage.status} />
                  <div>
                    <strong>{stage.label}</strong>
                    <small>
                      {stage.role} · {stage.model}
                      {stage.toolsUsed ? ` · ${stage.toolsUsed} tool(s)` : ""}
                    </small>
                  </div>
                </button>
                {expanded === stage.id && stage.content && (
                  <div className="pipeline-stage-body">
                    <ChatMessageContent content={stage.content} />
                  </div>
                )}
                {expanded === stage.id && stage.error && (
                  <div className="pipeline-stage-body error-box">{stage.error}</div>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>

      {finalContent && (
        <div className="panel pipeline-final">
          <div className="panel-title">
            <span>
              <Send size={15} /> FINAL ANSWER · Model 1
            </span>
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(finalContent);
                notify("Final answer copied");
              }}
            >
              copy ↗
            </button>
          </div>
          <div className="pipeline-final-body">
            <ChatMessageContent content={finalContent} />
          </div>
        </div>
      )}
    </div>
  );
}

export default PipelineView;
