import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useGetMe, 
  useStartConversation, 
  useRateResponse, 
  useSubmitFeedback 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Paperclip, Send, ThumbsUp, ThumbsDown, Copy, LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

type Message = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  followUps?: string[];
  fileAttached?: boolean;
};

const TASK_LAUNCHERS = [
  "Break down an ACL or policy letter",
  "Draft an email to my team",
  "Prep for a difficult conversation",
  "Summarize a long document",
  "Get feedback on something I wrote",
  "Build a case for change",
  "Simplify a policy for my staff",
  "Brainstorm solutions to a problem"
];

export default function Chat() {
  const [location, setLocation] = useLocation();
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
    if (!isUserLoading && userError) {
      setLocation("/");
    }
  }, [isUserLoading, userError, setLocation]);

  useEffect(() => {
    if (user && !conversationId && !startConvMutation.isPending) {
      handleNewChat();
    }
  }, [user, conversationId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleNewChat = () => {
    startConvMutation.mutate({ data: {} }, {
      onSuccess: (data) => {
        setConversationId(data.conversationId);
        setMessages([{
          role: "assistant",
          content: user?.createdAt && new Date(user.createdAt).getTime() > Date.now() - 86400000 
            ? "This tool is built for HHS work. You don't need to know how to prompt — just tell me what you're trying to get done, and I'll walk you through it. Pick a task below, or describe what's on your plate."
            : "Welcome back. What are you working on today?",
          timestamp: new Date()
        }]);
        setInput("");
        setSelectedFile(null);
        setFileError(null);
      }
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setFileError("Only PDF files are supported.");
      setSelectedFile(null);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setFileError("File too large. Maximum size is 5MB.");
      setSelectedFile(null);
      return;
    }

    setFileError(null);
    setSelectedFile(file);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = error => reject(error);
    });
  };

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
      } catch (err) {
        toast({ variant: "destructive", title: "Error reading file" });
        return;
      }
    }

    const newUserMsg: Message = {
      role: "user",
      content: text,
      timestamp: new Date(),
      fileAttached: hasFile
    };

    setMessages(prev => [...prev, newUserMsg]);
    setInput("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setIsStreaming(true);

    try {
      const response = await fetch("/api/chat/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify({
          conversationId,
          message: text,
          fileBase64,
          fileMediaType,
          taskLauncher: isTaskLauncher ? text : undefined
        })
      });

      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No reader");

      setMessages(prev => [...prev, { role: "assistant", content: "", timestamp: new Date() }]);

      let assistantContent = "";
      let followUps: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            if (dataStr === '[DONE]') continue;
            
            try {
              const data = JSON.parse(dataStr);
              if (data.token) {
                assistantContent += data.token;
                setMessages(prev => {
                  const newMsgs = [...prev];
                  newMsgs[newMsgs.length - 1].content = assistantContent;
                  return newMsgs;
                });
              }
              if (data.done && data.followUps) {
                followUps = data.followUps;
              }
            } catch (e) {
              console.error("Error parsing SSE data", e);
            }
          }
        }
      }

      setMessages(prev => {
        const newMsgs = [...prev];
        if (followUps.length > 0) {
          newMsgs[newMsgs.length - 1].followUps = followUps;
        }
        return newMsgs;
      });

    } catch (err) {
      toast({ variant: "destructive", title: "Error sending message", description: "Please try again." });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleRate = (index: number, rating: "up" | "down") => {
    if (!conversationId) return;
    rateMutation.mutate({ 
      conversationId, 
      data: { rating, messageIndex: index } 
    }, {
      onSuccess: () => {
        toast({ title: "Feedback submitted", description: "Thank you for your feedback." });
      }
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const handleFileFeedback = () => {
    feedbackMutation.mutate({
      data: {
        feedbackType: "file_upload_error",
        detail: "File too large",
        attemptedFileSize: 5 * 1024 * 1024 + 1 // mockup
      }
    }, {
      onSuccess: () => {
        setFileError(null);
        toast({ title: "Feedback sent", description: "We'll look into improving this." });
      }
    });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    setLocation("/");
  };

  if (isUserLoading || !user) {
    return <div className="min-h-screen bg-navy flex items-center justify-center"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>;
  }

  const isInitialState = messages.length === 1 && messages[0].role === "assistant";

  return (
    <div className="flex flex-col h-screen bg-[#F5F5F5]">
      <header className="flex-none flex items-center justify-between px-6 py-4 bg-sidebar border-b border-sidebar-border">
        <h1 className="font-serif text-2xl font-bold text-white tracking-tight">AIforHHS</h1>
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={handleNewChat} className="border-primary text-primary hover:bg-primary/10" data-testid="btn-new-chat">
            New Chat
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} className="text-sidebar-foreground hover:bg-sidebar-accent" data-testid="btn-logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-8" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-5 py-4 ${
                msg.role === "user" 
                  ? "bg-sidebar text-white shadow-md rounded-br-none" 
                  : "bg-white text-sidebar shadow-sm rounded-bl-none border border-border/50"
              }`}>
                {msg.fileAttached && (
                  <div className="flex items-center gap-2 mb-2 text-primary text-sm font-medium">
                    <Paperclip className="w-4 h-4" /> PDF Attached
                  </div>
                )}
                <div className="whitespace-pre-wrap leading-relaxed text-[15px]">{msg.content}</div>
                
                {msg.role === "user" && (
                  <div className="text-[11px] text-white/50 mt-2 text-right">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              
              {msg.role === "assistant" && idx > 0 && !isStreaming && idx === messages.length - 1 && (
                <div className="flex items-center gap-2 mt-2 ml-2">
                  <Button variant="ghost" size="sm" className="h-8 px-2 text-muted-foreground hover:text-sidebar" onClick={() => handleCopy(msg.content)} data-testid={`btn-copy-${idx}`}>
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleRate(idx, "up")} data-testid={`btn-rate-up-${idx}`}>
                    <ThumbsUp className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleRate(idx, "down")} data-testid={`btn-rate-down-${idx}`}>
                    <ThumbsDown className="w-3 h-3" />
                  </Button>
                </div>
              )}

              {msg.followUps && msg.followUps.length > 0 && idx === messages.length - 1 && !isStreaming && (
                <div className="flex flex-wrap gap-2 mt-3 w-full max-w-[85%]">
                  {msg.followUps.map((followUp, fIdx) => (
                    <Button 
                      key={fIdx} 
                      variant="outline" 
                      className="rounded-full text-sm bg-white border-primary/30 text-sidebar hover:bg-primary/5 h-auto py-2 px-4 text-left whitespace-normal h-auto"
                      onClick={() => sendMessage(followUp)}
                      data-testid={`btn-followup-${fIdx}`}
                    >
                      {followUp}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isInitialState && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
              {TASK_LAUNCHERS.map((task, i) => (
                <Button 
                  key={i}
                  variant="outline" 
                  className="h-auto p-4 justify-start text-left bg-white hover:bg-primary/5 hover:border-primary border-border/60 shadow-sm transition-all"
                  onClick={() => sendMessage(task, true)}
                  data-testid={`btn-task-${i}`}
                >
                  <span className="text-[15px] font-medium text-sidebar">{task}</span>
                </Button>
              ))}
            </div>
          )}
          {isInitialState && (
             <div className="mt-4 text-center">
               <button 
                className="text-sm text-sidebar/60 hover:text-primary transition-colors underline decoration-dotted underline-offset-4"
                onClick={() => sendMessage("I'm working outside my usual area. Can you help?", true)}
                data-testid="btn-outside-area"
               >
                 Working outside your usual area? Let me know.
               </button>
             </div>
          )}

          {isStreaming && messages[messages.length - 1]?.role === "user" && (
            <div className="flex items-start">
              <div className="bg-white text-sidebar shadow-sm rounded-2xl rounded-bl-none px-5 py-4 border border-border/50">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-none p-4 bg-white border-t border-border">
        <div className="max-w-3xl mx-auto">
          {fileError && (
            <div className="mb-3 p-3 bg-destructive/10 text-destructive text-sm rounded-md flex items-center justify-between">
              <span>{fileError}</span>
              <Button variant="outline" size="sm" className="h-7 text-xs border-destructive text-destructive hover:bg-destructive hover:text-white" onClick={handleFileFeedback} data-testid="btn-file-feedback">
                This got in my way
              </Button>
            </div>
          )}
          {selectedFile && !fileError && (
            <div className="mb-3 inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary text-sm rounded-full">
              <Paperclip className="w-3.5 h-3.5" />
              <span className="truncate max-w-[200px]">{selectedFile.name}</span>
              <button onClick={() => setSelectedFile(null)} className="ml-1 hover:text-sidebar" data-testid="btn-remove-file">×</button>
            </div>
          )}
          <form 
            onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
            className="flex items-end gap-2 relative bg-[#F5F5F5] rounded-2xl border border-border/60 p-2 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all shadow-inner"
          >
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileSelect}
              data-testid="input-file"
            />
            <Button 
              type="button" 
              variant="ghost" 
              size="icon" 
              className="shrink-0 text-sidebar/60 hover:text-primary rounded-xl h-10 w-10 mb-0.5"
              onClick={() => fileInputRef.current?.click()}
              data-testid="btn-attach"
            >
              <Paperclip className="w-5 h-5" />
            </Button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything or describe what you're working on..."
              className="flex-1 bg-transparent border-0 focus:ring-0 resize-none min-h-[44px] max-h-32 py-2.5 px-2 text-[15px] placeholder:text-sidebar/40 focus-visible:outline-none"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              data-testid="input-message"
            />
            <Button 
              type="submit" 
              size="icon" 
              disabled={isStreaming || (!input.trim() && !selectedFile)}
              className="shrink-0 bg-primary text-white hover:bg-primary/90 rounded-xl h-10 w-10 mb-0.5 shadow-sm disabled:opacity-50"
              data-testid="btn-send"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </Button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[10px] text-sidebar/40">AIforHHS can make mistakes. Verify important information.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
