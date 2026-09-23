/**
 * Model Chat — WhatsApp Web–style contacts = models, with phase-1 voice.
 *
 * Wire into Home.tsx:
 *   nav: { id: "modelchat", label: "Model Chat", icon: MessageCircle }
 *   {active === "modelchat" && <ModelChatView client={client} notify={notify} />}
 *
 * Copy also: useVoiceChat.ts next to this file (or under hooks/).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { ChatMessageContent } from "@/components/ChatMessageContent";
import {
  detectVoiceSupport,
  startListening,
  speakText,
  stopSpeaking,
} from "./useVoiceChat";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  Plus,
  Search,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";

type McpClient = { url: string; key: string; session: string | null };

type ModelOption = {
  id: string;
  label: string;
  family: string;
  description?: string;
};

type Conversation = {
  id: number;
  title: string;
  model: string;
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
};

type ChatMessage = {
  id: number;
  role: string;
  content: string;
  model?: string | null;
  createdAt?: string | Date | null;
};

function getBrowserClientId(): string {
  const key = "omega-operator-client-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing && existing.length >= 16) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `omega-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `omega-session-${Date.now()}`;
  }
}

function formatTime(value?: string | Date | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function familyInitial(family: string): string {
  const f = (family || "?").trim();
  if (/anthropic/i.test(f)) return "C";
  if (/openai/i.test(f)) return "G";
  if (/google/i.test(f)) return "G";
  return f.charAt(0).toUpperCase() || "M";
}

function familyTone(family: string): string {
  if (/anthropic/i.test(family)) return "anthropic";
  if (/openai/i.test(family)) return "openai";
  if (/google/i.test(family)) return "google";
  return "neutral";
}

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

const AUTO_SPEAK_KEY = "omega-model-chat-auto-speak";

export function ModelChatView({
  client,
  notify,
}: {
  client: McpClient;
  notify: (text: string) => void;
}) {
  const [clientId] = useState(getBrowserClientId);
  const [query, setQuery] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingCommand, setPendingCommand] = useState<{
    name: string;
    arguments: Record<string, unknown>;
  } | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [contactsCollapsed, setContactsCollapsed] = useState(() => {
    try {
      return localStorage.getItem("omega-model-chat-contacts-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [autoSpeak, setAutoSpeak] = useState(() => {
    try {
      return localStorage.getItem(AUTO_SPEAK_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [voiceSupport] = useState(() => detectVoiceSupport());
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const creatingRef = useRef(false);
  const listenHandle = useRef<{ stop: () => void } | null>(null);
  const lastSpokenId = useRef<number | null>(null);
  const prevMessageCount = useRef(0);

  const utils = trpc.useUtils();
  const modelsQuery = trpc.chat.models.useQuery();
  const conversationsQuery = trpc.chat.conversations.useQuery({ clientId });
  const messagesQuery = trpc.chat.messages.useQuery(
    { clientId, conversationId: conversationId || 0 },
    { enabled: conversationId !== null },
  );

  const models: ModelOption[] = modelsQuery.data ? Array.from(modelsQuery.data as readonly ModelOption[]) : [];
  const conversations: Conversation[] = (conversationsQuery.data as Conversation[]) || [];
  const messages: ChatMessage[] = (messagesQuery.data as ChatMessage[]) || [];

  const createConversation = trpc.chat.create.useMutation({
    onSuccess: async (conversation) => {
      setConversationId(conversation.id);
      setSelectedModelId(conversation.model);
      await utils.chat.conversations.invalidate({ clientId });
      await utils.chat.messages.invalidate({ clientId, conversationId: conversation.id });
    },
    onError: (error) => notify(error.message),
  });

  const askConversation = trpc.chat.ask.useMutation({
    onSuccess: async (result) => {
      if (result.pendingTool) {
        setPendingCommand(result.pendingTool as { name: string; arguments: Record<string, unknown> });
      } else {
        setDraft("");
        setPendingCommand(null);
      }
      notify(
        result.toolsUsed
          ? `Replied after ${result.toolsUsed} tool call${result.toolsUsed === 1 ? "" : "s"}`
          : "Model replied",
      );
      if (conversationId !== null) {
        await utils.chat.messages.invalidate({ clientId, conversationId });
        await utils.chat.conversations.invalidate({ clientId });
      }
    },
    onError: (error) => notify(error.message),
  });

  const executeCommand = trpc.chat.execute.useMutation({
    onSuccess: async () => {
      setPendingCommand(null);
      setDraft("");
      notify("Command executed");
      if (conversationId !== null) {
        await utils.chat.messages.invalidate({ clientId, conversationId });
      }
    },
    onError: (error) => notify(error.message),
  });

  const conversationByModel = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const c of conversations) {
      const prev = map.get(c.model);
      if (!prev) {
        map.set(c.model, c);
        continue;
      }
      const prevTime = new Date(prev.updatedAt || prev.createdAt || 0).getTime();
      const nextTime = new Date(c.updatedAt || c.createdAt || 0).getTime();
      if (nextTime >= prevTime) map.set(c.model, c);
    }
    return map;
  }, [conversations]);

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.family.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q),
    );
  }, [models, query]);

  const selectedModel = models.find((m) => m.id === selectedModelId) || null;
  const busy =
    askConversation.isPending ||
    executeCommand.isPending ||
    createConversation.isPending;

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, busy, interim]);

  // Auto-speak newest assistant message when toggle is on
  useEffect(() => {
    if (!autoSpeak || !voiceSupport.synthesis || messages.length === 0) {
      prevMessageCount.current = messages.length;
      return;
    }
    if (messages.length <= prevMessageCount.current) {
      prevMessageCount.current = messages.length;
      return;
    }
    prevMessageCount.current = messages.length;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant" || last.id === lastSpokenId.current) return;
    lastSpokenId.current = last.id;
    speakText(last.content, {
      onError: (message) => notify(message),
    });
  }, [messages, autoSpeak, voiceSupport.synthesis, notify]);

  useEffect(() => {
    return () => {
      listenHandle.current?.stop();
      stopSpeaking();
    };
  }, []);

  function toggleAutoSpeak() {
    setAutoSpeak((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(AUTO_SPEAK_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (!next) stopSpeaking();
      notify(next ? "Auto-speak on" : "Auto-speak off");
      return next;
    });
  }

  function toggleMic() {
    if (!voiceSupport.recognition) {
      notify("Voice input needs Chrome or Edge with microphone access.");
      return;
    }
    if (listening) {
      listenHandle.current?.stop();
      listenHandle.current = null;
      setListening(false);
      setInterim("");
      return;
    }
    const handle = startListening({
      continuous: false,
      onStart: () => {
        setListening(true);
        setInterim("");
      },
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setDraft((prev) => (prev ? `${prev.trim()} ${text}` : text));
        setInterim("");
      },
      onError: (message) => {
        if (message !== "Listening stopped.") notify(message);
        setListening(false);
        setInterim("");
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
        listenHandle.current = null;
      },
    });
    listenHandle.current = handle;
  }

  function speakMessage(content: string, id: number) {
    if (!voiceSupport.synthesis) {
      notify("Speech synthesis not available in this browser.");
      return;
    }
    lastSpokenId.current = id;
    speakText(content, { onError: (message) => notify(message) });
  }

  async function openContact(modelId: string) {
    stopSpeaking();
    setSelectedModelId(modelId);
    setPendingCommand(null);
    setDraft("");
    setInterim("");
    lastSpokenId.current = null;
    const existing = conversationByModel.get(modelId);
    if (existing) {
      setConversationId(existing.id);
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      const model = models.find((m) => m.id === modelId);
      await createConversation.mutateAsync({
        clientId,
        title: model ? `Chat · ${model.label}` : "New model chat",
        model: modelId as never,
      });
    } finally {
      creatingRef.current = false;
    }
  }

  async function startFreshChat() {
    if (!selectedModelId || creatingRef.current) return;
    creatingRef.current = true;
    try {
      const model = models.find((m) => m.id === selectedModelId);
      await createConversation.mutateAsync({
        clientId,
        title: model ? `Chat · ${model.label}` : "New model chat",
        model: selectedModelId as never,
      });
      setPendingCommand(null);
      setDraft("");
      lastSpokenId.current = null;
      notify("New chat started with this model");
    } finally {
      creatingRef.current = false;
    }
  }

  function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !conversationId || !selectedModelId || busy) return;
    if (listening) {
      listenHandle.current?.stop();
      setListening(false);
    }
    askConversation.mutate({
      clientId,
      conversationId,
      model: selectedModelId as never,
      prompt: text,
      bridge: { url: client.url, key: client.key },
    });
  }

  function approveCommand() {
    if (!pendingCommand || !conversationId || !selectedModelId) return;
    executeCommand.mutate({
      clientId,
      conversationId,
      model: selectedModelId as never,
      name: pendingCommand.name,
      arguments: pendingCommand.arguments,
      bridge: { url: client.url, key: client.key },
    });
  }

  function contactPreview(modelId: string): string {
    const conv = conversationByModel.get(modelId);
    if (!conv) return "Tap to start chatting";
    return conv.title || "Conversation";
  }

  function contactTime(modelId: string): string {
    const conv = conversationByModel.get(modelId);
    return formatTime(conv?.updatedAt || conv?.createdAt);
  }

  return (
    <div className="view model-chat-view">
      <SectionHead
        eyebrow="Model chat / voice"
        title="Your models, as contacts."
        copy="WhatsApp-style threads per model. Optional mic input and spoken replies — browser-native, no extra keys."
        action={
          <div className="mc-head-actions">
            {voiceSupport.synthesis && (
              <button
                type="button"
                className={`mc-toggle ${autoSpeak ? "on" : ""}`}
                onClick={toggleAutoSpeak}
                title="Auto-speak new replies"
              >
                {autoSpeak ? <Volume2 size={15} /> : <VolumeX size={15} />}
                {autoSpeak ? "Auto-speak" : "Muted"}
              </button>
            )}
            <Badge tone={selectedModel ? "live" : "neutral"}>
              {selectedModel ? selectedModel.label : "PICK A MODEL"}
            </Badge>
          </div>
        }
      />

      {!voiceSupport.recognition && !voiceSupport.synthesis && (
        <p className="mc-voice-hint">
          Voice is limited in this browser. Chrome or Edge give the best mic + speak support.
        </p>
      )}
      {voiceSupport.recognition && (
        <p className="mc-voice-hint quiet">
          Mic uses the browser speech service (may leave the device on Chrome). Push-to-talk only — nothing is always listening.
        </p>
      )}

      <div className={`mc-shell ${contactsCollapsed ? "contacts-collapsed" : ""}`}>
        <aside className="mc-contacts panel">
          <div className="mc-contacts-head">
            <div className="mc-contacts-title">
              <MessageCircle size={16} />
              <span>MODELS</span>
              <button
                type="button"
                className="mc-contacts-collapse"
                title={contactsCollapsed ? "Expand contacts" : "Collapse contacts"}
                onClick={() => {
                  setContactsCollapsed((prev) => {
                    const next = !prev;
                    try {
                      localStorage.setItem(
                        "omega-model-chat-contacts-collapsed",
                        next ? "1" : "0",
                      );
                    } catch {
                      /* ignore */
                    }
                    return next;
                  });
                }}
              >
                {contactsCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>
            </div>
            <div className="mc-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search models"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="mc-contact-list">
            {modelsQuery.isLoading && (
              <div className="mc-empty">
                <Loader2 size={16} className="spin" /> Loading catalog…
              </div>
            )}
            {!modelsQuery.isLoading && filteredModels.length === 0 && (
              <div className="mc-empty">No models match.</div>
            )}
            {filteredModels.map((model) => {
              const active = model.id === selectedModelId;
              const hasThread = conversationByModel.has(model.id);
              return (
                <button
                  key={model.id}
                  type="button"
                  className={`mc-contact ${active ? "active" : ""}`}
                  onClick={() => void openContact(model.id)}
                >
                  <div className={`mc-avatar tone-${familyTone(model.family)}`}>
                    {familyInitial(model.family)}
                  </div>
                  <div className="mc-contact-body">
                    <div className="mc-contact-row">
                      <strong>{model.label}</strong>
                      <span className="mc-time">{contactTime(model.id)}</span>
                    </div>
                    <div className="mc-contact-row sub">
                      <span className="mc-preview">
                        {hasThread ? contactPreview(model.id) : model.description || model.family}
                      </span>
                      {hasThread && <Check size={12} className="mc-seen" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="mc-thread panel">
          {!selectedModel && (
            <div className="mc-placeholder">
              <Sparkles size={28} />
              <h3>Select a model contact</h3>
              <p>Each model keeps its own conversation. Use the mic to dictate, or speak replies aloud.</p>
            </div>
          )}

          {selectedModel && (
            <>
              <header className="mc-thread-head">
                <div className={`mc-avatar tone-${familyTone(selectedModel.family)}`}>
                  {familyInitial(selectedModel.family)}
                </div>
                <div className="mc-thread-meta">
                  <strong>{selectedModel.label}</strong>
                  <small>
                    {selectedModel.family}
                    {selectedModel.description ? ` · ${selectedModel.description}` : ""}
                  </small>
                </div>
                <button
                  type="button"
                  className="mc-new-chat"
                  onClick={() => void startFreshChat()}
                  disabled={busy}
                  title="Start a fresh conversation with this model"
                >
                  <Plus size={15} /> New chat
                </button>
              </header>

              <div className="mc-messages">
                {messagesQuery.isLoading && (
                  <div className="mc-empty">
                    <Loader2 size={14} className="spin" /> Loading messages…
                  </div>
                )}
                {!messagesQuery.isLoading && messages.length === 0 && (
                  <div className="mc-empty subtle">
                    No messages yet. Say hello to {selectedModel.label}.
                  </div>
                )}
                {messages.map((message) => {
                  const mine = message.role === "user";
                  return (
                    <div
                      key={message.id}
                      className={`mc-bubble-row ${mine ? "mine" : "theirs"}`}
                    >
                      <div className={`mc-bubble ${mine ? "mine" : "theirs"}`}>
                        {!mine && message.model && (
                          <div className="mc-bubble-model">{message.model}</div>
                        )}
                        <ChatMessageContent content={message.content} />
                        <div className="mc-bubble-foot">
                          <span className="mc-bubble-time">{formatTime(message.createdAt)}</span>
                          {!mine && voiceSupport.synthesis && (
                            <button
                              type="button"
                              className="mc-speak-btn"
                              title="Speak this message"
                              onClick={() => speakMessage(message.content, message.id)}
                            >
                              <Volume2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {busy && (
                  <div className="mc-bubble-row theirs">
                    <div className="mc-bubble theirs typing">
                      <Loader2 size={14} className="spin" /> thinking…
                    </div>
                  </div>
                )}
                <div ref={threadEndRef} />
              </div>

              {pendingCommand && (
                <div className="mc-approve">
                  <div>
                    <strong>Command approval required</strong>
                    <code>{String(pendingCommand.arguments?.command || pendingCommand.name)}</code>
                  </div>
                  <div className="mc-approve-actions">
                    <button type="button" onClick={() => setPendingCommand(null)} disabled={busy}>
                      Dismiss
                    </button>
                    <button type="button" className="primary" onClick={approveCommand} disabled={busy}>
                      {executeCommand.isPending ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      Approve & execute
                    </button>
                  </div>
                </div>
              )}

              <form className="mc-composer" onSubmit={sendMessage}>
                {voiceSupport.recognition && (
                  <button
                    type="button"
                    className={`mc-mic ${listening ? "hot" : ""}`}
                    onClick={toggleMic}
                    disabled={busy}
                    title={listening ? "Stop listening" : "Dictate with microphone"}
                    aria-label={listening ? "Stop listening" : "Start microphone"}
                  >
                    {listening ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                )}
                <div className="mc-composer-field">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      listening
                        ? "Listening…"
                        : `Message ${selectedModel.label}…`
                    }
                    rows={2}
                    disabled={busy || !conversationId}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                  />
                  {interim && <div className="mc-interim">{interim}</div>}
                </div>
                <button
                  type="submit"
                  className="mc-send"
                  disabled={busy || !draft.trim() || !conversationId}
                  aria-label="Send"
                >
                  {askConversation.isPending ? (
                    <Loader2 size={18} className="spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

export default ModelChatView;
