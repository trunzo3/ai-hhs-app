import { useState, useEffect, useCallback, useRef } from "react";
import { setAdminAuthenticated } from "@/lib/adminAuth";

type AdminTab = "inbox" | "dashboard" | "users" | "settings";

type AdminStats = {
  totalUsers: number; newThisMonth: number; weeklyActive: number; unmatchedDomainsThisWeek: number;
  returningUsers: number; oneTimeUsers: number; totalConversations: number; avgMessagesPerConversation: number;
  thumbsUpCount: number; thumbsDownCount: number; currentMonthSpend: number; currentMonthTokens: number;
  unmatchedDomainCount: number; usersByCounty: Array<{ label: string; count: number }>;
  usersByServiceCategory: Array<{ label: string; count: number }>; taskLauncherUsage: Array<{ label: string; count: number }>;
  activeModel: string; spendThreshold: number;
  supportEmail?: string; debugRetrievalLogging?: boolean;
};
type RetrievalDebugEntry = {
  id: string; conversationId: string | null; userId: string | null; userEmail: string | null;
  query: string; chunks: Array<{ docId: string; title: string; score: number; preview: string }>;
  createdAt: string;
};
type TestRetrievalResult = { docId: string; title: string; score: number; preview: string };
type AdminConfig = {
  activeModel: string; spendThreshold: number; currentMonthSpend: number; currentMonthTokens: number;
  supportEmail: string; debugRetrievalLogging: boolean;
};
type AdminUser = {
  id: string; email: string; county: string; serviceCategory: string; domainMatch: boolean;
  domainNote: string | null; disabled: boolean; createdAt: string; lastActive: string | null; conversationCount: number;
};
type AdminFeedback = {
  id: string; userId: string; userEmail: string; domain: string; feedbackType: string;
  detail: string | null; attemptedFileSize: number | null; createdAt: string;
};
type AdminInquiry = {
  id: string; userId: string; userEmail: string; domain: string;
  inquiryType: string; message: string; preferredEmail: string; createdAt: string;
};
type AdminTrends = {
  weeklyActive: number[]; weeklyConversations: number[]; weeklyThumbsUpPct: (number | null)[];
};
type CorpusDocMeta = {
  docId: string; title: string; description: string; category: string;
  chunkCount: number; lastUpdated: string | null; createdAt: string | null;
};
type SPLayer = { layer: number; content: string; previousContent: string | null; updatedAt: string | null };

const MODEL_OPTIONS = [
  { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];
const CORPUS_CATEGORIES = ["Methodology", "Task Chain", "Prompts", "Workflows"] as const;
const SP_LAYER_LABELS: Record<number, string> = {
  1: "Layer 1: Identity & Tone",
  2: "Layer 2: Methodology",
  3: "Layer 3: RAG Context",
  4: "Layer 4: User Context",
};
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Methodology: { bg: "#DBEAFE", text: "#1E40AF" },
  "Task Chain": { bg: "#D1FAE5", text: "#065F46" },
  Prompts: { bg: "#EDE9FE", text: "#5B21B6" },
  Workflows: { bg: "#FEF3C7", text: "#92400E" },
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const fmtShort = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
const getDomain = (email: string) => email.split("@")[1] ?? "";
const readFileAsText = (file: File): Promise<string> => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.onerror = reject; r.readAsText(file); });

function lineDiff(oldText: string, newText: string): Array<{ type: "added" | "removed" | "same"; text: string }> {
  const oldLines = oldText.split("\n"), newLines = newText.split("\n");
  const m = oldLines.length, n = newLines.length;
  if (m > 300 || n > 300) {
    return [
      ...oldLines.map((t) => ({ type: "removed" as const, text: t })),
      ...newLines.map((t) => ({ type: "added" as const, text: t })),
    ];
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  const result: Array<{ type: "added" | "removed" | "same"; text: string }> = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) { result.unshift({ type: "same", text: oldLines[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { result.unshift({ type: "added", text: newLines[j - 1] }); j--; }
    else { result.unshift({ type: "removed", text: oldLines[i - 1] }); i--; }
  }
  return result;
}

export default function Admin() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const auth = sessionStorage.getItem("adminAuth");
    if (auth === "true") { setAdminAuthenticated(true); setIsAuthenticated(true); }
    setIsCheckingAuth(false);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        sessionStorage.setItem("adminAuth", "true");
        setAdminAuthenticated(true);
        setIsAuthenticated(true);
      } else {
        setLoginError(data.error ?? "Invalid admin credentials.");
      }
    } catch {
      setLoginError("Could not reach the server. Please try again.");
    }
  };

  const handleLogout = () => { sessionStorage.removeItem("adminAuth"); setAdminAuthenticated(false); window.location.href = "/"; };

  if (isCheckingAuth) return <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner /><GlobalStyles /></div>;

  if (!isAuthenticated) return (
    <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: "40px 36px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: "#C8963E", margin: "0 0 6px" }}>AI for HHS</h1>
          <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>Admin Dashboard</p>
        </div>
        <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div><label style={labelStyle}>Email</label><input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@example.com" style={{ ...inputStyle(320), padding: "9px 12px" }} /></div>
          <div><label style={labelStyle}>Password</label><input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" style={{ ...inputStyle(320), padding: "9px 12px" }} /></div>
          {loginError && <p style={{ color: "#DC2626", fontSize: 13, margin: 0 }}>{loginError}</p>}
          <button type="submit" style={{ background: "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Log In</button>
        </form>
      </div>
      <GlobalStyles />
    </div>
  );

  return <AdminDashboard onLogout={handleLogout} />;
}

function Sparkline({ data, color = "#C8963E", width = 120, height = 40 }: { data: (number | null)[]; color?: string; width?: number; height?: number }) {
  const nums = data.filter((v): v is number => v !== null && !isNaN(v));
  if (nums.length < 2) return <div style={{ fontSize: 11, color: "#9CA3AF", height, lineHeight: `${height}px` }}>Not enough data yet</div>;
  const min = Math.min(...nums), max = Math.max(...nums);
  const range = max - min || 1;
  const pts = data.reduce<{ x: number; y: number }[]>((acc, v, i) => {
    if (v === null || isNaN(v)) return acc;
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    acc.push({ x, y });
    return acc;
  }, []);
  if (pts.length < 2) return <div style={{ fontSize: 11, color: "#9CA3AF" }}>Not enough data yet</div>;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3" fill={color} />
    </svg>
  );
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("inbox");

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [trends, setTrends] = useState<AdminTrends | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [inquiries, setInquiries] = useState<AdminInquiry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchEmail, setSearchEmail] = useState("");
  const [filterCounty, setFilterCounty] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [sortField, setSortField] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [feedbackSortField, setFeedbackSortField] = useState("createdAt");
  const [feedbackSortDir, setFeedbackSortDir] = useState<"asc" | "desc">("desc");
  const [inquirySortField, setInquirySortField] = useState("createdAt");
  const [inquirySortDir, setInquirySortDir] = useState<"asc" | "desc">("desc");
  const [thresholdInput, setThresholdInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);

  /* ── Corpus state ── */
  const [corpusDocs, setCorpusDocs] = useState<CorpusDocMeta[]>([]);
  const [corpusFetched, setCorpusFetched] = useState(false);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [corpusOp, setCorpusOp] = useState<string | null>(null);
  const [corpusOpError, setCorpusOpError] = useState<string | null>(null);
  const [corpusFilter, setCorpusFilter] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadCategory, setUploadCategory] = useState<string>("Methodology");
  const [uploadDocId, setUploadDocId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<CorpusDocMeta | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [viewModal, setViewModal] = useState<{ docId: string; title: string; content: string } | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  /* ── Task launcher cards state ── */
  type TaskCard = { id: string; title: string; description: string; displayOrder: number; taskChainPrompt: string | null; corpusDocIds: string[]; updatedAt: string | null };
  type TaskCardDraft = { title: string; description: string; displayOrder: number; taskChainPrompt: string; corpusDocIds: string[] };
  const [taskCards, setTaskCards] = useState<TaskCard[]>([]);
  const [taskCardDrafts, setTaskCardDrafts] = useState<Record<string, TaskCardDraft>>({});
  const [corpusPickerOpenFor, setCorpusPickerOpenFor] = useState<string | null>(null);
  const [corpusDeleteConflict, setCorpusDeleteConflict] = useState<{ doc: CorpusDocMeta; cards: Array<{ id: string; title: string }> } | null>(null);
  const [corpusDeleteForceSubmitting, setCorpusDeleteForceSubmitting] = useState(false);
  const [taskCardsFetched, setTaskCardsFetched] = useState(false);
  const [taskCardsLoading, setTaskCardsLoading] = useState(false);
  const [taskCardSavingId, setTaskCardSavingId] = useState<string | null>(null);
  const [taskCardError, setTaskCardError] = useState<string | null>(null);
  const [taskCardAdding, setTaskCardAdding] = useState(false);
  const [deletingTaskCard, setDeletingTaskCard] = useState<TaskCard | null>(null);
  const [deleteTaskCardText, setDeleteTaskCardText] = useState("");
  const [deletingTaskCardSubmitting, setDeletingTaskCardSubmitting] = useState(false);

  /* ── Retrieval debug + test retrieval state ── */
  const [retrievalDebug, setRetrievalDebug] = useState<RetrievalDebugEntry[]>([]);
  const [retrievalDebugLoading, setRetrievalDebugLoading] = useState(false);
  const [retrievalDebugFetched, setRetrievalDebugFetched] = useState(false);
  const [retrievalDebugError, setRetrievalDebugError] = useState<string | null>(null);
  const [debugLoggingEnabled, setDebugLoggingEnabled] = useState<boolean>(false);
  const [debugLoggingSaving, setDebugLoggingSaving] = useState(false);
  const [testRetrievalQuery, setTestRetrievalQuery] = useState("");
  const [testRetrievalK, setTestRetrievalK] = useState<number>(5);
  const [testRetrievalResults, setTestRetrievalResults] = useState<TestRetrievalResult[] | null>(null);
  const [testRetrievalLoading, setTestRetrievalLoading] = useState(false);
  const [testRetrievalError, setTestRetrievalError] = useState<string | null>(null);

  /* ── Support email state ── */
  const [supportEmailInput, setSupportEmailInput] = useState("");
  const [supportEmailSaving, setSupportEmailSaving] = useState(false);
  const [supportEmailError, setSupportEmailError] = useState<string | null>(null);

  /* ── User reset password modal state ── */
  const [resetUserModal, setResetUserModal] = useState<{ user: AdminUser; resetUrl: string; expiresAt: string } | null>(null);
  const [resetUserLoadingId, setResetUserLoadingId] = useState<string | null>(null);
  const [resetUserError, setResetUserError] = useState<string | null>(null);
  const [resetUrlCopied, setResetUrlCopied] = useState(false);

  /* ── System prompt state ── */
  const [spLayers, setSPLayers] = useState<SPLayer[]>([]);
  const [spFetched, setSPFetched] = useState(false);
  const [spLoading, setSPLoading] = useState(false);
  const [activeSpLayer, setActiveSpLayer] = useState(1);
  const [spDraft, setSPDraft] = useState<Record<number, string>>({});
  const [spSaving, setSPSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<{ layer: number; old: string; next: string } | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sRes, uRes, fRes, tRes, iRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/users"),
        fetch("/api/admin/feedback"),
        fetch("/api/admin/trends"),
        fetch("/api/admin/inquiries"),
      ]);
      if (!sRes.ok || !uRes.ok || !fRes.ok) throw new Error("Fetch failed");
      const [sData, uData, fData] = await Promise.all([sRes.json(), uRes.json(), fRes.json()]);
      setStats(sData); setUsers(uData); setFeedback(fData); setThresholdInput(String(sData.spendThreshold));
      if (tRes.ok) setTrends(await tRes.json());
      if (iRes.ok) setInquiries(await iRes.json());
    } catch { setError("Failed to load dashboard data. Please refresh."); }
    setLoading(false);
  }, []);

  const fetchCorpus = useCallback(async () => {
    setCorpusLoading(true); setCorpusOpError(null);
    try {
      const res = await fetch("/api/admin/corpus");
      if (!res.ok) throw new Error("Failed");
      setCorpusDocs(await res.json()); setCorpusFetched(true);
    } catch { setCorpusOpError("Failed to load corpus documents."); }
    setCorpusLoading(false);
  }, []);

  const fetchTaskCards = useCallback(async () => {
    setTaskCardsLoading(true); setTaskCardError(null);
    try {
      const res = await fetch("/api/admin/task-cards");
      if (!res.ok) throw new Error("Failed");
      const cards: TaskCard[] = (await res.json()).map((c: any) => ({ ...c, corpusDocIds: Array.isArray(c.corpusDocIds) ? c.corpusDocIds : [] }));
      setTaskCards(cards);
      const drafts: Record<string, TaskCardDraft> = {};
      cards.forEach((c) => { drafts[c.id] = { title: c.title, description: c.description, displayOrder: c.displayOrder, taskChainPrompt: c.taskChainPrompt ?? "", corpusDocIds: [...c.corpusDocIds] }; });
      setTaskCardDrafts(drafts);
      setTaskCardsFetched(true);
    } catch { setTaskCardError("Failed to load task launcher cards."); }
    setTaskCardsLoading(false);
  }, []);

  const sortTaskCards = (cards: TaskCard[]) =>
    [...cards].sort((a, b) => a.displayOrder - b.displayOrder || a.title.localeCompare(b.title));

  const handleSaveTaskCard = async (id: string) => {
    const draft = taskCardDrafts[id];
    if (!draft) return;
    if (!draft.title.trim()) { setTaskCardError("Title cannot be empty."); return; }
    if (!Number.isInteger(draft.displayOrder) || draft.displayOrder < 1) {
      setTaskCardError("Display order must be a whole number of 1 or greater."); return;
    }
    setTaskCardSavingId(id); setTaskCardError(null);
    try {
      const trimmedChain = draft.taskChainPrompt.trim();
      const res = await fetch(`/api/admin/task-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          description: draft.description,
          displayOrder: draft.displayOrder,
          taskChainPrompt: trimmedChain.length > 0 ? trimmedChain : null,
          corpusDocIds: draft.corpusDocIds,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
      const updatedRaw: any = await res.json();
      const updated: TaskCard = { ...updatedRaw, corpusDocIds: Array.isArray(updatedRaw.corpusDocIds) ? updatedRaw.corpusDocIds : [] };
      setTaskCards((prev) => sortTaskCards(prev.map((c) => (c.id === id ? updated : c))));
      setTaskCardDrafts((prev) => ({ ...prev, [updated.id]: { title: updated.title, description: updated.description, displayOrder: updated.displayOrder, taskChainPrompt: updated.taskChainPrompt ?? "", corpusDocIds: [...updated.corpusDocIds] } }));
    } catch (err: any) {
      setTaskCardError(err?.message ?? "Save failed.");
    }
    setTaskCardSavingId(null);
  };

  const handleAddTaskCard = async () => {
    setTaskCardAdding(true); setTaskCardError(null);
    try {
      // Server assigns displayOrder = max(existing) + 1 in a single transaction,
      // so we don't send a client-computed order (avoids races on rapid clicks).
      const res = await fetch(`/api/admin/task-cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New card", description: "", taskChainPrompt: null, corpusDocIds: [] }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Add failed"); }
      const createdRaw: any = await res.json();
      const created: TaskCard = { ...createdRaw, corpusDocIds: Array.isArray(createdRaw.corpusDocIds) ? createdRaw.corpusDocIds : [] };
      setTaskCards((prev) => sortTaskCards([...prev, created]));
      setTaskCardDrafts((prev) => ({ ...prev, [created.id]: { title: created.title, description: created.description, displayOrder: created.displayOrder, taskChainPrompt: created.taskChainPrompt ?? "", corpusDocIds: [...created.corpusDocIds] } }));
    } catch (err: any) {
      setTaskCardError(err?.message ?? "Add failed.");
    }
    setTaskCardAdding(false);
  };

  const handleConfirmDeleteTaskCard = async () => {
    if (!deletingTaskCard || deleteTaskCardText !== "delete") return;
    const card = deletingTaskCard;
    setDeletingTaskCardSubmitting(true); setTaskCardError(null);
    try {
      const res = await fetch(`/api/admin/task-cards/${card.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Delete failed"); }
      setTaskCards((prev) => sortTaskCards(prev.filter((c) => c.id !== card.id)));
      setTaskCardDrafts((prev) => { const next = { ...prev }; delete next[card.id]; return next; });
      setDeletingTaskCard(null);
      setDeleteTaskCardText("");
    } catch (err: any) {
      setTaskCardError(err?.message ?? "Delete failed.");
    }
    setDeletingTaskCardSubmitting(false);
  };

  const fetchSP = useCallback(async () => {
    setSPLoading(true);
    try {
      const res = await fetch("/api/admin/system-prompt");
      if (!res.ok) throw new Error("Failed");
      const layers: SPLayer[] = await res.json();
      setSPLayers(layers);
      const drafts: Record<number, string> = {};
      layers.forEach((l) => { drafts[l.layer] = l.content; });
      setSPDraft(drafts); setSPFetched(true);
    } catch { /* silent */ }
    setSPLoading(false);
  }, []);

  const fetchRetrievalDebug = useCallback(async () => {
    setRetrievalDebugLoading(true); setRetrievalDebugError(null);
    try {
      const res = await fetch("/api/admin/retrieval-debug");
      if (!res.ok) throw new Error("Failed");
      setRetrievalDebug(await res.json());
      setRetrievalDebugFetched(true);
    } catch { setRetrievalDebugError("Failed to load retrieval debug log."); }
    setRetrievalDebugLoading(false);
  }, []);

  const fetchAdminConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/config");
      if (!res.ok) return;
      const cfg: AdminConfig = await res.json();
      setSupportEmailInput(cfg.supportEmail ?? "");
      setDebugLoggingEnabled(!!cfg.debugRetrievalLogging);
      setStats((prev) => prev ? { ...prev, supportEmail: cfg.supportEmail, debugRetrievalLogging: cfg.debugRetrievalLogging } : prev);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    if (activeTab === "settings") {
      if (!corpusFetched) fetchCorpus();
      if (!spFetched) fetchSP();
      if (!taskCardsFetched) fetchTaskCards();
      fetchAdminConfig();
      if (!retrievalDebugFetched) fetchRetrievalDebug();
    }
  }, [activeTab, corpusFetched, spFetched, taskCardsFetched, retrievalDebugFetched, fetchCorpus, fetchSP, fetchTaskCards, fetchAdminConfig, fetchRetrievalDebug]);

  const handleModelChange = async (model: string) => {
    if (!stats) return;
    setStats((prev) => prev ? { ...prev, activeModel: model } : prev);
    await fetch("/api/admin/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activeModel: model }) });
  };

  const handleThresholdSave = async () => {
    const val = parseFloat(thresholdInput);
    if (isNaN(val)) return;
    setSavingConfig(true);
    await fetch("/api/admin/config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spendThreshold: val }) });
    setStats((prev) => prev ? { ...prev, spendThreshold: val } : prev);
    setSavingConfig(false);
  };

  const handleDownloadBackup = async () => {
    setBackupLoading(true);
    setBackupError(null);
    try {
      const res = await fetch("/api/admin/backup", { headers: { "x-admin-auth": "authenticated" } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Backup failed" }));
        throw new Error(err.error || "Backup failed");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : "aiforrhhs-backup.sql";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setBackupError(err?.message ?? "Download failed. Please try again.");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, disabled } : u));
    await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled }) });
  };

  const handleGenerateUserReset = async (user: AdminUser) => {
    setResetUserLoadingId(user.id); setResetUserError(null); setResetUrlCopied(false);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/reset-password`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate reset link");
      setResetUserModal({ user, resetUrl: data.resetUrl, expiresAt: data.expiresAt });
    } catch (err: any) {
      setResetUserError(err?.message ?? "Failed to generate reset link.");
    }
    setResetUserLoadingId(null);
  };

  const handleCopyResetUrl = async () => {
    if (!resetUserModal) return;
    try {
      await navigator.clipboard.writeText(resetUserModal.resetUrl);
      setResetUrlCopied(true);
      setTimeout(() => setResetUrlCopied(false), 2000);
    } catch { /* silent */ }
  };

  const handleSaveSupportEmail = async () => {
    const trimmed = supportEmailInput.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
      setSupportEmailError("Please enter a valid email address."); return;
    }
    setSupportEmailSaving(true); setSupportEmailError(null);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supportEmail: trimmed }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Save failed"); }
      const cfg: AdminConfig = await res.json();
      setSupportEmailInput(cfg.supportEmail);
      setStats((prev) => prev ? { ...prev, supportEmail: cfg.supportEmail } : prev);
    } catch (err: any) {
      setSupportEmailError(err?.message ?? "Save failed.");
    }
    setSupportEmailSaving(false);
  };

  const handleToggleDebugLogging = async (enabled: boolean) => {
    setDebugLoggingSaving(true);
    const previous = debugLoggingEnabled;
    setDebugLoggingEnabled(enabled);
    try {
      const res = await fetch("/api/admin/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ debugRetrievalLogging: enabled }),
      });
      if (!res.ok) throw new Error("Failed");
      const cfg: AdminConfig = await res.json();
      setDebugLoggingEnabled(!!cfg.debugRetrievalLogging);
      setStats((prev) => prev ? { ...prev, debugRetrievalLogging: cfg.debugRetrievalLogging } : prev);
    } catch {
      setDebugLoggingEnabled(previous);
    }
    setDebugLoggingSaving(false);
  };

  const handleClearRetrievalDebug = async () => {
    if (!confirm("Clear all retrieval debug log entries? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/admin/retrieval-debug", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setRetrievalDebug([]);
    } catch {
      setRetrievalDebugError("Failed to clear log.");
    }
  };

  const handleRunTestRetrieval = async () => {
    const q = testRetrievalQuery.trim();
    if (!q) return;
    setTestRetrievalLoading(true); setTestRetrievalError(null); setTestRetrievalResults(null);
    try {
      const res = await fetch("/api/admin/corpus/test-retrieval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, k: testRetrievalK }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Test failed");
      setTestRetrievalResults(data.results);
    } catch (err: any) {
      setTestRetrievalError(err?.message ?? "Test failed.");
    }
    setTestRetrievalLoading(false);
  };

  /* ── Corpus handlers ── */
  const handleUploadDoc = async () => {
    if (!uploadFile || !uploadTitle.trim()) return;
    const docId = uploadDocId.trim() || uploadTitle.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    setCorpusOp(`Ingesting "${uploadTitle}"…`); setCorpusOpError(null);
    try {
      const content = await readFileAsText(uploadFile);
      const res = await fetch("/api/admin/corpus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ docId, title: uploadTitle, description: uploadDesc, category: uploadCategory, content }) });
      const data = await res.json();
      if (!res.ok) { setCorpusOpError(data.error || "Upload failed"); }
      else { setUploadFile(null); setUploadTitle(""); setUploadDesc(""); setUploadDocId(""); if (uploadInputRef.current) uploadInputRef.current.value = ""; await fetchCorpus(); }
    } catch { setCorpusOpError("Upload failed."); }
    setCorpusOp(null);
  };

  const handleReplaceDoc = async (file: File) => {
    if (!replacingDocId) return;
    const docId = replacingDocId; setReplacingDocId(null);
    setCorpusOp(`Re-ingesting "${docId}"…`); setCorpusOpError(null);
    try {
      const content = await readFileAsText(file);
      const res = await fetch(`/api/admin/corpus/${encodeURIComponent(docId)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (!res.ok) { const d = await res.json(); setCorpusOpError(d.error || "Replace failed"); }
      else { await fetchCorpus(); }
    } catch { setCorpusOpError("Replace failed."); }
    setCorpusOp(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingDoc || deleteText !== "delete") return;
    const doc = deletingDoc; setDeletingDoc(null); setDeleteText("");
    setCorpusOp(`Deleting "${doc.title}"…`); setCorpusOpError(null);
    try {
      const res = await fetch(`/api/admin/corpus/${encodeURIComponent(doc.docId)}`, { method: "DELETE" });
      if (res.status === 409) {
        // The doc is force-injected by one or more task launcher cards.
        // Surface the conflict so the admin can confirm before stripping the
        // docId from each card's pinned-context array.
        const data = await res.json().catch(() => ({}));
        const cards = Array.isArray(data.referencingCards) ? data.referencingCards : [];
        setCorpusDeleteConflict({ doc, cards });
      } else if (!res.ok) {
        throw new Error("Delete failed");
      } else {
        await fetchCorpus();
        await fetchTaskCards();
      }
    } catch { setCorpusOpError("Delete failed."); }
    setCorpusOp(null);
  };

  const handleForceDeleteCorpusDoc = async () => {
    if (!corpusDeleteConflict) return;
    const { doc } = corpusDeleteConflict;
    setCorpusDeleteForceSubmitting(true); setCorpusOpError(null);
    try {
      const res = await fetch(`/api/admin/corpus/${encodeURIComponent(doc.docId)}?force=true`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setCorpusDeleteConflict(null);
      await fetchCorpus();
      await fetchTaskCards();
    } catch { setCorpusOpError("Delete failed."); }
    setCorpusDeleteForceSubmitting(false);
  };

  const handleViewDoc = async (doc: CorpusDocMeta) => {
    setViewLoading(true);
    try {
      const res = await fetch(`/api/admin/corpus/${encodeURIComponent(doc.docId)}/content`);
      const data = await res.json();
      setViewModal({ docId: doc.docId, title: doc.title, content: data.content });
    } catch { setCorpusOpError("Failed to load document content."); }
    setViewLoading(false);
  };

  /* ── System prompt handlers ── */
  const currentSpLayer = spLayers.find((l) => l.layer === activeSpLayer);
  const currentDraft = spDraft[activeSpLayer] ?? currentSpLayer?.content ?? "";
  const isDirty = currentDraft !== (currentSpLayer?.content ?? "");

  const handleSPSave = () => {
    if (!currentSpLayer) return;
    setPendingDiff({ layer: activeSpLayer, old: currentSpLayer.content, next: currentDraft });
    setConfirmText(""); setShowDiff(true);
  };

  const handleSPConfirmSave = async () => {
    if (!pendingDiff || confirmText !== "confirm") return;
    setSPSaving(true);
    try {
      const res = await fetch(`/api/admin/system-prompt/${pendingDiff.layer}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: pendingDiff.next }) });
      if (res.ok) {
        const updated: SPLayer = await res.json();
        setSPLayers((prev) => prev.map((l) => l.layer === updated.layer ? updated : l));
        setSPDraft((prev) => ({ ...prev, [updated.layer]: updated.content }));
      }
    } catch { /* silent */ }
    setShowDiff(false); setPendingDiff(null); setConfirmText(""); setSPSaving(false);
  };

  const handleSPRevert = async () => {
    if (!currentSpLayer?.previousContent) return;
    const prev = currentSpLayer.previousContent;
    setSPDraft((d) => ({ ...d, [activeSpLayer]: prev }));
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const handleFeedbackSort = (field: string) => {
    if (feedbackSortField === field) setFeedbackSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setFeedbackSortField(field); setFeedbackSortDir("asc"); }
  };

  const sortedFeedback = [...feedback].sort((a: any, b: any) => {
    let av = a[feedbackSortField], bv = b[feedbackSortField];
    if (av == null) av = ""; if (bv == null) bv = "";
    if (av < bv) return feedbackSortDir === "asc" ? -1 : 1;
    if (av > bv) return feedbackSortDir === "asc" ? 1 : -1;
    return 0;
  });

  const handleInquirySort = (field: string) => {
    if (inquirySortField === field) setInquirySortDir((d) => d === "asc" ? "desc" : "asc");
    else { setInquirySortField(field); setInquirySortDir("asc"); }
  };
  const sortedInquiries = [...inquiries].sort((a: any, b: any) => {
    let av = a[inquirySortField], bv = b[inquirySortField];
    if (av == null) av = ""; if (bv == null) bv = "";
    if (av < bv) return inquirySortDir === "asc" ? -1 : 1;
    if (av > bv) return inquirySortDir === "asc" ? 1 : -1;
    return 0;
  });
  const uploadIssues = sortedFeedback.filter((f) => f.feedbackType === "file_upload_error");

  const counties = [...new Set(users.map((u) => u.county))].sort();
  const categories = [...new Set(users.map((u) => u.serviceCategory))].sort();
  const filteredUsers = users.filter((u) => {
    if (searchEmail && !u.email.toLowerCase().includes(searchEmail.toLowerCase())) return false;
    if (filterCounty && u.county !== filterCounty) return false;
    if (filterCategory && u.serviceCategory !== filterCategory) return false;
    return true;
  });
  const sortedUsers = sortField ? [...filteredUsers].sort((a: any, b: any) => {
    let av = a[sortField], bv = b[sortField];
    if (sortField === "domain") { av = getDomain(a.email); bv = getDomain(b.email); }
    if (sortField === "match") { av = a.domainMatch ? 1 : 0; bv = b.domainMatch ? 1 : 0; }
    if (sortField === "status") { av = a.disabled ? 1 : 0; bv = b.disabled ? 1 : 0; }
    if (av == null) av = ""; if (bv == null) bv = "";
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }) : filteredUsers;

  const filteredCorpus = corpusDocs.filter((d) => {
    if (!corpusFilter) return true;
    const q = corpusFilter.toLowerCase();
    return d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q);
  });

  const unmatchedUsers = users.filter((u) => !u.domainMatch);

  if (loading) return <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color="#C8963E" size={36} /><GlobalStyles /></div>;
  if (error || !stats) return <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}><div style={{ textAlign: "center" }}><p style={{ color: "#DC2626", marginBottom: 14 }}>{error ?? "Unknown error"}</p><button onClick={fetchAll} style={btnStyle("#1A2744")}>Retry</button></div></div>;

  const totalRatings = stats.thumbsUpCount + stats.thumbsDownCount;
  const upPct = totalRatings > 0 ? Math.round((stats.thumbsUpCount / totalRatings) * 100) : 0;
  const maxTask = Math.max(...stats.taskLauncherUsage.map((t) => t.count), 1);
  const TABS: { id: AdminTab; label: string }[] = [{ id: "inbox", label: "Inbox" }, { id: "dashboard", label: "Dashboard" }, { id: "users", label: "Users" }, { id: "settings", label: "Settings" }];
  const TH = ({ label, field }: { label: string; field?: string }) => (
    <th onClick={field ? () => handleSort(field) : undefined} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", cursor: field ? "pointer" : "default", userSelect: "none", background: "#FAFAFA" }}>
      {label}{field && <span style={{ marginLeft: 4, color: sortField === field ? "#C8963E" : "#9CA3AF", fontSize: 11 }}>{sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}</span>}
    </th>
  );
  const TD = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151", borderBottom: "1px solid #F3F4F6", verticalAlign: "middle", ...style }}>{children}</td>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#F5F5F5", fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column" }}>
      <GlobalStyles />

      {/* HEADER */}
      <header style={{ background: "#1A2744", padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#C8963E", fontWeight: 700 }}>AI for HHS</span>
          <span style={{ fontSize: 13, color: "#9CA3AF" }}>Admin Dashboard</span>
        </div>
        <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#D1D5DB", borderRadius: 6, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Sign Out</button>
      </header>

      {/* TAB BAR */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", padding: "0 24px", flexShrink: 0 }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ background: "none", border: "none", padding: "14px 20px", fontSize: 14, fontWeight: activeTab === tab.id ? 600 : 400, color: activeTab === tab.id ? "#C8963E" : "#6B7280", cursor: "pointer", borderBottom: activeTab === tab.id ? "2px solid #C8963E" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", marginBottom: -1 }}>{tab.label}</button>
        ))}
      </div>

      <main style={{ flex: 1, maxWidth: 1280, width: "100%", margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── DASHBOARD TAB ── */}
        {activeTab === "dashboard" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
              <StatCard title="Total Users" value={stats.totalUsers} />
              <StatCard title="New This Month" value={stats.newThisMonth} />
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Weekly Active</div>
                <div style={bigNumStyle}>{stats.weeklyActive}</div>
                <div style={subStyle}>unique users, last 7 days</div>
                <div style={{ marginTop: 10 }}><Sparkline data={trends?.weeklyActive ?? []} /></div>
              </div>
              <div style={{ background: "#FEF2F2", border: "1.5px solid #DC2626", borderRadius: 10, padding: "20px 24px" }}>
                <div style={cardTitleStyle}>Unmatched Domains This Week</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: "#DC2626", lineHeight: 1 }}>{stats.unmatchedDomainsThisWeek}</div>
                <div style={{ fontSize: 12, color: "#DC2626", marginTop: 5, opacity: 0.75 }}>new registrations, no domain match</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
              <div style={cardStyle}><div style={cardTitleStyle}>Returning vs. One-Time</div><div style={bigNumStyle}>{stats.returningUsers} <span style={{ fontSize: 16, color: "#6B7280", fontWeight: 400 }}>/ {stats.oneTimeUsers}</span></div><div style={subStyle}>returning / one-time</div></div>
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Total Conversations</div>
                <div style={bigNumStyle}>{stats.totalConversations}</div>
                <div style={{ marginTop: 10 }}><Sparkline data={trends?.weeklyConversations ?? []} /></div>
              </div>
              <StatCard title="Avg Messages / Conversation" value={stats.avgMessagesPerConversation.toFixed(1)} />
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Thumbs Up / Down</div>
                <div style={bigNumStyle}>{upPct}%<span style={{ fontSize: 15, fontWeight: 400, color: "#6B7280" }}> up</span></div>
                <div style={subStyle}>{stats.thumbsUpCount} up / {stats.thumbsDownCount} down</div>
                <div style={{ marginTop: 10 }}><Sparkline data={trends?.weeklyThumbsUpPct ?? []} /></div>
              </div>
            </div>
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
              <div><div style={cardTitleStyle}>Est. Cost This Month</div><div style={{ fontSize: 34, fontWeight: 700, color: "#111827" }}>${stats.currentMonthSpend.toFixed(2)}</div></div>
              <div style={{ color: "#9CA3AF", fontSize: 13 }}>{stats.currentMonthTokens.toLocaleString()} tokens</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Users by County</div>
                <div style={{ overflowY: "auto", maxHeight: 300 }}>
                  {stats.usersByCounty.length === 0 ? <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>No data yet</p> : stats.usersByCounty.map((c, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                      <span style={{ color: "#374151" }}>{c.label}</span>
                      <span style={{ fontWeight: 700, color: "#1A2744", marginLeft: 12 }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Users by Service Category</div>
                <div style={{ overflowY: "auto", maxHeight: 300 }}>
                  {stats.usersByServiceCategory.length === 0 ? <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>No data yet</p> : stats.usersByServiceCategory.map((c, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                      <span style={{ color: "#374151" }}>{c.label}</span>
                      <span style={{ fontWeight: 700, color: "#1A2744", marginLeft: 12 }}>{c.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Task Launcher Ranking</div>
              {stats.taskLauncherUsage.length === 0 ? <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>No task launcher taps yet.</p> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {stats.taskLauncherUsage.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", width: 20, textAlign: "right", flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ fontSize: 13, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                      <div style={{ width: 200, flexShrink: 0, height: 10, background: "#F3F4F6", borderRadius: 5 }}><div style={{ height: "100%", width: `${Math.round((t.count / maxTask) * 100)}%`, background: "#C8963E", borderRadius: 5 }} /></div>
                      <span style={{ fontSize: 13, fontWeight: 600, width: 28, textAlign: "right", flexShrink: 0, color: "#111827" }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1.5px solid #DC2626", overflow: "hidden" }}>
              <div style={{ padding: "14px 24px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #FEE2E2" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Total: {unmatchedUsers.length} — users registered without a recognized domain</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={tblStyle}>
                  <thead><tr>{["Email","Domain","County","Service Category","Registered","Connection Explanation"].map((h) => <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA" }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {unmatchedUsers.map((u) => <tr key={u.id}><TD>{u.email}</TD><TD><span style={{ fontFamily: "monospace", fontSize: 12 }}>{getDomain(u.email)}</span></TD><TD>{u.county}</TD><TD>{u.serviceCategory}</TD><TD style={{ whiteSpace: "nowrap" }}>{fmt(u.createdAt)}</TD><TD style={{ color: u.domainNote ? "#374151" : "#9CA3AF", fontStyle: u.domainNote ? "normal" : "italic" }}>{u.domainNote || "—"}</TD></tr>)}
                    {unmatchedUsers.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No unmatched domain registrations</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── USERS TAB ── */}
        {activeTab === "users" && (
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div style={sectionTitleStyle}>{filteredUsers.length < users.length ? `Showing ${filteredUsers.length} of ${users.length} users` : `Total Users: ${users.length}`}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <input type="text" placeholder="Search by email…" value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} style={inputStyle(200)} />
                <select value={filterCounty} onChange={(e) => setFilterCounty(e.target.value)} style={selectStyle}><option value="">All Counties</option>{counties.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={selectStyle}><option value="">All Categories</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}</select>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={tblStyle}>
                <thead><tr><TH label="Email" field="email" /><TH label="Domain" field="domain" /><TH label="County" field="county" /><TH label="Service Category" field="serviceCategory" /><TH label="Registered" field="createdAt" /><TH label="Last Active" field="lastActive" /><TH label="Conversations" field="conversationCount" /><TH label="Match" field="match" /><TH label="Status" field="status" /><th style={{ padding: "10px 14px", fontSize: 11, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA" }}>Actions</th></tr></thead>
                <tbody>
                  {sortedUsers.map((u) => (
                    <tr key={u.id} style={{ background: u.disabled ? "#FEF2F2" : "transparent" }}>
                      <TD style={{ fontWeight: 500, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</TD>
                      <TD><span style={{ fontFamily: "monospace", fontSize: 12 }}>{getDomain(u.email)}</span></TD>
                      <TD>{u.county}</TD>
                      <TD style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.serviceCategory}</TD>
                      <TD style={{ whiteSpace: "nowrap" }}>{fmt(u.createdAt)}</TD>
                      <TD style={{ whiteSpace: "nowrap" }}>{fmtShort(u.lastActive)}</TD>
                      <TD style={{ textAlign: "center" }}>{u.conversationCount}</TD>
                      <TD>{u.domainMatch ? <span style={{ background: "#D1FAE5", color: "#065F46", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>Yes</span> : <span style={{ background: "#FEE2E2", color: "#991B1B", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>No</span>}</TD>
                      <TD><ToggleSwitch enabled={!u.disabled} onChange={(v) => handleToggleDisabled(u.id, !v)} /></TD>
                      <TD>
                        <button
                          onClick={() => handleGenerateUserReset(u)}
                          disabled={resetUserLoadingId === u.id}
                          style={smallBtn("#1A2744")}
                          data-testid={`btn-reset-password-${u.id}`}
                        >
                          {resetUserLoadingId === u.id ? "…" : "Reset password"}
                        </button>
                      </TD>
                    </tr>
                  ))}
                  {sortedUsers.length === 0 && <tr><td colSpan={10} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No users match your filters</td></tr>}
                </tbody>
              </table>
            </div>
            {resetUserError && <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF2F2", color: "#DC2626", borderRadius: 6, fontSize: 13 }}>{resetUserError}</div>}
          </div>
        )}

        {/* Reset password URL modal */}
        {resetUserModal && (
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
            onClick={() => setResetUserModal(null)}
          >
            <div
              style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 560, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
              onClick={(e) => e.stopPropagation()}
              data-testid="reset-user-modal"
            >
              <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#1A2744", margin: "0 0 10px" }}>Password reset link</h3>
              <p style={{ fontSize: 13, color: "#4B5563", margin: "0 0 14px", lineHeight: 1.55 }}>
                Share this single-use link with <strong>{resetUserModal.user.email}</strong>. It expires {new Date(resetUserModal.expiresAt).toLocaleString()}.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  type="text"
                  readOnly
                  value={resetUserModal.resetUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  style={{ ...inputStyle("100%"), padding: "9px 12px", fontFamily: "monospace", fontSize: 12 }}
                  data-testid="input-reset-url"
                />
                <button
                  onClick={handleCopyResetUrl}
                  style={btnStyle(resetUrlCopied ? "#16A34A" : "#1A2744")}
                  data-testid="btn-copy-reset-url"
                >
                  {resetUrlCopied ? "Copied!" : "Copy"}
                </button>
              </div>
              <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, fontSize: 12, color: "#92400E", marginBottom: 16, lineHeight: 1.5 }}>
                Anyone with this link can set a new password for this account. Send it through a secure channel and don't share it publicly.
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={() => setResetUserModal(null)} style={btnStyle("#6B7280")} data-testid="btn-close-reset-modal">Close</button>
              </div>
            </div>
          </div>
        )}

        {/* ── INBOX TAB ── */}
        {activeTab === "inbox" && (
          <>
            {/* Inquiries section */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Inquiries</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>Get in Touch submissions · {sortedInquiries.length} total</div>
              {sortedInquiries.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>No inquiries yet.</p>
              ) : (
                <div style={{ border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
                  {/* Sortable header row */}
                  <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", background: "#FAFAFA", borderBottom: "1px solid #E5E7EB" }}>
                    {[{ label: "Date", field: "createdAt" }, { label: "Type", field: "inquiryType" }, { label: "Email", field: "userEmail" }, { label: "Domain", field: "domain" }].map(({ label, field }) => (
                      <div key={field} onClick={() => handleInquirySort(field)} style={{ padding: "9px 14px", fontSize: 11, fontWeight: 600, color: "#6B7280", cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 4 }}>
                        {label}
                        <span style={{ color: inquirySortField === field ? "#C8963E" : "#9CA3AF", fontSize: 10 }}>{inquirySortField === field ? (inquirySortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
                      </div>
                    ))}
                  </div>
                  {sortedInquiries.map((inq) => {
                    const badgeMap: Record<string, { bg: string; text: string; label: string }> = {
                      "AI training for my team": { bg: "#DCFCE7", text: "#166534", label: "Training" },
                      "Help with a specific project": { bg: "#DCFCE7", text: "#166534", label: "Project" },
                      "Share feedback about the tool": { bg: "#F1EFE8", text: "#5F5E5A", label: "Feedback" },
                      "Something else": { bg: "#FAEEDA", text: "#633806", label: "Other" },
                    };
                    const badge = badgeMap[inq.inquiryType] ?? { bg: "#F3F4F6", text: "#374151", label: inq.inquiryType };
                    const showPreferredEmail = inq.preferredEmail && inq.preferredEmail.toLowerCase() !== inq.userEmail.toLowerCase();
                    return (
                      <div key={inq.id} style={{ borderBottom: "1px solid #F3F4F6" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", padding: "10px 14px 4px", alignItems: "center" }}>
                          <span style={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap" }}>{fmtShort(inq.createdAt)}</span>
                          <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: badge.bg, color: badge.text, justifySelf: "start" }}>{badge.label}</span>
                          <span style={{ fontSize: 13, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{inq.userEmail}</span>
                          <span style={{ fontSize: 12, color: "#6B7280", fontFamily: "monospace" }}>{inq.domain}</span>
                        </div>
                        <div style={{ padding: "0 14px 10px 134px" }}>
                          <p style={{ margin: 0, fontSize: 13, color: "#6B7280", lineHeight: 1.55 }}>{inq.message}</p>
                          {showPreferredEmail && <p style={{ margin: "4px 0 0", fontSize: 12, color: "#C8963E" }}>Preferred email: {inq.preferredEmail}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Upload issues section */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Upload issues</div>
              <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>Attempted file uploads that exceeded the size limit · {uploadIssues.length} total</div>
              {uploadIssues.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>No upload issues yet.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={tblStyle}>
                    <thead>
                      <tr>
                        {[{ label: "Date", field: "createdAt" }, { label: "Email", field: "userEmail" }, { label: "Domain", field: "domain" }, { label: "What they were trying to do", field: "detail" }, { label: "File Size", field: "attemptedFileSize" }].map(({ label, field }) => (
                          <th key={field} onClick={() => handleFeedbackSort(field)} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA", cursor: "pointer", userSelect: "none" }}>
                            {label}<span style={{ marginLeft: 4, color: feedbackSortField === field ? "#C8963E" : "#9CA3AF", fontSize: 11 }}>{feedbackSortField === field ? (feedbackSortDir === "asc" ? "▲" : "▼") : "⇅"}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadIssues.map((f) => (
                        <tr key={f.id}>
                          <TD style={{ whiteSpace: "nowrap" }}>{fmt(f.createdAt)}</TD>
                          <TD style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.userEmail}</TD>
                          <TD><span style={{ fontFamily: "monospace", fontSize: 12 }}>{f.domain || "—"}</span></TD>
                          <TD style={{ color: f.detail ? "#374151" : "#9CA3AF", fontStyle: f.detail ? "normal" : "italic" }}>{f.detail || "—"}</TD>
                          <TD style={{ whiteSpace: "nowrap" }}>{f.attemptedFileSize ? `${(f.attemptedFileSize / 1024 / 1024).toFixed(1)} MB` : "—"}</TD>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── SETTINGS TAB ── */}
        {activeTab === "settings" && (
          <>
            {/* 1. Model Controls */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Model Controls</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 32 }}>
                <div>
                  <label style={labelStyle}>Active Model</label>
                  <select value={stats.activeModel} onChange={(e) => handleModelChange(e.target.value)} style={{ ...selectStyle, fontSize: 14, padding: "9px 36px 9px 12px" }}>
                    {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <div style={hintStyle}>Applies to all new conversations</div>
                </div>
                <div>
                  <label style={labelStyle}>Auto-Downgrade Threshold</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "#6B7280" }}>$</span>
                    <input type="number" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} style={{ ...inputStyle(90), padding: "8px 10px" }} />
                    <span style={{ fontSize: 13, color: "#6B7280" }}>/ month</span>
                    <button onClick={handleThresholdSave} disabled={savingConfig} style={btnStyle("#1A2744", savingConfig)}>{savingConfig ? "Saving…" : "Save"}</button>
                  </div>
                  <div style={hintStyle}>Downgrades to Sonnet when exceeded, resets on 1st of month</div>
                </div>
                <div style={{ minWidth: 280 }}>
                  <label style={labelStyle}>Support Contact Email</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="email"
                      value={supportEmailInput}
                      onChange={(e) => { setSupportEmailInput(e.target.value); setSupportEmailError(null); }}
                      placeholder="anthony@iqmeeteq.com"
                      style={{ ...inputStyle(240), padding: "8px 10px" }}
                      data-testid="input-support-email"
                    />
                    <button
                      onClick={handleSaveSupportEmail}
                      disabled={supportEmailSaving}
                      style={btnStyle("#1A2744", supportEmailSaving)}
                      data-testid="btn-save-support-email"
                    >
                      {supportEmailSaving ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <div style={hintStyle}>Used in lockout messages, error notices, and the "Get in Touch" form</div>
                  {supportEmailError && <div style={{ marginTop: 6, fontSize: 12, color: "#DC2626" }}>{supportEmailError}</div>}
                </div>
              </div>
            </div>

            {/* 2. Corpus Documents */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Corpus Documents</div>
              <p style={{ fontSize: 13, color: "#6B7280", margin: "-8px 0 20px" }}>Documents in the RAG corpus inform the chatbot's responses. Upload markdown files to add knowledge — methodology frameworks, task chains, prompt libraries, and workflows.</p>

              {corpusOp && <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#EFF6FF", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#1D4ED8" }}><Spinner color="#1D4ED8" size={16} />{corpusOp}</div>}
              {corpusOpError && <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#DC2626" }}>{corpusOpError}</div>}

              {/* Upload form */}
              <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "16px 20px", marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 14 }}>Upload New Document</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                  <div><label style={labelStyle}>Title *</label><input type="text" value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} placeholder="e.g. RICECO Framework" style={{ ...inputStyle(200), padding: "8px 10px" }} /></div>
                  <div><label style={labelStyle}>Description</label><input type="text" value={uploadDesc} onChange={(e) => setUploadDesc(e.target.value)} placeholder="Brief description" style={{ ...inputStyle(240), padding: "8px 10px" }} /></div>
                  <div>
                    <label style={labelStyle}>Category</label>
                    <select value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} style={selectStyle}>
                      {CORPUS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>File (.md or .txt)</label>
                    <input ref={uploadInputRef} type="file" accept=".md,.txt" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setUploadFile(f); if (!uploadDocId) setUploadDocId(f.name.replace(/\.(md|txt)$/i, "").replace(/\s+/g, "-").toLowerCase()); }} />
                    <button type="button" onClick={() => uploadInputRef.current?.click()} style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 14px", fontSize: 13, background: "#fff", color: "#374151", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Choose File</button>
                  </div>
                  <button onClick={handleUploadDoc} disabled={!uploadFile || !uploadTitle.trim() || !!corpusOp} style={btnStyle("#1A2744", !uploadFile || !uploadTitle.trim() || !!corpusOp)}>Upload &amp; Ingest</button>
                </div>
                {uploadFile && <div style={{ marginTop: 10, fontSize: 12, color: "#6B7280" }}><strong>{uploadFile.name}</strong> · {(uploadFile.size / 1024).toFixed(1)} KB</div>}
              </div>

              {/* Search */}
              <div style={{ marginBottom: 14 }}>
                <input type="text" value={corpusFilter} onChange={(e) => setCorpusFilter(e.target.value)} placeholder="Search by title or description…" style={{ ...inputStyle(300), padding: "8px 12px" }} />
              </div>

              {/* Document list */}
              {corpusLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B7280", fontSize: 13, padding: 16 }}><Spinner size={16} color="#9CA3AF" /> Loading…</div>
              ) : filteredCorpus.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0, padding: "12px 0" }}>{corpusDocs.length === 0 ? "No documents in corpus yet." : "No documents match your search."}</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {filteredCorpus.map((doc) => {
                    const catColor = CATEGORY_COLORS[doc.category] ?? { bg: "#F3F4F6", text: "#374151" };
                    const isDeleting = deletingDoc?.docId === doc.docId;
                    return (
                      <div key={doc.docId}>
                        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 4px", borderBottom: "1px solid #F3F4F6" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{doc.title}</span>
                              <span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: catColor.bg, color: catColor.text }}>{doc.category}</span>
                            </div>
                            {doc.description && <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>{doc.description}</div>}
                            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3 }}>{doc.chunkCount} chunks · uploaded {fmt(doc.createdAt)}</div>
                          </div>
                          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                            <button onClick={() => handleViewDoc(doc)} disabled={!!corpusOp || viewLoading} style={smallBtn("#6B7280")}>View</button>
                            <button onClick={() => { setReplacingDocId(doc.docId); replaceInputRef.current?.click(); }} disabled={!!corpusOp} style={smallBtn("#1A2744")}>Replace</button>
                            <button onClick={() => { setDeletingDoc(doc); setDeleteText(""); }} disabled={!!corpusOp} style={smallBtn("#DC2626")}>Delete</button>
                          </div>
                        </div>
                        {isDeleting && (
                          <div style={{ margin: "0 0 8px 0", padding: "14px 16px", background: "#FFF7F7", border: "1px solid #FECACA", borderRadius: 8 }}>
                            <p style={{ fontSize: 13, color: "#374151", margin: "0 0 10px", lineHeight: 1.5 }}>
                              Delete <strong>"{doc.title}"</strong>? This removes the document and all its chunks from the chatbot's knowledge. This cannot be undone.
                            </p>
                            <label style={{ fontSize: 12, color: "#6B7280", fontWeight: 500 }}>Type <code style={{ background: "#FEE2E2", padding: "1px 4px", borderRadius: 3 }}>delete</code> to confirm:</label>
                            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                              <input type="text" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="delete" style={{ ...inputStyle(120), padding: "7px 10px" }} />
                              <button onClick={handleConfirmDelete} disabled={deleteText !== "delete"} style={btnStyle("#DC2626", deleteText !== "delete")}>Confirm</button>
                              <button onClick={() => { setDeletingDoc(null); setDeleteText(""); }} style={btnStyle("#6B7280")}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {corpusDeleteConflict && (
                <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ background: "#fff", borderRadius: 10, padding: "20px 22px", maxWidth: 520, width: "92%", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }} data-testid="modal-corpus-delete-conflict">
                    <h3 style={{ margin: "0 0 8px", fontSize: 17, color: "#1A2744" }}>Document is pinned to task launcher cards</h3>
                    <p style={{ fontSize: 13, color: "#374151", margin: "0 0 10px", lineHeight: 1.5 }}>
                      <strong>"{corpusDeleteConflict.doc.title}"</strong> is force-injected by the following card{corpusDeleteConflict.cards.length === 1 ? "" : "s"}. Deleting it will remove the document and unpin it from each card's force-injected list.
                    </p>
                    <ul style={{ margin: "0 0 14px 18px", padding: 0, fontSize: 13, color: "#111827" }}>
                      {corpusDeleteConflict.cards.map((c) => (
                        <li key={c.id} style={{ marginBottom: 4 }}>{c.title}</li>
                      ))}
                    </ul>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button onClick={() => setCorpusDeleteConflict(null)} disabled={corpusDeleteForceSubmitting} style={btnStyle("#6B7280", corpusDeleteForceSubmitting)} data-testid="btn-cancel-force-delete">Cancel</button>
                      <button onClick={handleForceDeleteCorpusDoc} disabled={corpusDeleteForceSubmitting} style={btnStyle("#DC2626", corpusDeleteForceSubmitting)} data-testid="btn-confirm-force-delete">
                        {corpusDeleteForceSubmitting ? "Deleting…" : "Delete & unpin"}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <input ref={replaceInputRef} type="file" accept=".md,.txt" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReplaceDoc(f); if (replaceInputRef.current) replaceInputRef.current.value = ""; }} />

              {/* Test retrieval */}
              <div style={{ marginTop: 24, padding: "16px 18px", background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#0C4A6E", marginBottom: 10 }}>Test Retrieval</div>
                <p style={{ fontSize: 12, color: "#0369A1", margin: "0 0 12px", lineHeight: 1.5 }}>Run a sample query against the corpus to see which chunks would be retrieved (no chat conversation involved). Useful for tuning content and debugging coverage.</p>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 240 }}>
                    <label style={{ ...labelStyle, color: "#0C4A6E" }}>Query</label>
                    <input
                      type="text"
                      value={testRetrievalQuery}
                      onChange={(e) => setTestRetrievalQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !testRetrievalLoading) handleRunTestRetrieval(); }}
                      placeholder="e.g. How do I run a 1:1 with a struggling supervisor?"
                      style={{ ...inputStyle("100%"), padding: "8px 10px" }}
                      data-testid="input-test-retrieval-query"
                    />
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={{ ...labelStyle, color: "#0C4A6E" }}>Top K</label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={testRetrievalK}
                      onChange={(e) => setTestRetrievalK(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 5)))}
                      style={{ ...inputStyle("100%"), padding: "8px 10px" }}
                      data-testid="input-test-retrieval-k"
                    />
                  </div>
                  <button
                    onClick={handleRunTestRetrieval}
                    disabled={testRetrievalLoading || !testRetrievalQuery.trim()}
                    style={btnStyle("#0369A1", testRetrievalLoading || !testRetrievalQuery.trim())}
                    data-testid="btn-test-retrieval"
                  >
                    {testRetrievalLoading ? "Running…" : "Run test"}
                  </button>
                </div>
                {testRetrievalError && <div style={{ marginTop: 10, padding: "8px 12px", background: "#FEF2F2", color: "#DC2626", borderRadius: 6, fontSize: 12 }}>{testRetrievalError}</div>}
                {testRetrievalResults && (
                  <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }} data-testid="test-retrieval-results">
                    {testRetrievalResults.length === 0 ? (
                      <div style={{ fontSize: 13, color: "#6B7280", fontStyle: "italic" }}>No matching chunks.</div>
                    ) : testRetrievalResults.map((r, i) => (
                      <div key={i} style={{ background: "#fff", border: "1px solid #E0F2FE", borderRadius: 6, padding: "10px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "#0C4A6E" }}>{r.title} <span style={{ fontSize: 11, fontFamily: "monospace", color: "#9CA3AF", fontWeight: 400 }}>· {r.docId}</span></div>
                          <div style={{ fontSize: 12, fontFamily: "monospace", color: "#0369A1", whiteSpace: "nowrap" }}>score: {r.score.toFixed(4)}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.preview}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 3. Task Launcher Cards */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div style={sectionTitleStyle}>Task Launcher Cards</div>
                <button
                  onClick={handleAddTaskCard}
                  disabled={taskCardAdding}
                  style={btnStyle("#C8963E", taskCardAdding)}
                  data-testid="btn-add-task-card"
                >
                  {taskCardAdding ? "Adding…" : "+ Add card"}
                </button>
              </div>
              <p style={{ fontSize: 13, color: "#6B7280", margin: "-8px 0 20px", lineHeight: 1.6 }}>
                These are the task suggestion cards shown to users at the start of every new conversation. Edit the title, subtitle, or grid position. Lower display order numbers appear first (1 = top-left). Only the eight cards with the lowest display order are shown to users; any extras are hidden in the chat but still editable here. Changes take effect on the next page load for users.
              </p>

              {taskCardError && (
                <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#DC2626" }}>{taskCardError}</div>
              )}

              {taskCardsLoading && !taskCardsFetched ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B7280", fontSize: 13 }}><Spinner size={16} color="#9CA3AF" /> Loading…</div>
              ) : taskCards.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>No task launcher cards yet. Click "Add card" to create the first one.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {taskCards.map((card, idx) => {
                    const draft = taskCardDrafts[card.id] ?? { title: card.title, description: card.description, displayOrder: card.displayOrder, taskChainPrompt: card.taskChainPrompt ?? "", corpusDocIds: [...card.corpusDocIds] };
                    const savedChain = card.taskChainPrompt ?? "";
                    const savedDocIds = [...card.corpusDocIds].sort();
                    const draftDocIds = [...draft.corpusDocIds].sort();
                    const docIdsDirty = savedDocIds.length !== draftDocIds.length || savedDocIds.some((d, i) => d !== draftDocIds[i]);
                    const isDirty = draft.title !== card.title || draft.description !== card.description || draft.displayOrder !== card.displayOrder || draft.taskChainPrompt !== savedChain || docIdsDirty;
                    const isSaving = taskCardSavingId === card.id;
                    const isHiddenFromChat = idx >= 8;
                    return (
                      <div key={card.id} style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "14px 18px" }} data-testid={`task-card-row-${card.id}`}>
                        {isHiddenFromChat && (
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#92400E", background: "#FEF3C7", padding: "2px 8px", borderRadius: 4, marginBottom: 8, display: "inline-block" }}>
                            Hidden from chat (only the 8 lowest display orders are shown)
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 110px", gap: 12, alignItems: "flex-end" }}>
                          <div>
                            <label style={labelStyle}>Title</label>
                            <input
                              type="text"
                              value={draft.title}
                              onChange={(e) => setTaskCardDrafts((prev) => ({ ...prev, [card.id]: { ...draft, title: e.target.value } }))}
                              style={{ ...inputStyle("100%"), padding: "8px 10px" }}
                              data-testid={`input-task-title-${card.id}`}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Description</label>
                            <input
                              type="text"
                              value={draft.description}
                              onChange={(e) => setTaskCardDrafts((prev) => ({ ...prev, [card.id]: { ...draft, description: e.target.value } }))}
                              style={{ ...inputStyle("100%"), padding: "8px 10px" }}
                              data-testid={`input-task-desc-${card.id}`}
                            />
                          </div>
                          <div>
                            <label style={labelStyle}>Display Order</label>
                            <input
                              type="number"
                              min={1}
                              value={draft.displayOrder}
                              onChange={(e) => setTaskCardDrafts((prev) => ({ ...prev, [card.id]: { ...draft, displayOrder: parseInt(e.target.value, 10) || 1 } }))}
                              style={{ ...inputStyle("100%"), padding: "8px 10px" }}
                              data-testid={`input-task-order-${card.id}`}
                            />
                          </div>
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <label style={labelStyle}>Task chain prompt <span style={{ fontWeight: 400, color: "#9CA3AF" }}>(optional — appended to system prompt when this card is selected)</span></label>
                          <textarea
                            value={draft.taskChainPrompt}
                            onChange={(e) => setTaskCardDrafts((prev) => ({ ...prev, [card.id]: { ...draft, taskChainPrompt: e.target.value } }))}
                            placeholder="e.g. Walk the user through drafting the email step-by-step. Start by asking who it's for and what tone they want."
                            style={{ width: "100%", minHeight: 90, border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 10px", fontSize: 13, color: "#111827", fontFamily: "monospace", lineHeight: 1.5, resize: "vertical", boxSizing: "border-box", outline: "none" }}
                            data-testid={`input-task-chain-${card.id}`}
                          />
                        </div>
                        <div style={{ marginTop: 12 }}>
                          <label style={labelStyle}>Force-injected corpus documents <span style={{ fontWeight: 400, color: "#9CA3AF" }}>(optional — these documents are guaranteed in context when this card is used; RAG search excludes them)</span></label>
                          {!corpusFetched ? (
                            <p style={{ fontSize: 12, color: "#9CA3AF", margin: "4px 0 0" }}>Open the Corpus Documents section above to load the document list.</p>
                          ) : (
                            <div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4, marginBottom: 6 }}>
                                {draft.corpusDocIds.length === 0 ? (
                                  <span style={{ fontSize: 12, color: "#9CA3AF" }}>None pinned — only similarity-retrieved chunks will appear in context.</span>
                                ) : (
                                  draft.corpusDocIds.map((docId) => {
                                    const meta = corpusDocs.find((d) => d.docId === docId);
                                    const label = meta?.title ?? docId;
                                    return (
                                      <span key={docId} style={{ background: "#1A2744", color: "#fff", padding: "3px 8px", borderRadius: 4, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6 }}>
                                        {label}{!meta && <span style={{ fontSize: 10, opacity: 0.7 }}>(missing)</span>}
                                        <button
                                          type="button"
                                          onClick={() => setTaskCardDrafts((prev) => ({ ...prev, [card.id]: { ...draft, corpusDocIds: draft.corpusDocIds.filter((d) => d !== docId) } }))}
                                          style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}
                                          aria-label={`Remove ${label}`}
                                          data-testid={`btn-unpin-doc-${card.id}-${docId}`}
                                        >×</button>
                                      </span>
                                    );
                                  })
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setCorpusPickerOpenFor(corpusPickerOpenFor === card.id ? null : card.id)}
                                style={{ ...btnStyle("#6B7280", false), padding: "6px 12px", fontSize: 12 }}
                                data-testid={`btn-pick-docs-${card.id}`}
                              >
                                {corpusPickerOpenFor === card.id ? "Close picker" : "Pick documents…"}
                              </button>
                              {corpusPickerOpenFor === card.id && (
                                <div style={{ marginTop: 8, border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 10px", background: "#fff", maxHeight: 220, overflowY: "auto" }}>
                                  {corpusDocs.length === 0 ? (
                                    <p style={{ fontSize: 12, color: "#9CA3AF", margin: 0 }}>No corpus documents available.</p>
                                  ) : (
                                    corpusDocs.map((doc) => {
                                      const checked = draft.corpusDocIds.includes(doc.docId);
                                      return (
                                        <label key={doc.docId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13, cursor: "pointer" }}>
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => {
                                              setTaskCardDrafts((prev) => {
                                                const cur = prev[card.id] ?? draft;
                                                const next = e.target.checked
                                                  ? Array.from(new Set([...cur.corpusDocIds, doc.docId]))
                                                  : cur.corpusDocIds.filter((d) => d !== doc.docId);
                                                return { ...prev, [card.id]: { ...cur, corpusDocIds: next } };
                                              });
                                            }}
                                            data-testid={`chk-pin-doc-${card.id}-${doc.docId}`}
                                          />
                                          <span style={{ fontWeight: 500 }}>{doc.title}</span>
                                          <span style={{ color: "#9CA3AF", fontSize: 11 }}>{doc.docId}</span>
                                        </label>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
                          <button
                            onClick={() => handleSaveTaskCard(card.id)}
                            disabled={!isDirty || isSaving}
                            style={btnStyle("#1A2744", !isDirty || isSaving)}
                            data-testid={`btn-save-task-${card.id}`}
                          >
                            {isSaving ? "Saving…" : "Save changes"}
                          </button>
                          <button
                            onClick={() => { setDeletingTaskCard(card); setDeleteTaskCardText(""); }}
                            disabled={isSaving}
                            style={btnStyle("#DC2626", isSaving)}
                            data-testid={`btn-delete-task-${card.id}`}
                          >
                            Delete
                          </button>
                          {isDirty && !isSaving && <span style={{ fontSize: 12, color: "#F59E0B" }}>Unsaved changes</span>}
                          {!isDirty && card.updatedAt && (
                            <span style={{ fontSize: 11, color: "#9CA3AF" }}>Last saved: {new Date(card.updatedAt).toLocaleString()}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {deletingTaskCard && (
              <div
                style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
                onClick={() => { if (!deletingTaskCardSubmitting) { setDeletingTaskCard(null); setDeleteTaskCardText(""); } }}
              >
                <div
                  style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#1A2744", margin: "0 0 10px" }}>Delete task launcher card?</h3>
                  <p style={{ fontSize: 13, color: "#4B5563", margin: "0 0 6px", lineHeight: 1.55 }}>
                    You're about to permanently delete <strong>"{deletingTaskCard.title}"</strong>. This can't be undone.
                  </p>
                  <p style={{ fontSize: 13, color: "#4B5563", margin: "12px 0 6px" }}>
                    Type <strong>delete</strong> to confirm.
                  </p>
                  <input
                    type="text"
                    value={deleteTaskCardText}
                    onChange={(e) => setDeleteTaskCardText(e.target.value)}
                    placeholder="delete"
                    autoFocus
                    style={{ ...inputStyle("100%"), padding: "9px 12px", marginBottom: 16 }}
                    data-testid="input-confirm-delete-task-card"
                  />
                  <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                      onClick={() => { setDeletingTaskCard(null); setDeleteTaskCardText(""); }}
                      disabled={deletingTaskCardSubmitting}
                      style={{ background: "#fff", color: "#4B5563", border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 16px", fontSize: 14, cursor: deletingTaskCardSubmitting ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }}
                      data-testid="btn-cancel-delete-task-card"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmDeleteTaskCard}
                      disabled={deleteTaskCardText !== "delete" || deletingTaskCardSubmitting}
                      style={btnStyle("#DC2626", deleteTaskCardText !== "delete" || deletingTaskCardSubmitting)}
                      data-testid="btn-confirm-delete-task-card"
                    >
                      {deletingTaskCardSubmitting ? "Deleting…" : "Delete card"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 4. System Prompt */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>System Prompt</div>
              <p style={{ fontSize: 13, color: "#6B7280", margin: "-8px 0 20px" }}>
                The system prompt controls how the chatbot behaves — its tone, coaching logic, data safety behavior, and how it uses your service area context. Changes take effect on the next new conversation.
              </p>

              {spLoading && !spFetched ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B7280", fontSize: 13 }}><Spinner size={16} color="#9CA3AF" /> Loading…</div>
              ) : (
                <>
                  {/* Sub-tabs */}
                  <div style={{ display: "flex", borderBottom: "1px solid #E5E7EB", marginBottom: 20 }}>
                    {[1, 2, 3, 4].map((n) => (
                      <button key={n} onClick={() => setActiveSpLayer(n)} style={{ background: "none", border: "none", padding: "10px 16px", fontSize: 13, fontWeight: activeSpLayer === n ? 600 : 400, color: activeSpLayer === n ? "#1A2744" : "#6B7280", cursor: "pointer", borderBottom: activeSpLayer === n ? "2px solid #1A2744" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", marginBottom: -1, whiteSpace: "nowrap" }}>
                        {SP_LAYER_LABELS[n]}
                      </button>
                    ))}
                  </div>

                  {(activeSpLayer === 3 || activeSpLayer === 4) && (
                    <div style={{ padding: "10px 14px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, marginBottom: 14, fontSize: 13, color: "#92400E" }}>
                      {activeSpLayer === 3
                        ? "This is the preamble shown before injected RAG document chunks. The actual chunks are appended at runtime."
                        : "Use {{county}} and {{serviceCategory}} as placeholders — they're replaced with the user's actual county and service area at runtime."}
                    </div>
                  )}

                  {currentSpLayer && (
                    <div style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 10 }}>
                      Last saved: {currentSpLayer.updatedAt ? new Date(currentSpLayer.updatedAt).toLocaleString() : "—"}
                    </div>
                  )}

                  <textarea
                    value={currentDraft}
                    onChange={(e) => setSPDraft((d) => ({ ...d, [activeSpLayer]: e.target.value }))}
                    style={{ width: "100%", minHeight: 280, border: "1px solid #D1D5DB", borderRadius: 6, padding: "12px 14px", fontSize: 13, color: "#111827", fontFamily: "monospace", lineHeight: 1.6, resize: "vertical", boxSizing: "border-box", outline: "none" }}
                  />

                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={handleSPSave} disabled={!isDirty || showDiff} style={btnStyle("#1A2744", !isDirty || showDiff)}>Save changes</button>
                    <button onClick={handleSPRevert} disabled={!currentSpLayer?.previousContent} style={btnStyle("#6B7280", !currentSpLayer?.previousContent)}>Revert to previous</button>
                    {isDirty && <span style={{ fontSize: 12, color: "#F59E0B" }}>Unsaved changes</span>}
                  </div>

                  {/* Diff view */}
                  {showDiff && pendingDiff && (
                    <div style={{ marginTop: 20, border: "1px solid #E5E7EB", borderRadius: 8, overflow: "hidden" }}>
                      <div style={{ padding: "12px 16px", background: "#F9FAFB", borderBottom: "1px solid #E5E7EB", fontSize: 13, fontWeight: 600, color: "#374151" }}>
                        Review changes — {SP_LAYER_LABELS[pendingDiff.layer]}
                      </div>
                      <div style={{ overflowY: "auto", maxHeight: 400, fontFamily: "monospace", fontSize: 12 }}>
                        {lineDiff(pendingDiff.old, pendingDiff.next).map((line, i) => (
                          <div key={i} style={{ padding: "1px 16px", background: line.type === "added" ? "#DCFCE7" : line.type === "removed" ? "#FEE2E2" : "transparent", color: line.type === "added" ? "#166534" : line.type === "removed" ? "#991B1B" : "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", display: "flex", gap: 8 }}>
                            <span style={{ opacity: 0.5, flexShrink: 0, userSelect: "none" }}>{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</span>
                            <span>{line.text || "\u00a0"}</span>
                          </div>
                        ))}
                      </div>
                      <div style={{ padding: "16px", background: "#F9FAFB", borderTop: "1px solid #E5E7EB" }}>
                        <label style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>
                          Type <code style={{ background: "#E5E7EB", padding: "1px 5px", borderRadius: 3 }}>confirm</code> to save:
                        </label>
                        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                          <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="confirm" style={{ ...inputStyle(150), padding: "8px 12px" }} />
                          <button onClick={handleSPConfirmSave} disabled={confirmText !== "confirm" || spSaving} style={btnStyle("#1A2744", confirmText !== "confirm" || spSaving)}>{spSaving ? "Saving…" : "Save"}</button>
                          <button onClick={() => { setShowDiff(false); setPendingDiff(null); setConfirmText(""); }} style={btnStyle("#6B7280")}>Cancel</button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Retrieval Debug */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={sectionTitleStyle}>Retrieval Debug</div>
                  <p style={{ fontSize: 13, color: "#6B7280", margin: "-8px 0 0", lineHeight: 1.6, maxWidth: 620 }}>
                    When enabled, every chat turn that uses RAG is logged with the user's query and the retrieved chunks (with cosine scores). Use this to see why the chatbot is or isn't surfacing certain knowledge. Logs are kept indefinitely until cleared.
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 4 }}>
                  <span style={{ fontSize: 13, color: "#374151", fontWeight: 500 }}>{debugLoggingEnabled ? "Logging on" : "Logging off"}</span>
                  <ToggleSwitch enabled={debugLoggingEnabled} onChange={(v) => { if (!debugLoggingSaving) handleToggleDebugLogging(v); }} />
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 16, marginBottom: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => fetchRetrievalDebug()} disabled={retrievalDebugLoading} style={btnStyle("#1A2744", retrievalDebugLoading)} data-testid="btn-refresh-retrieval-debug">
                  {retrievalDebugLoading ? "Loading…" : "Refresh"}
                </button>
                <button onClick={handleClearRetrievalDebug} disabled={retrievalDebug.length === 0} style={btnStyle("#DC2626", retrievalDebug.length === 0)} data-testid="btn-clear-retrieval-debug">
                  Clear log
                </button>
                <span style={{ fontSize: 12, color: "#6B7280" }}>{retrievalDebug.length} entr{retrievalDebug.length === 1 ? "y" : "ies"}</span>
              </div>

              {retrievalDebugError && <div style={{ padding: "8px 12px", background: "#FEF2F2", color: "#DC2626", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{retrievalDebugError}</div>}

              {retrievalDebugLoading && retrievalDebug.length === 0 ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B7280", fontSize: 13 }}><Spinner size={16} color="#9CA3AF" /> Loading…</div>
              ) : retrievalDebug.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0, fontStyle: "italic" }}>
                  {debugLoggingEnabled ? "No retrieval events logged yet. Send a chat message to populate." : "Enable logging above, then send a chat message to populate."}
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxHeight: 600, overflowY: "auto" }} data-testid="retrieval-debug-list">
                  {retrievalDebug.map((entry) => (
                    <div key={entry.id} style={{ border: "1px solid #E5E7EB", borderRadius: 8, padding: "12px 14px", background: "#FAFAFA" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12, color: "#6B7280" }}>
                          <strong style={{ color: "#374151" }}>{entry.userEmail || "anonymous"}</strong> · {fmt(entry.createdAt)}
                        </div>
                        <div style={{ fontSize: 11, color: "#9CA3AF", fontFamily: "monospace" }}>{entry.id.slice(0, 8)}</div>
                      </div>
                      <div style={{ fontSize: 13, color: "#111827", marginBottom: 10, padding: "8px 12px", background: "#fff", borderRadius: 6, border: "1px solid #E5E7EB" }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em" }}>Query</span>
                        <div style={{ marginTop: 3, lineHeight: 1.5 }}>{entry.query}</div>
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
                        {entry.chunks.length} chunk{entry.chunks.length === 1 ? "" : "s"} retrieved
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {entry.chunks.map((c, i) => (
                          <div key={i} style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 6, padding: "8px 12px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: "#111827" }}>{c.title} <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9CA3AF", fontWeight: 400 }}>· {c.docId}</span></span>
                              <span style={{ fontSize: 11, fontFamily: "monospace", color: "#0369A1" }}>score: {c.score.toFixed(4)}</span>
                            </div>
                            <div style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.5 }}>{c.preview}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4. Data Backup */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Data Backup</div>
              <p style={{ fontSize: 13, color: "#6B7280", margin: "-8px 0 20px", lineHeight: 1.6 }}>Download a complete SQL snapshot of all data — users, corpus, system prompt, feedback, ratings, and settings. Keep this file secure; it contains all registered user information.</p>
              <button onClick={handleDownloadBackup} disabled={backupLoading} style={{ ...btnStyle("#1A2744", backupLoading), display: "inline-flex", alignItems: "center", gap: 8 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                {backupLoading ? "Generating…" : "Download Backup"}
              </button>
              {backupError && <div style={{ marginTop: 12, padding: "10px 14px", background: "#FEF2F2", color: "#DC2626", borderRadius: 8, fontSize: 13 }}>{backupError}</div>}
            </div>
          </>
        )}
      </main>

      {/* View Modal */}
      {viewModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ background: "#fff", borderRadius: 10, maxWidth: 800, width: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ padding: "16px 24px", borderBottom: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: "#111827" }}>{viewModal.title}</span>
              <button onClick={() => setViewModal(null)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#6B7280", lineHeight: 1, padding: "0 4px" }}>×</button>
            </div>
            <pre style={{ flex: 1, overflowY: "auto", padding: "20px 24px", margin: 0, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, color: "#374151" }}>
              {viewModal.content || "(empty document)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return <div style={cardStyle}><div style={cardTitleStyle}>{title}</div><div style={bigNumStyle}>{value}</div>{sub && <div style={subStyle}>{sub}</div>}</div>;
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)} title={enabled ? "Active — click to disable" : "Disabled — click to enable"} style={{ width: 42, height: 24, borderRadius: 12, background: enabled ? "#16A34A" : "#D1D5DB", border: "none", cursor: "pointer", position: "relative", padding: 0, flexShrink: 0 }}>
      <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: enabled ? 21 : 3, transition: "left 0.18s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

function Spinner({ size = 28, color = "#C8963E" }: { size?: number; color?: string }) {
  return <div style={{ width: size, height: size, border: `3px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />;
}

function GlobalStyles() {
  return <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>;
}

const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", padding: "20px 24px" };
const cardTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
const bigNumStyle: React.CSSProperties = { fontSize: 30, fontWeight: 700, color: "#111827", lineHeight: 1 };
const subStyle: React.CSSProperties = { fontSize: 12, color: "#9CA3AF", marginTop: 5 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "#1A2744", marginBottom: 14 };
const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 };
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#9CA3AF", marginTop: 4 };
const selectStyle: React.CSSProperties = { border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827", background: "#fff", cursor: "pointer" };
function inputStyle(w: number | string): React.CSSProperties { return { width: w, border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827" }; }
function btnStyle(bg: string, disabled = false): React.CSSProperties { return { background: disabled ? "#9CA3AF" : bg, color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }; }
function smallBtn(color: string): React.CSSProperties { return { background: "none", border: `1px solid ${color}`, borderRadius: 5, padding: "4px 12px", fontSize: 12, cursor: "pointer", color, fontFamily: "'DM Sans', sans-serif" }; }
