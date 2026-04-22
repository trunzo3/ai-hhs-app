import { useState, useEffect, useCallback } from "react";
import { setAdminAuthenticated } from "@/lib/adminAuth";

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

const MODEL_OPTIONS = [
  { value: "claude-opus-4-5", label: "Claude Opus 4.5" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
];

const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = (d: string | null) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
const getDomain = (email: string) => email.split("@")[1] ?? "";

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
    }
    setIsCheckingAuth(false);
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginEmail === "anthony@iqmeeteq.com" && loginPassword === "95682") {
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
        <div style={{ width: 32, height: 32, border: "3px solid #C8963E", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div style={{ minHeight: "100vh", background: "#1A2744", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 12, padding: "40px 36px", boxShadow: "0 8px 32px rgba(0,0,0,0.18)" }}>
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
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <AdminDashboard onLogout={handleLogout} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [feedback, setFeedback] = useState<AdminFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => { fetchAll(); }, [fetchAll]);

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
    if (av === null || av === undefined) av = "";
    if (bv === null || bv === undefined) bv = "";
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }) : filteredUsers;

  const unmatchedUsers = users.filter((u) => !u.domainMatch);

  const SortArrow = ({ field }: { field: string }) => (
    <span style={{ marginLeft: 4, color: sortField === field ? "#C8963E" : "#9CA3AF", fontSize: 11 }}>
      {sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );

  const TH = ({ label, field, style }: { label: string; field?: string; style?: React.CSSProperties }) => (
    <th
      onClick={field ? () => handleSort(field) : undefined}
      style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 600, color: "#6B7280", borderBottom: "1px solid #E5E7EB", whiteSpace: "nowrap", cursor: field ? "pointer" : "default", userSelect: "none", background: "#FAFAFA", ...style }}
    >
      {label}{field && <SortArrow field={field} />}
    </th>
  );

  const TD = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <td style={{ padding: "10px 14px", fontSize: 13, color: "#374151", borderBottom: "1px solid #F3F4F6", verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 36, height: 36, border: "3px solid #C8963E", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div style={{ minHeight: "100vh", background: "#F5F5F5", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ textAlign: "center", color: "#DC2626" }}>
          <p style={{ fontSize: 16, marginBottom: 12 }}>{error ?? "Unknown error"}</p>
          <button onClick={fetchAll} style={{ background: "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "8px 20px", cursor: "pointer", fontSize: 14 }}>Retry</button>
        </div>
      </div>
    );
  }

  const totalRatings = stats.thumbsUpCount + stats.thumbsDownCount;
  const upPct = totalRatings > 0 ? Math.round((stats.thumbsUpCount / totalRatings) * 100) : 0;
  const maxTask = Math.max(...stats.taskLauncherUsage.map((t) => t.count), 1);
  const activeModelLabel = MODEL_OPTIONS.find((m) => m.value === stats.activeModel)?.label ?? stats.activeModel;

  const S = {
    page: { minHeight: "100vh", background: "#F5F5F5", fontFamily: "'DM Sans', sans-serif" } as React.CSSProperties,
    header: { background: "#1A2744", padding: "0 32px", height: 58, display: "flex", alignItems: "center", justifyContent: "space-between" } as React.CSSProperties,
    main: { maxWidth: 1280, margin: "0 auto", padding: "28px 24px", display: "flex", flexDirection: "column" as const, gap: 28 },
    card: { background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", padding: "20px 24px" } as React.CSSProperties,
    cardTitle: { fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 6 },
    bigNum: { fontSize: 30, fontWeight: 700, color: "#111827", lineHeight: 1 },
    sectionLabel: { fontSize: 16, fontWeight: 600, color: "#1A2744", marginBottom: 14 },
    grid4: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 } as React.CSSProperties,
    grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 } as React.CSSProperties,
    table: { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
    scrollWrap: { overflowX: "auto" as const },
  };

  return (
    <div style={S.page}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } @media (max-width:900px){.grid4{grid-template-columns:1fr 1fr!important}.grid2cols{grid-template-columns:1fr!important}}`}</style>

      {/* HEADER */}
      <header style={S.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          <span style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#C8963E", fontWeight: 700 }}>AI for HHS</span>
          <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 400 }}>Admin Dashboard</span>
        </div>
        <button onClick={onLogout} style={{ background: "none", border: "1px solid rgba(255,255,255,0.2)", color: "#D1D5DB", borderRadius: 6, padding: "6px 16px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-admin-logout">
          Sign Out
        </button>
      </header>

      <main style={S.main}>

        {/* SUMMARY ROW 1 */}
        <div style={S.grid4} className="grid4">
          <StatCard title="Total Users" value={stats.totalUsers} />
          <StatCard title="New This Month" value={stats.newThisMonth} />
          <StatCard title="Weekly Active" value={stats.weeklyActive} sub="unique users, last 7 days" />
          <div style={{ background: "#FEF2F2", border: "1.5px solid #DC2626", borderRadius: 10, padding: "20px 24px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#991B1B", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Unmatched Domains This Week</div>
            <div style={{ fontSize: 30, fontWeight: 700, color: "#DC2626", lineHeight: 1 }}>{stats.unmatchedDomainsThisWeek}</div>
            <div style={{ fontSize: 12, color: "#DC2626", marginTop: 5, opacity: 0.7 }}>new registrations, no domain match</div>
          </div>
        </div>

        {/* SUMMARY ROW 2 */}
        <div style={S.grid4} className="grid4">
          <div style={S.card}>
            <div style={S.cardTitle}>Returning vs. One-Time</div>
            <div style={{ ...S.bigNum, color: "#111827" }}>{stats.returningUsers} <span style={{ fontSize: 16, color: "#6B7280", fontWeight: 400 }}>/ {stats.oneTimeUsers}</span></div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 5 }}>returning / one-time</div>
          </div>
          <StatCard title="Total Conversations" value={stats.totalConversations} />
          <StatCard title="Avg Messages / Conversation" value={stats.avgMessagesPerConversation.toFixed(1)} />
          <div style={S.card}>
            <div style={S.cardTitle}>Thumbs Up / Down</div>
            <div style={{ ...S.bigNum }}>{upPct}% <span style={{ fontSize: 15, fontWeight: 400, color: "#6B7280" }}>up</span></div>
            <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 5 }}>{stats.thumbsUpCount} up / {stats.thumbsDownCount} down</div>
          </div>
        </div>

        {/* COST CARD */}
        <div style={{ ...S.card, display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
          <div>
            <div style={S.cardTitle}>Est. Cost This Month</div>
            <div style={{ fontSize: 34, fontWeight: 700, color: "#111827" }}>${stats.currentMonthSpend.toFixed(2)}</div>
          </div>
          <div style={{ color: "#9CA3AF", fontSize: 13 }}>
            {stats.currentMonthTokens.toLocaleString()} tokens
          </div>
        </div>

        {/* MODEL CONTROLS */}
        <div style={S.card}>
          <div style={S.sectionLabel}>Model Controls</div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 32 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>Active Model</label>
              <select
                value={stats.activeModel}
                onChange={(e) => handleModelChange(e.target.value)}
                style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 36px 8px 12px", fontSize: 14, color: "#111827", background: "#fff", cursor: "pointer", appearance: "none", backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24'%3E%3Cpath fill='%236B7280' d='M7 10l5 5 5-5z'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
                data-testid="select-model"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Applies to all new conversations</div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>Auto-Downgrade Threshold</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 14, color: "#6B7280" }}>$</span>
                <input
                  type="number"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                  style={{ width: 90, border: "1px solid #D1D5DB", borderRadius: 6, padding: "8px 10px", fontSize: 14, color: "#111827" }}
                  data-testid="input-threshold"
                />
                <span style={{ fontSize: 13, color: "#6B7280" }}>/ month</span>
                <button onClick={handleThresholdSave} disabled={savingConfig} style={{ background: "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
                  {savingConfig ? "Saving…" : "Save"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>Downgrades to Sonnet when exceeded</div>
            </div>
          </div>
        </div>

        {/* BREAKDOWNS */}
        <div style={S.grid2} className="grid2cols">
          <div style={S.card}>
            <div style={S.sectionLabel}>Users by County</div>
            <div style={{ overflowY: "auto", maxHeight: 320 }}>
              <table style={S.table}>
                <tbody>
                  {stats.usersByCounty.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 0", fontSize: 13, color: "#374151" }}>{c.label}</td>
                      <td style={{ padding: "8px 0", fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "right" }}>{c.count}</td>
                    </tr>
                  ))}
                  {stats.usersByCounty.length === 0 && <tr><td style={{ padding: 12, color: "#9CA3AF", fontSize: 13 }} colSpan={2}>No data yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div style={S.card}>
            <div style={S.sectionLabel}>Users by Service Category</div>
            <div style={{ overflowY: "auto", maxHeight: 320 }}>
              <table style={S.table}>
                <tbody>
                  {stats.usersByServiceCategory.map((c, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      <td style={{ padding: "8px 0", fontSize: 13, color: "#374151" }}>{c.label}</td>
                      <td style={{ padding: "8px 0", fontSize: 13, fontWeight: 600, color: "#111827", textAlign: "right" }}>{c.count}</td>
                    </tr>
                  ))}
                  {stats.usersByServiceCategory.length === 0 && <tr><td style={{ padding: 12, color: "#9CA3AF", fontSize: 13 }} colSpan={2}>No data yet</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* TASK LAUNCHER RANKING */}
        <div style={S.card}>
          <div style={S.sectionLabel}>Task Launcher Ranking</div>
          {stats.taskLauncherUsage.length === 0 ? (
            <p style={{ color: "#9CA3AF", fontSize: 13 }}>No task launcher usage yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {stats.taskLauncherUsage.map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", width: 20, textAlign: "right", flexShrink: 0 }}>#{i + 1}</span>
                  <span style={{ fontSize: 13, color: "#374151", minWidth: 200, flex: 1 }}>{t.label}</span>
                  <div style={{ flex: 2, height: 10, background: "#F3F4F6", borderRadius: 5, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${Math.round((t.count / maxTask) * 100)}%`, background: "#C8963E", borderRadius: 5, transition: "width 0.3s" }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", width: 36, textAlign: "right", flexShrink: 0 }}>{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* UNMATCHED DOMAIN REGISTRATIONS TABLE */}
        <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", border: "1.5px solid #DC2626", overflow: "hidden" }}>
          <div style={{ padding: "16px 24px 12px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #FEE2E2" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#DC2626", flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 600, color: "#374151" }}>
              Total: {unmatchedUsers.length} — users registered without a recognized domain
            </span>
          </div>
          <div style={S.scrollWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <TH label="Email" />
                  <TH label="Domain" />
                  <TH label="County" />
                  <TH label="Service Category" />
                  <TH label="Registered" />
                  <TH label="Connection Explanation" />
                </tr>
              </thead>
              <tbody>
                {unmatchedUsers.map((u) => (
                  <tr key={u.id}>
                    <TD>{u.email}</TD>
                    <TD><span style={{ fontFamily: "monospace", fontSize: 12 }}>{getDomain(u.email)}</span></TD>
                    <TD>{u.county}</TD>
                    <TD>{u.serviceCategory}</TD>
                    <TD>{fmt(u.createdAt)}</TD>
                    <TD style={{ color: u.domainNote ? "#374151" : "#9CA3AF", fontStyle: u.domainNote ? "normal" : "italic" }}>{u.domainNote || "—"}</TD>
                  </tr>
                ))}
                {unmatchedUsers.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No unmatched domain registrations</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ALL USERS TABLE */}
        <div style={S.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
            <div style={S.sectionLabel}>
              {filteredUsers.length < users.length
                ? `Showing ${filteredUsers.length} of ${users.length} users`
                : `Total Users: ${users.length}`}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              <input
                type="text"
                placeholder="Search by email..."
                value={searchEmail}
                onChange={(e) => setSearchEmail(e.target.value)}
                style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827", width: 200 }}
              />
              <select value={filterCounty} onChange={(e) => setFilterCounty(e.target.value)} style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827", background: "#fff" }}>
                <option value="">All Counties</option>
                {counties.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} style={{ border: "1px solid #D1D5DB", borderRadius: 6, padding: "7px 12px", fontSize: 13, color: "#111827", background: "#fff" }}>
                <option value="">All Categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div style={S.scrollWrap}>
            <table style={S.table}>
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
                    <TD>{fmt(u.createdAt)}</TD>
                    <TD>{fmtShort(u.lastActive)}</TD>
                    <TD style={{ textAlign: "center" }}>{u.conversationCount}</TD>
                    <TD>
                      {u.domainMatch
                        ? <span style={{ background: "#D1FAE5", color: "#065F46", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>Yes</span>
                        : <span style={{ background: "#FEE2E2", color: "#991B1B", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>No</span>}
                    </TD>
                    <TD>
                      <ToggleSwitch enabled={!u.disabled} onChange={(v) => handleToggleDisabled(u.id, !v)} />
                    </TD>
                  </tr>
                ))}
                {sortedUsers.length === 0 && (
                  <tr><td colSpan={9} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No users match your filters</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* FEEDBACK TABLE */}
        <div style={S.card}>
          <div style={{ ...S.sectionLabel, marginBottom: 6 }}>Feedback</div>
          <div style={{ fontSize: 13, color: "#6B7280", marginBottom: 14 }}>Total Entries: {feedback.length}</div>
          <div style={S.scrollWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <TH label="Date" />
                  <TH label="User Email" />
                  <TH label="Type" />
                  <TH label="What They Were Trying To Do" />
                  <TH label="File Size" />
                </tr>
              </thead>
              <tbody>
                {feedback.map((f) => (
                  <tr key={f.id}>
                    <TD style={{ whiteSpace: "nowrap" }}>{fmt(f.createdAt)}</TD>
                    <TD style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.userEmail}</TD>
                    <TD>
                      <span style={{ background: "#FEF3C7", color: "#92400E", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 10 }}>
                        {f.feedbackType.replace(/_/g, " ")}
                      </span>
                    </TD>
                    <TD style={{ color: f.detail ? "#374151" : "#9CA3AF", fontStyle: f.detail ? "normal" : "italic" }}>{f.detail || "—"}</TD>
                    <TD>{f.attemptedFileSize ? `${(f.attemptedFileSize / 1024 / 1024).toFixed(1)} MB` : "—"}</TD>
                  </tr>
                ))}
                {feedback.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>No feedback entries yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>
    </div>
  );
}

function StatCard({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 10, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", padding: "20px 24px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: "#111827", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function ToggleSwitch({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      style={{ width: 42, height: 24, borderRadius: 12, background: enabled ? "#16A34A" : "#D1D5DB", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0, padding: 0 }}
      title={enabled ? "Active — click to disable" : "Disabled — click to enable"}
    >
      <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: enabled ? 21 : 3, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
    </button>
  );
}
