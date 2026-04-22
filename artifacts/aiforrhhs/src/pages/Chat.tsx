import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useGetMe, 
  useStartConversation, 
  useRateResponse, 
  useSubmitFeedback 
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  followUps?: string[];
  fileAttached?: boolean;
};

const TASK_LAUNCHERS = [
  { title: "Break down an ACL or policy letter", desc: "Upload a document and get a plain-language summary" },
  { title: "Draft an email to my team", desc: "Describe the message and I'll write the first draft" },
  { title: "Prep for a difficult conversation", desc: "Plan your approach and anticipate responses" },
  { title: "Summarize a long document", desc: "Get key takeaways from reports, policies, or data" },
  { title: "Get feedback on something I wrote", desc: "Paste your draft and get specific critique" },
  { title: "Build a case for change", desc: "Structure a persuasive pitch for leadership" },
  { title: "Simplify a policy for my staff", desc: "Turn jargon into language your team can use" },
  { title: "Brainstorm solutions to a problem", desc: "Generate options and think through approaches" },
];

const OPENING_MESSAGE = "This tool is built for HHS work. You don't need to know how to prompt — just tell me what you're trying to get done, and I'll walk you through it. Pick a task below, or describe what's on your plate.";

export default function Chat() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading, error: userError } = useGetMe({ query: { retry: false } });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const startConvMutation = useStartConversation();
  const rateMutation = useRateResponse();
  const feedbackMutation = useSubmitFeedback();

  useEffect(() => {
    if (!isUserLoading && userError) setLocation("/");
  }, [isUserLoading, userError, setLocation]);

  useEffect(() => {
    if (user && !conversationId && !startConvMutation.isPending) handleNewChat();
  }, [user, conversationId]);

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
      }
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") { setFileError("Only PDF files are supported."); setSelectedFile(null); return; }
    if (file.size > 5 * 1024 * 1024) { setFileError("File too large. Maximum size is 5MB."); setSelectedFile(null); return; }
    setFileError(null);
    setSelectedFile(file);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = (error) => reject(error);
    });

  const sendMessage = async (text: string, isTaskLauncher = false) => {
    if (!text.trim() && !selectedFile) return;
    if (!conversationId) return;

    let fileBase64 = null;
    let fileMediaType = null;
    const hasFile = !!selectedFile;

    if (selectedFile) {
      try {
        fileBase64 = await fileToBase64(selectedFile);
        fileMediaType = selectedFile.type;
      } catch {
        toast({ variant: "destructive", title: "Error reading file" });
        return;
      }
    }

    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: new Date(), fileAttached: hasFile }]);
    setInput("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ conversationId, message: text, fileBase64, fileMediaType, taskLauncher: isTaskLauncher ? text : undefined }),
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
              assistantContent += data.token;
              setMessages((prev) => {
                const msgs = [...prev];
                msgs[msgs.length - 1].content = assistantContent;
                return msgs;
              });
            }
            if (data.done && data.followUps) followUps = data.followUps;
          } catch (e) {
            console.error("SSE parse error", e);
          }
        }
      }

      if (followUps.length > 0) {
        setMessages((prev) => {
          const msgs = [...prev];
          msgs[msgs.length - 1].followUps = followUps;
          return msgs;
        });
      }
    } catch {
      toast({ variant: "destructive", title: "Error sending message", description: "Please try again." });
    } finally {
      setIsStreaming(false);
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

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    setLocation("/");
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

      {/* ── HEADER ── */}
      <header style={{
        flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 52, background: "#1A2744",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}>
        <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 20, fontWeight: 700, color: "#C8963E", margin: 0 }}>
          AIforHHS
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleNewChat}
            style={{ background: "transparent", border: "1px solid #C8963E", color: "#C8963E", borderRadius: 6, fontSize: 13, padding: "5px 14px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
            data-testid="btn-new-chat"
          >
            New chat
          </button>
          <button
            onClick={logout}
            style={{ background: "none", border: "none", color: "#7B8CA3", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", padding: "5px 0" }}
            data-testid="btn-logout"
          >
            Log out
          </button>
        </div>
      </header>

      {/* ── CHAT AREA ── */}
      <div style={{ flex: 1, overflowY: "auto", background: "#ECECEC", padding: "32px 16px" }} ref={scrollRef}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>

          {messages.map((msg, idx) => (
            <div key={idx} style={{ marginBottom: 24 }}>
              {msg.role === "user" ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{
                    maxWidth: "70%", background: "#1A2744", color: "#ffffff",
                    fontSize: 14, lineHeight: 1.55,
                    borderRadius: "18px 18px 4px 18px", padding: "14px 18px",
                  }}>
                    {msg.fileAttached && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "#C8963E", fontSize: 13, fontWeight: 500 }}>
                        <Paperclip size={14} /> PDF Attached
                      </div>
                    )}
                    {msg.content}
                  </div>
                  <div style={{ fontSize: 11, color: "#888888", marginTop: 4 }}>
                    {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <div style={{ maxWidth: "88%", color: "#1A2744", fontSize: 14, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
                    {msg.content}
                    {isStreaming && idx === messages.length - 1 && msg.content === "" && (
                      <Loader2 size={16} style={{ color: "#C8963E", display: "inline-block", verticalAlign: "middle" }} className="animate-spin" />
                    )}
                  </div>

                  {idx > 0 && !isStreaming && idx === messages.length - 1 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 2, marginTop: 6 }}>
                      <ActionBtn onClick={() => handleCopy(msg.content)} testId={`btn-copy-${idx}`} label="Copy">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </ActionBtn>
                      <ActionBtn onClick={() => handleRate(idx, "up")} testId={`btn-rate-up-${idx}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
                          <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                        </svg>
                      </ActionBtn>
                      <ActionBtn onClick={() => handleRate(idx, "down")} testId={`btn-rate-down-${idx}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" />
                          <path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                        </svg>
                      </ActionBtn>
                    </div>
                  )}

                  {msg.followUps && msg.followUps.length > 0 && idx === messages.length - 1 && !isStreaming && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                      {msg.followUps.map((fu, fIdx) => (
                        <FollowUpBtn key={fIdx} onClick={() => sendMessage(fu)} testId={`btn-followup-${fIdx}`}>
                          {fu}
                        </FollowUpBtn>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* ── TASK LAUNCHER CARDS ── */}
          {isInitialState && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 24 }}>
                {TASK_LAUNCHERS.map((task, i) => (
                  <TaskCard key={i} title={task.title} desc={task.desc} onClick={() => sendMessage(task.title, true)} testId={`btn-task-${i}`} />
                ))}
              </div>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <button
                  onClick={() => sendMessage("I'm working outside my usual department. Can you help?", true)}
                  style={{ background: "none", border: "none", color: "#C8963E", fontSize: 13, cursor: "pointer", textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 4, fontFamily: "'DM Sans', sans-serif" }}
                  data-testid="btn-outside-area"
                >
                  Working outside your usual department? Let me know.
                </button>
              </div>
            </>
          )}

          {isStreaming && messages[messages.length - 1]?.role === "user" && (
            <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
              <Loader2 size={18} style={{ color: "#C8963E" }} className="animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* ── INPUT BAR ── */}
      <div style={{ flexShrink: 0, background: "#FFFFFF", borderTop: "1.5px solid #CCCCCC", padding: "12px 16px 14px" }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          {fileError && (
            <div style={{ marginBottom: 10, padding: "10px 14px", background: "#FEE2E2", color: "#DC2626", borderRadius: 8, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span>{fileError}</span>
              <button onClick={handleFileFeedback} style={{ background: "none", border: "1px solid #DC2626", borderRadius: 6, color: "#DC2626", fontSize: 12, padding: "3px 10px", cursor: "pointer" }} data-testid="btn-file-feedback">
                This got in my way
              </button>
            </div>
          )}
          {selectedFile && !fileError && (
            <div style={{ marginBottom: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "rgba(200,150,62,0.1)", borderRadius: 20, fontSize: 13, color: "#C8963E" }}>
              <Paperclip size={14} />
              <span style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.name}</span>
              <button onClick={() => setSelectedFile(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C8963E", fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 2 }} data-testid="btn-remove-file">×</button>
            </div>
          )}
          <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input type="file" accept=".pdf" style={{ display: "none" }} ref={fileInputRef} onChange={handleFileSelect} data-testid="input-file" />
            <button type="button" onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, flexShrink: 0, display: "flex", alignItems: "center" }} data-testid="btn-attach">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#444444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or describe what you're working on..."
              style={{ flex: 1, background: "#FFFFFF", border: "1.5px solid #999999", borderRadius: 24, padding: "11px 18px", fontSize: 14, color: "#1A2744", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
              data-testid="input-message"
            />
            <button
              type="submit"
              disabled={isStreaming || (!input.trim() && !selectedFile)}
              style={{ width: 40, height: 40, background: isStreaming || (!input.trim() && !selectedFile) ? "#D4A56A" : "#C8963E", border: "none", borderRadius: "50%", cursor: isStreaming || (!input.trim() && !selectedFile) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
              data-testid="btn-send"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "#9CA3AF" }}>AIforHHS can make mistakes. Verify important information.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskCard({ title, desc, onClick, testId }: { title: string; desc: string; onClick: () => void; testId: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#E2E6ED" : "#EEF0F4", border: "1px solid #D8DCE3", borderRadius: 10, padding: "14px 16px", textAlign: "left", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "background 0.15s" }}
      data-testid={testId}
    >
      <div style={{ fontSize: 14, fontWeight: 500, color: "#1A2744", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: "#6B7280", lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}

function ActionBtn({ onClick, testId, label, children }: { onClick: () => void; testId: string; label?: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", alignItems: "center", gap: 5, background: hovered ? "#DDDDE0" : "none", border: "none", cursor: "pointer", padding: "5px 8px", borderRadius: 6, color: "#444444", fontSize: 13, fontFamily: "'DM Sans', sans-serif" }}
      data-testid={testId}
    >
      {children}
      {label && <span>{label}</span>}
    </button>
  );
}

function FollowUpBtn({ onClick, testId, children }: { onClick: () => void; testId: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#E8E8EC" : "#FFFFFF", border: "1.5px solid #999999", borderRadius: 20, color: "#1A2744", fontSize: 13, fontWeight: 500, padding: "8px 16px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
      data-testid={testId}
    >
      {children}
    </button>
  );
}
