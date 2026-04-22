import { useState, useEffect, useCallback, useRef } from "react";
import { setAdminAuthenticated } from "@/lib/adminAuth";

type AdminTab = "dashboard" | "users" | "feedback" | "settings";

type AdminStats = {
  totalUsers: number;
  newThisMonth: number;
  weeklyActive: number;
  unmatchedDomainsThisWeek: number;
  returningUsers: number;
  oneTimeUsers: number;
  totalConversations: number;
  avgMessagesPerConversation: number;
  thumbsUpCount: number;
  thumbsDownCount: number;
  currentMonthSpend: number;
  currentMonthTokens: number;
  unmatchedDomainCount: number;
  usersByCounty: Array<{ label: string; count: number }>;
  usersByServiceCategory: Array<{ label: string; count: number }>;
  taskLauncherUsage: Array<{ label: string; count: number }>;
  activeModel: string;
  spendThreshold: number;
};

type AdminUser = {
  id: string;
  email: string;
  county: string;
  serviceCategory: string;
  domainMatch: boolean;
  domainNote: string | null;
  disabled: boolean;
  createdAt: string;
  lastActive: string | null;
  conversationCount: number;
};

type AdminFeedback = {
  id: string;
  userId: string;
  userEmail: string;
  feedbackType: string;
  detail: string | null;
  attemptedFileSize: number | null;
  createdAt: string;
};

type CorpusDoc = {
  docId: string;
  chunkCount: number;
  lastUpdated: string;
};

const MODEL_OPTIONS = [
  { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
const getDomain = (email: string) => email.split("@")[1] ?? "";

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });

export default function Admin() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    const auth = sessionStorage.getItem("adminAuth");
    if (auth === "true") {
      setAdminAuthenticated(true);
      setIsAuthenticated(true);
      setIsCheckingAuth(false);
      return;
    }
    // Auto-authenticate if the main app session belongs to the admin
    fetch("/api/auth/me")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          if (data?.email?.toLowerCase() === "anthony@iqmeeteq.com") {
            sessionStorage.setItem("adminAuth", "true");
            setAdminAuthenticated(true);
            setIsAuthenticated(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setIsCheckingAuth(false));
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail.toLowerCase() === "anthony@iqmeeteq.com" && loginPassword === "95682") {
      sessionStorage.setItem("adminAuth", "true");
      setAdminAuthenticated(true);
      setIsAuthenticated(true);
    } else {
      setLoginError("Invalid admin credentials.");
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adminAuth");
    setAdminAuthenticated(false);
    setIsAuthenticated(false);
  };

  if (isCheckingAuth) {
    return (
      <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: "40px 36px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 28, color: "#C8963E", margin: "0 0 6px" }}>AI for HHS</h1>
            <p style={{ fontSize: 14, color: "#6B7280", margin: 0 }}>Admin Dashboard</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Email</label>
              <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@example.com" style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: "#111827", outline: "none", boxSizing: "border-box" }} data-testid="input-admin-email" />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 }}>Password</label>
              <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="••••••••" style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: "#111827", outline: "none", boxSizing: "border-box" }} data-testid="input-admin-password" />
            </div>
            {loginError && <p style={{ color: "#DC2626", fontSize: 13, margin: 0 }}>{loginError}</p>}
            <button type="submit" style={{ background: "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "10px 0", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-admin-login">
              Log In
            </button>
          </form>
        </div>
        <GlobalStyles />
      </div>
    );
  }

  return <AdminDashboard onLogout={handleLogout} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboard");

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [corpus, setCorpus] = useState<CorpusDoc[]>([]);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [corpusFetched, setCorpusFetched] = useState(false);
  const [corpusOp, setCorpusOp] = useState<string | null>(null);
  const [corpusOpError, setCorpusOpError] = useState<string | null>(null);

  const [uploadDocId, setUploadDocId] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replacingDocId, setReplacingDocId] = useState<string | null>(null);

  const [searchEmail, setSearchEmail] = useState("");
  const [filterCounty, setFilterCounty] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [sortField, setSortField] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [thresholdInput, setThresholdInput] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, uRes, fRes] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/users"),
        fetch("/api/admin/feedback"),
      ]);
      if (!sRes.ok || !uRes.ok || !fRes.ok) throw new Error("Fetch failed");
      const [sData, uData, fData] = await Promise.all([sRes.json(), uRes.json(), fRes.json()]);
      setStats(sData);
      setUsers(uData);
      setFeedback(fData);
      setThresholdInput(String(sData.spendThreshold));
    } catch {
      setError("Failed to load dashboard data. Please refresh.");
    }
    setLoading(false);
  }, []);

  const fetchCorpus = useCallback(async () => {
    setCorpusLoading(true);
    try {
      const res = await fetch("/api/admin/corpus");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setCorpus(data);
      setCorpusFetched(true);
    } catch {
      setCorpusOpError("Failed to load corpus documents.");
    }
    setCorpusLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => {
    if (activeTab === "settings" && !corpusFetched) fetchCorpus();
  }, [activeTab, corpusFetched, fetchCorpus]);

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

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, disabled } : u));
    await fetch(`/api/admin/users/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled }) });
  };

  const handleUploadDoc = async () => {
    if (!uploadFile || !uploadDocId.trim()) return;
    setCorpusOp(`Ingesting "${uploadDocId}"…`);
    setCorpusOpError(null);
    try {
      const content = await readFileAsText(uploadFile);
      const res = await fetch("/api/admin/corpus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId: uploadDocId.trim(), content }),
      });
      const data = await res.json();
      if (!res.ok) { setCorpusOpError(data.error || "Upload failed"); }
      else { setUploadFile(null); setUploadDocId(""); if (uploadInputRef.current) uploadInputRef.current.value = ""; await fetchCorpus(); }
    } catch { setCorpusOpError("Upload failed."); }
    setCorpusOp(null);
  };

  const handleReplaceDoc = async (file: File) => {
    if (!replacingDocId) return;
    const docId = replacingDocId;
    setReplacingDocId(null);
    setCorpusOp(`Re-ingesting "${docId}"…`);
    setCorpusOpError(null);
    try {
      const content = await readFileAsText(file);
      const res = await fetch(`/api/admin/corpus/${encodeURIComponent(docId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) { const d = await res.json(); setCorpusOpError(d.error || "Replace failed"); }
      else { await fetchCorpus(); }
    } catch { setCorpusOpError("Replace failed."); }
    setCorpusOp(null);
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm(`Delete "${docId}" and all its chunks from the corpus?`)) return;
    setCorpusOp(`Deleting "${docId}"…`);
    setCorpusOpError(null);
    try {
      await fetch(`/api/admin/corpus/${encodeURIComponent(docId)}`, { method: "DELETE" });
      await fetchCorpus();
    } catch { setCorpusOpError("Delete failed."); }
    setCorpusOp(null);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

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

  const unmatchedUsers = users.filter((u) => !u.domainMatch);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner color="#C8963E" size={36} />
        <GlobalStyles />
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "#DC2626", marginBottom: 14 }}>{error ?? "Unknown error"}</p>
          <button onClick={fetchAll} style={btnStyle("#1A2744")}>Retry</button>
        </div>
      </div>
    );
  }

  const totalRatings = stats.thumbsUpCount + stats.thumbsDownCount;
  const upPct = totalRatings > 0 ? Math.round((stats.thumbsUpCount / totalRatings) * 100) : 0;
  const maxTask = Math.max(...stats.taskLauncherUsage.map((t) => t.count), 1);
  const TABS: { id: AdminTab; label: string }[] = [
    { id: "dashboard", label: "Dashboard" },
    { id: "users", label: "Users" },
    { id: "feedback", label: "Feedback" },
    { id: "settings", label: "Settings" },
  ];

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
        <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#D1D5DB", borderRadius: 6, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-admin-logout">
          Sign Out
        </button>
      </header>

      {/* TAB BAR */}
      <div style={{ background: "#fff", borderBottom: "1px solid #E5E7EB", display: "flex", padding: "0 24px", flexShrink: 0 }}>
        {TABS.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ background: "none", border: "none", padding: "14px 20px", fontSize: 14, fontWeight: activeTab === tab.id ? 600 : 400, color: activeTab === tab.id ? "#C8963E" : "#6B7280", cursor: "pointer", borderBottom: activeTab === tab.id ? "2px solid #C8963E" : "2px solid transparent", fontFamily: "'DM Sans', sans-serif", marginBottom: -1 }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT */}
      <main style={{ flex: 1, maxWidth: 1280, width: "100%", margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── TAB 1: DASHBOARD ── */}
        {activeTab === "dashboard" && (
          <>
            {/* Row 1 summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
              <StatCard title="Total Users" value={stats.totalUsers} />
              <StatCard title="New This Month" value={stats.newThisMonth} />
              <StatCard title="Weekly Active" value={stats.weeklyActive} sub="unique users, last 7 days" />
              <div style={{ background: "#FEF2F2", border: "1.5px solid #DC2626", borderRadius: 10, padding: "20px 24px" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#991B1B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Unmatched Domains This Week</div>
                <div style={{ fontSize: 30, fontWeight: 700, color: "#DC2626", lineHeight: 1 }}>{stats.unmatchedDomainsThisWeek}</div>
                <div style={{ fontSize: 12, color: "#DC2626", marginTop: 5, opacity: 0.75 }}>new registrations, no domain match</div>
              </div>
            </div>

            {/* Row 2 summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Returning vs. One-Time</div>
                <div style={{ ...bigNumStyle }}>{stats.returningUsers} <span style={{ fontSize: 16, color: "#6B7280", fontWeight: 400 }}>/ {stats.oneTimeUsers}</span></div>
                <div style={subStyle}>returning / one-time</div>
              </div>
              <StatCard title="Total Conversations" value={stats.totalConversations} />
              <StatCard title="Avg Messages / Conversation" value={stats.avgMessagesPerConversation.toFixed(1)} />
              <div style={cardStyle}>
                <div style={cardTitleStyle}>Thumbs Up / Down</div>
                <div style={bigNumStyle}>{upPct}%<span style={{ fontSize: 15, fontWeight: 400, color: "#6B7280" }}> up</span></div>
                <div style={subStyle}>{stats.thumbsUpCount} up / {stats.thumbsDownCount} down</div>
              </div>
            </div>

            {/* Cost card */}
            <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
              <div>
                <div style={cardTitleStyle}>Est. Cost This Month</div>
                <div style={{ fontSize: 34, fontWeight: 700, color: "#111827" }}>${stats.currentMonthSpend.toFixed(2)}</div>
              </div>
              <div style={{ color: "#9CA3AF", fontSize: 13 }}>{stats.currentMonthTokens.toLocaleString()} tokens</div>
            </div>

            {/* Breakdowns */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Users by County</div>
                <div style={{ overflowY: "auto", maxHeight: 300 }}>
                  <table style={tblStyle}>
                    <tbody>
                      {stats.usersByCounty.map((c, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "7px 0", fontSize: 13, color: "#374151" }}>{c.label}</td>
                          <td style={{ padding: "7px 0", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{c.count}</td>
                        </tr>
                      ))}
                      {stats.usersByCounty.length === 0 && <tr><td style={{ color: "#9CA3AF", fontSize: 13, padding: 8 }} colSpan={2}>No data yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={cardStyle}>
                <div style={sectionTitleStyle}>Users by Service Category</div>
                <div style={{ overflowY: "auto", maxHeight: 300 }}>
                  <table style={tblStyle}>
                    <tbody>
                      {stats.usersByServiceCategory.map((c, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "7px 0", fontSize: 13, color: "#374151" }}>{c.label}</td>
                          <td style={{ padding: "7px 0", fontSize: 13, fontWeight: 600, textAlign: "right" }}>{c.count}</td>
                        </tr>
                      ))}
                      {stats.usersByServiceCategory.length === 0 && <tr><td style={{ color: "#9CA3AF", fontSize: 13, padding: 8 }} colSpan={2}>No data yet</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Task launcher ranking */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Task Launcher Ranking</div>
              {stats.taskLauncherUsage.length === 0 ? (
                <p style={{ color: "#9CA3AF", fontSize: 13, margin: 0 }}>No task launcher taps yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {stats.taskLauncherUsage.map((t, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", width: 22, textAlign: "right", flexShrink: 0 }}>#{i + 1}</span>
                      <span style={{ fontSize: 13, color: "#374151", flex: "0 0 220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</span>
                      <div style={{ flex: 1, height: 10, background: "#F3F4F6", borderRadius: 5 }}>
                        <div style={{ height: "100%", width: `${Math.round((t.count / maxTask) * 100)}%`, background: "#C8963E", borderRadius: 5, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, width: 32, textAlign: "right", flexShrink: 0 }}>{t.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Unmatched domain table */}
            <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1.5px solid #DC2626", overflow: "hidden" }}>
              <div style={{ padding: "14px 24px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #FEE2E2" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>Total: {unmatchedUsers.length} — users registered without a recognized domain</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={tblStyle}>
                  <thead>
                    <tr>
                      {["Email", "Domain", "County", "Service Category", "Registered", "Connection Explanation"].map((h) => (
                        <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {unmatchedUsers.map((u) => (
                      <tr key={u.id}>
                        <TD>{u.email}</TD>
                        <TD><span style={{ fontFamily: "monospace", fontSize: 12 }}>{getDomain(u.email)}</span></TD>
                        <TD>{u.county}</TD>
                        <TD>{u.serviceCategory}</TD>
                        <TD style={{ whiteSpace: "nowrap" }}>{fmt(u.createdAt)}</TD>
                        <TD style={{ color: u.domainNote ? "#374151" : "#9CA3AF", fontStyle: u.domainNote ? "normal" : "italic" }}>{u.domainNote || "—"}</TD>
                      </tr>
                    ))}
                    {unmatchedUsers.length === 0 && <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No unmatched domain registrations</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ── TAB 2: USERS ── */}
        {activeTab === "users" && (
          <div style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
              <div style={sectionTitleStyle}>
                {filteredUsers.length < users.length ? `Showing ${filteredUsers.length} of ${users.length} users` : `Total Users: ${users.length}`}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <input type="text" placeholder="Search by email…" value={searchEmail} onChange={(e) => setSearchEmail(e.target.value)} style={inputStyle(200)} />
                <select value={filterCounty} onChange={(e) => setFilterCounty(e.target.value)} style={selectStyle}>
                  <option value="">All Counties</option>
                  {counties.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={selectStyle}>
                  <option value="">All Categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    <TH label="Email" field="email" />
                    <TH label="Domain" field="domain" />
                    <TH label="County" field="county" />
                    <TH label="Service Category" field="serviceCategory" />
                    <TH label="Registered" field="createdAt" />
                    <TH label="Last Active" field="lastActive" />
                    <TH label="Conversations" field="conversationCount" />
                    <TH label="Match" field="match" />
                    <TH label="Status" field="status" />
                  </tr>
                </thead>
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
                      <TD>
                        {u.domainMatch
                          ? <span style={{ background: "#D1FAE5", color: "#065F46", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>Yes</span>
                          : <span style={{ background: "#FEE2E2", color: "#991B1B", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>No</span>}
                      </TD>
                      <TD><ToggleSwitch enabled={!u.disabled} onChange={(v) => handleToggleDisabled(u.id, !v)} /></TD>
                    </tr>
                  ))}
                  {sortedUsers.length === 0 && <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No users match your filters</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 3: FEEDBACK ── */}
        {activeTab === "feedback" && (
          <div style={cardStyle}>
            <div style={{ ...sectionTitleStyle, marginBottom: 4 }}>Feedback</div>
            <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>Total Entries: {feedback.length}</div>
            <div style={{ overflowX: "auto" }}>
              <table style={tblStyle}>
                <thead>
                  <tr>
                    {["Date", "User Email", "Type", "What They Were Trying To Do", "File Size"].map((h) => (
                      <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {feedback.map((f) => (
                    <tr key={f.id}>
                      <TD style={{ whiteSpace: "nowrap" }}>{fmt(f.createdAt)}</TD>
                      <TD style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.userEmail}</TD>
                      <TD><span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10, whiteSpace: "nowrap" }}>{f.feedbackType.replace(/_/g, " ")}</span></TD>
                      <TD style={{ color: f.detail ? "#374151" : "#9CA3AF", fontStyle: f.detail ? "normal" : "italic" }}>{f.detail || "—"}</TD>
                      <TD style={{ whiteSpace: "nowrap" }}>{f.attemptedFileSize ? `${(f.attemptedFileSize / 1024 / 1024).toFixed(1)} MB` : "—"}</TD>
                    </tr>
                  ))}
                  {feedback.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No feedback entries yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── TAB 4: SETTINGS ── */}
        {activeTab === "settings" && (
          <>
            {/* Model controls */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Model Controls</div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 32 }}>
                <div>
                  <label style={labelStyle}>Active Model</label>
                  <select value={stats.activeModel} onChange={(e) => handleModelChange(e.target.value)} style={{ ...selectStyle, fontSize: 14, padding: "9px 36px 9px 12px" }} data-testid="select-model">
                    {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <div style={hintStyle}>Applies to all new conversations</div>
                </div>
                <div>
                  <label style={labelStyle}>Auto-Downgrade Threshold</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 14, color: "#6B7280" }}>$</span>
                    <input type="number" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} style={{ ...inputStyle(90), padding: "8px 10px" }} data-testid="input-threshold" />
                    <span style={{ fontSize: 13, color: "#6B7280" }}>/ month</span>
                    <button onClick={handleThresholdSave} disabled={savingConfig} style={btnStyle("#1A2744")}>
                      {savingConfig ? "Saving…" : "Save"}
                    </button>
                  </div>
                  <div style={hintStyle}>Downgrades to Sonnet when exceeded, resets on 1st of month</div>
                </div>
              </div>
            </div>

            {/* Corpus management */}
            <div style={cardStyle}>
              <div style={sectionTitleStyle}>Corpus Management</div>
              <p style={{ fontSize: 13, color: "#6B7280", marginTop: -8, marginBottom: 20 }}>
                Manage the markdown documents used for RAG context. Upload, replace, or delete documents below.
              </p>

              {corpusOp && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "#EFF6FF", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#1D4ED8" }}>
                  <Spinner color="#1D4ED8" size={16} />
                  {corpusOp}
                </div>
              )}
              {corpusOpError && (
                <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "#DC2626" }}>
                  {corpusOpError}
                </div>
              )}

              {/* Document list */}
              <div style={{ marginBottom: 28 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 10 }}>
                  Current Documents ({corpus.length})
                </div>
                {corpusLoading && !corpusFetched ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#6B7280", fontSize: 13 }}><Spinner size={16} color="#9CA3AF" /> Loading…</div>
                ) : corpus.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#9CA3AF", margin: 0 }}>No documents in corpus yet.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={tblStyle}>
                      <thead>
                        <tr>
                          {["Document ID", "Chunks", "Last Updated", "Actions"].map((h) => (
                            <th key={h} style={{ padding: "9px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", background: "#FAFAFA" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {corpus.map((doc) => (
                          <tr key={doc.docId}>
                            <TD><span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 500 }}>{doc.docId}</span></TD>
                            <TD style={{ textAlign: "center" }}>{doc.chunkCount}</TD>
                            <TD style={{ whiteSpace: "nowrap" }}>{fmt(doc.lastUpdated)}</TD>
                            <TD>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={() => { setReplacingDocId(doc.docId); replaceInputRef.current?.click(); }}
                                  disabled={!!corpusOp}
                                  style={{ background: "#F3F4F6", border: "1px solid #D1D5DB", borderRadius: 5, padding: "4px 12px", fontSize: 12, cursor: corpusOp ? "not-allowed" : "pointer", color: "#374151", fontFamily: "'DM Sans', sans-serif" }}
                                >
                                  Replace
                                </button>
                                <button
                                  onClick={() => handleDeleteDoc(doc.docId)}
                                  disabled={!!corpusOp}
                                  style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 5, padding: "4px 12px", fontSize: 12, cursor: corpusOp ? "not-allowed" : "pointer", color: "#DC2626", fontFamily: "'DM Sans', sans-serif" }}
                                >
                                  Delete
                                </button>
                              </div>
                            </TD>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Upload new document */}
              <div style={{ borderTop: "1px solid #E5E7EB", paddingTop: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 14 }}>Upload New Document</div>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
                  <div>
                    <label style={labelStyle}>Document ID</label>
                    <input
                      type="text"
                      value={uploadDocId}
                      onChange={(e) => setUploadDocId(e.target.value)}
                      placeholder="e.g. iqmeeteq-riceco"
                      style={{ ...inputStyle(220), padding: "8px 12px" }}
                    />
                    <div style={hintStyle}>Unique identifier (auto-filled from filename)</div>
                  </div>
                  <div>
                    <label style={labelStyle}>Markdown File (.md)</label>
                    <input
                      ref={uploadInputRef}
                      type="file"
                      accept=".md,.txt"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setUploadFile(f);
                        if (!uploadDocId.trim()) {
                          setUploadDocId(f.name.replace(/\.(md|txt)$/i, "").replace(/\s+/g, "-").toLowerCase());
                        }
                      }}
                      style={{ display: "block", fontSize: 13, color: "#374151" }}
                    />
                  </div>
                  <button
                    onClick={handleUploadDoc}
                    disabled={!uploadFile || !uploadDocId.trim() || !!corpusOp}
                    style={btnStyle("#1A2744", !uploadFile || !uploadDocId.trim() || !!corpusOp)}
                  >
                    Upload &amp; Ingest
                  </button>
                </div>
                {uploadFile && (
                  <div style={{ marginTop: 8, fontSize: 13, color: "#6B7280" }}>
                    Selected: <strong>{uploadFile.name}</strong> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </div>
                )}
              </div>

              {/* Hidden replace input */}
              <input
                ref={replaceInputRef}
                type="file"
                accept=".md,.txt"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleReplaceDoc(f);
                  if (replaceInputRef.current) replaceInputRef.current.value = "";
                }}
              />
            </div>
          </>
        )}

      </main>
    </div>
  );
}

/* ── SHARED SUB-COMPONENTS ── */
function StatCard({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div style={cardStyle}>
      <div style={cardTitleStyle}>{title}</div>
      <div style={bigNumStyle}>{value}</div>
      {sub && <div style={subStyle}>{sub}</div>}
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!enabled)} title={enabled ? "Active — click to disable" : "Disabled — click to enable"} style={{ width: 42, height: 24, borderRadius: 12, background: enabled ? "#16A34A" : "#D1D5DB", border: "none", cursor: "pointer", position: "relative", padding: 0, flexShrink: 0 }}>
      <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: enabled ? 21 : 3, transition: "left 0.18s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

function Spinner({ size = 28, color = "#C8963E" }: { size?: number; color?: string }) {
  return (
    <div style={{ width: size, height: size, border: `3px solid ${color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
  );
}

function GlobalStyles() {
  return <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>;
}

/* ── SHARED STYLES ── */
const cardStyle: React.CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", padding: "20px 24px" };
const cardTitleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 };
const bigNumStyle: React.CSSProperties = { fontSize: 30, fontWeight: 700, color: "#111827", lineHeight: 1 };
const subStyle: React.CSSProperties = { fontSize: 12, color: "#9CA3AF", marginTop: 5 };
const sectionTitleStyle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "#1A2744", marginBottom: 14 };
const tblStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 5 };
const hintStyle: React.CSSProperties = { fontSize: 11, color: "#9CA3AF", marginTop: 4 };
const selectStyle: React.CSSProperties = { border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827", background: "#fff", cursor: "pointer" };
function inputStyle(w: number): React.CSSProperties { return { width: w, border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827" }; }
function btnStyle(bg: string, disabled = false): React.CSSProperties { return { background: disabled ? "#9CA3AF" : bg, color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }; }
