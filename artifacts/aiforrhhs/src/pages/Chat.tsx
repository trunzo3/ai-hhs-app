import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useGetMe,
  useStartConversation,
  useRateResponse,
  useSubmitFeedback,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  followUps?: string[];
  fileAttached?: string; // filename or type label
};

type TaskCardData = { title: string; desc: string };

const OPENING_MESSAGE =
  "This tool is built for HHS work. You don't need to know how to prompt — just tell me what you're trying to get done, and I'll walk you through it. Pick a task below, or describe what's on your plate.";

const WORD_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
];

const fileLabel = (file: File) => {
  if (file.type === "application/pdf") return "PDF";
  if (WORD_TYPES.includes(file.type)) return "Word doc";
  return "File";
};

function stripFollowUpsJson(text: string): { clean: string; followUps: string[] } {
  const jsonMatch = text.match(/\s*\{"followUps":\s*\[[\s\S]*?\]\}\s*$/);
  if (!jsonMatch) return { clean: text.trimEnd(), followUps: [] };
  try {
    const parsed = JSON.parse(jsonMatch[0].trim());
    const followUps = Array.isArray(parsed.followUps) ? parsed.followUps : [];
    return { clean: text.slice(0, text.length - jsonMatch[0].length).trimEnd(), followUps };
  } catch {
    return { clean: text.replace(jsonMatch[0], "").trimEnd(), followUps: [] };
  }
}

export default function Chat() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading, error: userError } = useGetMe({ query: { retry: false } });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [showGetInTouchModal, setShowGetInTouchModal] = useState(false);
  const [gitInquiryType, setGitInquiryType] = useState("");
  const [gitMessage, setGitMessage] = useState("");
  const [gitEmail, setGitEmail] = useState("");
  const [gitSubmitting, setGitSubmitting] = useState(false);

  const [showSecurityModal, setShowSecurityModal] = useState(false);

  const [taskCards, setTaskCards] = useState<TaskCardData[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startConvMutation = useStartConversation();
  const rateMutation = useRateResponse();
  const feedbackMutation = useSubmitFeedback();

  useEffect(() => {
    if (!isUserLoading && userError) setLocation("/");
  }, [isUserLoading, userError, setLocation]);

  useEffect(() => {
    if (user?.email && !gitEmail) setGitEmail(user.email);
  }, [user]);

  useEffect(() => {
    if (user && !conversationId && !startConvMutation.isPending) handleNewChat();
  }, [user, conversationId]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/task-cards")
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        setTaskCards(rows.map((r: any) => ({ title: r.title, desc: r.description })));
      })
      .catch(() => { /* on error, leave taskCards empty */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showSecurityModal && !showGetInTouchModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowSecurityModal(false);
        setShowGetInTouchModal(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSecurityModal, showGetInTouchModal]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleNewChat = () => {
    startConvMutation.mutate({ data: {} }, {
      onSuccess: (data) => {
        setConversationId(data.conversationId);
        setMessages([{ role: "assistant", content: OPENING_MESSAGE, timestamp: new Date() }]);
        setInput("");
        setSelectedFile(null);
        setFileError(null);
        if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
      },
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowed = file.type === "application/pdf" || WORD_TYPES.includes(file.type);
    if (!allowed) { setFileError("Only PDF, .docx, and .doc files are supported."); setSelectedFile(null); return; }
    if (file.size > 10 * 1024 * 1024) { setFileError("File too large. Maximum size is 10 MB."); setSelectedFile(null); return; }
    setFileError(null);
    setSelectedFile(file);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
    });

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const sendMessage = async (text: string, isTaskLauncher = false) => {
    if (!text.trim() && !selectedFile) return;
    if (!conversationId) return;
    if (isStreaming) return;

    let fileBase64: string | null = null;
    let fileMediaType: string | null = null;
    const attachedFile = selectedFile;

    if (attachedFile) {
      try {
        fileBase64 = await fileToBase64(attachedFile);
        fileMediaType = attachedFile.type;
      } catch {
        toast({ variant: "destructive", title: "Error reading file" });
        return;
      }
    }

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text, timestamp: new Date(), fileAttached: attachedFile ? attachedFile.name : undefined },
    ]);
    setInput("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    setIsStreaming(true);
    setIsThinking(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ conversationId, message: text, fileBase64, fileMediaType, taskLauncher: isTaskLauncher ? text : undefined }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Network response was not ok");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No reader");

      setMessages((prev) => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      let assistantContent = "";
      let followUps: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const dataStr = line.slice(6);
          if (dataStr === "[DONE]") continue;
          try {
            const data = JSON.parse(dataStr);
            if (data.token) {
              if (!assistantContent) setIsThinking(false);
              assistantContent += data.token;
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: assistantContent };
                return msgs;
              });
            }
            if (data.error) {
              setIsThinking(false);
              assistantContent = data.error;
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: data.error };
                return msgs;
              });
            }
            if (data.done && data.followUps) followUps = data.followUps;
          } catch { /* parse error, skip */ }
        }
      }

      const { clean, followUps: extractedFUs } = stripFollowUpsJson(assistantContent);
      const finalFollowUps = followUps.length > 0 ? followUps : extractedFUs;
      setMessages((prev) => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: clean, followUps: finalFollowUps.length > 0 ? finalFollowUps : undefined };
        return msgs;
      });
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        toast({ variant: "destructive", title: "Error sending message", description: "Please try again." });
      }
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && !last.content) return prev.slice(0, -1);
        return prev;
      });
    } finally {
      setIsStreaming(false);
      setIsThinking(false);
      abortControllerRef.current = null;
    }
  };

  const handleRate = (index: number, rating: "up" | "down") => {
    if (!conversationId) return;
    rateMutation.mutate({ conversationId, data: { rating, messageIndex: index } }, {
      onSuccess: () => toast({ title: "Feedback submitted", description: "Thank you for your feedback." }),
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const handleFileFeedback = () => {
    feedbackMutation.mutate({ data: { feedbackType: "file_upload_error", detail: "File too large", attemptedFileSize: 5 * 1024 * 1024 + 1 } }, {
      onSuccess: () => { setFileError(null); toast({ title: "Feedback sent", description: "We'll look into improving this." }); },
    });
  };

  const handleSubmitInquiry = async () => {
    if (!gitInquiryType || !gitMessage.trim() || !gitEmail.trim()) return;
    setGitSubmitting(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryType: gitInquiryType, message: gitMessage.trim(), preferredEmail: gitEmail.trim() }),
      });
      if (!res.ok) throw new Error("Submit failed");
      setShowGetInTouchModal(false);
      setGitInquiryType("");
      setGitMessage("");
      setGitEmail(user?.email ?? "");
      toast({ title: "Message sent", description: "Thanks — I'll be in touch soon." });
    } catch {
      toast({ variant: "destructive", title: "Couldn't send", description: "Please try again." });
    } finally {
      setGitSubmitting(false);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    setLocation("/");
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) sendMessage(input);
    }
  };

  if (isUserLoading || !user) {
    return (
      <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 style={{ width: 32, height: 32, color: "#C8963E" }} className="animate-spin" />
      </div>
    );
  }

  const isInitialState = messages.length === 1 && messages[0].role === "assistant";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <style>{`
        .md-body p { margin: 0 0 8px 0; }
        .md-body p:last-child { margin-bottom: 0; }
        .md-body ul { list-style-type: disc; padding-left: 22px; margin: 0 0 8px 0; }
        .md-body ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 8px 0; }
        .md-body li { margin: 2px 0; display: list-item; }
        .md-body ul ul { list-style-type: circle; margin-bottom: 0; }
        .md-body ul ul ul { list-style-type: square; }
        .md-body h1 { font-size: 18px; font-weight: 700; margin: 14px 0 6px; }
        .md-body h2 { font-size: 16px; font-weight: 600; margin: 12px 0 5px; }
        .md-body h3 { font-size: 15px; font-weight: 600; margin: 10px 0 4px; }
        .md-body code { background: #F3F4F6; padding: 1px 5px; border-radius: 3px; font-size: 13px; font-family: monospace; }
        .md-body pre { background: #F3F4F6; padding: 10px 14px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
        .md-body pre code { background: none; padding: 0; font-size: 12px; }
        .md-body blockquote { border-left: 3px solid #C8963E; padding-left: 12px; margin: 8px 0; color: #4B5563; }
        .md-body strong { font-weight: 600; }
        .md-body table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 13px; }
        .md-body th, .md-body td { border: 1px solid #D1D5DB; padding: 6px 10px; text-align: left; }
        .md-body th { background: #F9FAFB; font-weight: 600; }
        @keyframes thinking-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-7px); opacity: 1; }
        }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: 52, background: "#1A2744", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, fontWeight: 700, color: "#C8963E", margin: 0 }}>AI for HHS</h1>
          <button onClick={handleNewChat} style={{ background: "transparent", border: "1px solid #C8963E", color: "#C8963E", borderRadius: 6, fontSize: 13, padding: "5px 14px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-new-chat">New chat</button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={() => { setGitEmail(user?.email ?? ""); setShowGetInTouchModal(true); }} style={{ background: "transparent", border: "none", color: "#7B8CA3", fontSize: 15, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: "5px 0" }} data-testid="btn-get-in-touch">Get in touch</button>
          <button onClick={logout} style={{ background: "none", border: "none", color: "#7B8CA3", fontSize: 15, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: "5px 0" }} data-testid="btn-logout">Log out</button>
        </div>
      </header>
      {/* ── CHAT AREA ── */}
      <div style={{ flex: 1, overflowY: "auto", background: "#ECECEC", padding: "32px 16px" }} ref={scrollRef}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {messages.map((msg, idx) => (
            <div key={idx} style={{ marginBottom: 24 }}>
              {msg.role === "user" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{ maxWidth: "70%", background: "#1A2744", color: "#ffffff", fontSize: 14, lineHeight: 1.55, borderRadius: "18px 18px 4px 18px", padding: "14px 18px" }}>
                    {msg.fileAttached && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#C8963E", fontSize: 13, fontWeight: 500 }}>
                        <Paperclip size={14} /> {msg.fileAttached}
                      </div>
                    )}
                    <span style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <ActionBtn onClick={() => handleCopy(msg.content)} testId={`btn-copy-user-${idx}`} label="Copy">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    </ActionBtn>
                    <span style={{ fontSize: 11, color: "#888888" }}>{msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <div className="md-body" style={{ maxWidth: "88%", color: "#1A2744", fontSize: 14, lineHeight: 1.75 }}>
                    {msg.content ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    ) : null}
                  </div>

                  {idx > 0 && !isStreaming && idx === messages.length - 1 && msg.content && (
                    <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 6 }}>
                      <ActionBtn onClick={() => handleCopy(msg.content)} testId={`btn-copy-${idx}`} label="Copy">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      </ActionBtn>
                      <ActionBtn onClick={() => handleRate(idx, "up")} testId={`btn-rate-up-${idx}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" /><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" /></svg>
                      </ActionBtn>
                      <ActionBtn onClick={() => handleRate(idx, "down")} testId={`btn-rate-down-${idx}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" /><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" /></svg>
                      </ActionBtn>
                    </div>
                  )}

                  {msg.followUps && msg.followUps.length > 0 && idx === messages.length - 1 && !isStreaming && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                      {msg.followUps.map((fu, fIdx) => (
                        <FollowUpBtn key={fIdx} onClick={() => sendMessage(fu)} testId={`btn-followup-${fIdx}`}>{fu}</FollowUpBtn>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isThinking && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0", marginBottom: 8 }}>
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n} style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: "#444444", animation: `thinking-bounce 1.2s ease-in-out ${n * 0.18}s infinite` }} />
              ))}
            </div>
          )}

          {isInitialState && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 24 }}>
                {taskCards.map((task, i) => (
                  <TaskCard key={i} title={task.title} desc={task.desc} onClick={() => sendMessage(task.title, true)} testId={`btn-task-${i}`} />
                ))}
              </div>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <button onClick={() => sendMessage("I'm working outside my usual department. Can you help?", true)} style={{ background: "none", border: "none", color: "#C8963E", fontSize: 13, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 4, fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-outside-area">
                  Working outside your usual department? Let me know.
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── INPUT BAR ── */}
      <div style={{ flexShrink: 0, background: "#FFFFFF", borderTop: "1.5px solid #CCCCCC", padding: "12px 16px 14px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 10, lineHeight: 1.45 }}>
            <div style={{ fontSize: 16, fontWeight: 400, color: "#C8963E" }}>
              AI for HHS never stores your conversations.
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#B91C1C", marginTop: 2 }}>
              When you close this chat, it's gone.
            </div>
          </div>
          {fileError && (
            <div style={{ marginBottom: 10, padding: "10px 14px", background: "#FEE2E2", color: "#DC2626", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{fileError}</span>
              <button onClick={handleFileFeedback} style={{ background: "none", border: "1px solid #DC2626", borderRadius: 6, color: "#DC2626", fontSize: 12, padding: "3px 10px", cursor: "pointer" }} data-testid="btn-file-feedback">This got in my way</button>
            </div>
          )}
          {selectedFile && !fileError && (
            <div style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "rgba(200,150,62,0.1)", borderRadius: 20, fontSize: 13, color: "#C8963E" }}>
              <Paperclip size={14} />
              <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.name}</span>
              <span style={{ opacity: 0.6, fontSize: 11 }}>({fileLabel(selectedFile)})</span>
              <button onClick={() => setSelectedFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C8963E", fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 2 }} data-testid="btn-remove-file">×</button>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <input type="file" accept=".pdf,.doc,.docx" style={{ display: "none" }} ref={fileInputRef} onChange={handleFileSelect} data-testid="input-file" />
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isStreaming} style={{ background: "none", border: "none", cursor: isStreaming ? "not-allowed" : "pointer", padding: 4, flexShrink: 0, display: "flex", alignItems: "center", opacity: isStreaming ? 0.4 : 1, marginBottom: 4 }} data-testid="btn-attach">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Ask anything or describe what you're working on…"
              rows={1}
              style={{ flex: 1, background: "#FFFFFF", border: "1.5px solid #999999", borderRadius: 18, padding: "11px 18px", fontSize: 14, color: "#1A2744", fontFamily: "'DM Sans', sans-serif", outline: "none", resize: "none", lineHeight: 1.5, overflowY: "hidden", maxHeight: 200, minHeight: 44 }}
              data-testid="input-message"
            />
            {isStreaming ? (
              <button onClick={handleStop} style={{ width: 40, height: 40, background: "#C8963E", border: "none", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginBottom: 2 }} data-testid="btn-stop" title="Stop generating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="#ffffff"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
              </button>
            ) : (
              <button type="button" onClick={() => sendMessage(input)} disabled={!input.trim() && !selectedFile} style={{ width: 40, height: 40, background: (!input.trim() && !selectedFile) ? "#D4A56A" : "#C8963E", border: "none", borderRadius: "50%", cursor: (!input.trim() && !selectedFile) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginBottom: 2 }} data-testid="btn-send">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            )}
          </div>
          <div style={{ textAlign: "center", marginTop: 10 }}>
            <SecurityPill onClick={() => setShowSecurityModal(true)} />
          </div>
        </div>
      </div>

      {/* ── GET IN TOUCH MODAL ── */}
      {showGetInTouchModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} onClick={(e) => { if (e.target === e.currentTarget) setShowGetInTouchModal(false); }}>
          <div style={{ background: "#fff", borderRadius: 12, maxWidth: 500, width: "100%", padding: "28px 28px 24px", boxShadow: "0 16px 48px rgba(0,0,0,0.2)", fontFamily: "'DM Sans', sans-serif", position: "relative" }}>
            <ModalCloseButton onClick={() => setShowGetInTouchModal(false)} testId="btn-close-get-in-touch" />
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#1A2744", margin: "0 0 8px" }}>Get in touch</h2>
            <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 22px", lineHeight: 1.6 }}>Whether you want training for your team, help with a project, or want to share feedback about the tool — I'd love to hear from you.</p>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>What are you interested in?</label>
              <select
                value={gitInquiryType}
                onChange={(e) => setGitInquiryType(e.target.value)}
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "9px 12px", fontSize: 14, color: gitInquiryType ? "#111827" : "#9CA3AF", fontFamily: "'DM Sans', sans-serif", background: "#fff", outline: "none", boxSizing: "border-box" }}
              >
                <option value="" disabled>Select an option…</option>
                <option value="AI training for my team">AI training for my team</option>
                <option value="Help with a specific project">Help with a specific project</option>
                <option value="Share feedback about the tool">Share feedback about the tool</option>
                <option value="Something else">Something else</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Tell me more</label>
              <textarea
                value={gitMessage}
                onChange={(e) => setGitMessage(e.target.value)}
                placeholder="What are you working on, and how can I help?"
                rows={4}
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "10px 14px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: "#111827", resize: "vertical", outline: "none", boxSizing: "border-box", lineHeight: 1.5 }}
              />
            </div>

            <div style={{ marginBottom: 22 }}>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Best email to reach you</label>
              <input
                type="email"
                value={gitEmail}
                onChange={(e) => setGitEmail(e.target.value)}
                style={{ width: "100%", border: "1.5px solid #D1D5DB", borderRadius: 8, padding: "9px 14px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", color: "#111827", outline: "none", boxSizing: "border-box" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowGetInTouchModal(false)} style={{ background: "none", border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 18px", fontSize: 13, cursor: "pointer", color: "#374151", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
              <button
                onClick={handleSubmitInquiry}
                disabled={!gitInquiryType || !gitMessage.trim() || !gitEmail.trim() || gitSubmitting}
                style={{ background: (!gitInquiryType || !gitMessage.trim() || !gitEmail.trim() || gitSubmitting) ? "#D4A56A" : "#C8963E", border: "none", borderRadius: 6, padding: "8px 22px", fontSize: 13, fontWeight: 600, cursor: (!gitInquiryType || !gitMessage.trim() || !gitEmail.trim() || gitSubmitting) ? "not-allowed" : "pointer", color: "#fff", fontFamily: "'DM Sans', sans-serif" }}
              >
                {gitSubmitting ? "Sending…" : "Send message"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── SECURITY MODAL ── */}
      {showSecurityModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowSecurityModal(false); }}
          data-testid="modal-security"
        >
          <div style={{ position: "relative", background: "#0F1A2E", borderRadius: 14, width: "100%", maxWidth: 1180, height: "90vh", boxShadow: "0 24px 80px rgba(0,0,0,0.5)", overflow: "hidden", border: "1px solid #2A3A50" }}>
            <ModalCloseButton onClick={() => setShowSecurityModal(false)} testId="btn-close-security" />
            <iframe
              src="/security-continuum.html"
              title="AI Data Security Continuum"
              style={{ width: "100%", height: "100%", border: "none", display: "block", background: "#0F1A2E" }}
              data-testid="iframe-security"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ModalCloseButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label="Close"
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "#2A3A50",
        border: `2px solid ${hovered ? "#C8963E" : "#7B8CA3"}`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        zIndex: 10,
        transition: "border-color 0.2s",
      }}
      data-testid={testId}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}

function SecurityPill({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? "rgba(200,150,62,0.12)" : "transparent",
        border: "1px solid #C8963E",
        borderRadius: 20,
        color: "#C8963E",
        fontSize: 14,
        padding: "5px 18px",
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
        transition: "background 0.15s",
      }}
      data-testid="btn-security-pill"
    >
      Security
    </button>
  );
}

function TaskCard({ title, desc, onClick, testId }: { title: string; desc: string; onClick: () => void; testId: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ background: hovered ? "#C4DAFC" : "#DBEAFE", border: "1px solid #BFDBFE", borderRadius: 10, padding: "14px 16px", textAlign: "left", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "background 0.15s" }} data-testid={testId}>
      <div style={{ fontSize: 14, fontWeight: 500, color: "#1A2744", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}

function ActionBtn({ onClick, testId, label, children }: { onClick: () => void; testId: string; label?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ display: "flex", alignItems: "center", gap: 5, background: hovered ? "#DDDDE0" : "none", border: "none", cursor: "pointer", padding: "5px 8px", borderRadius: 6, color: "#444444", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }} data-testid={testId}>
      {children}{label && <span>{label}</span>}
    </button>
  );
}

function FollowUpBtn({ onClick, testId, children }: { onClick: () => void; testId: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ background: hovered ? "#E8E8EC" : "#FFFFFF", border: "1.5px solid #999999", borderRadius: 20, color: "#1A2744", fontSize: 13, fontWeight: 500, padding: "8px 16px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid={testId}>
      {children}
    </button>
  );
}
