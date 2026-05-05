import { useState, useEffect } from "react";
import { useLocation } from "wouter";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string>("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [supportEmail, setSupportEmail] = useState("anthony@iqmeeteq.com");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") ?? "";
    setToken(t);
    if (!t) setError("This reset link is missing its token. Please request a new one.");
  }, []);

  useEffect(() => {
    fetch("/api/auth/support-email")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.supportEmail) setSupportEmail(d.supportEmail); })
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 5) { setError("Password must be at least 5 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (!token) { setError("Missing reset token."); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || `That reset link isn't valid or has expired. Contact ${supportEmail} for a new one.`);
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => setLocation("/"), 2200);
    } catch {
      setError(`Something went wrong. Please try again or contact ${supportEmail}.`);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-sidebar text-foreground flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="font-serif text-4xl text-primary font-bold tracking-tight">AI for HHS</h1>
        </div>

        <div className="bg-card p-6 rounded-lg shadow-lg border border-border">
          <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 22, color: "#1A2744", margin: "0 0 8px" }}>Set a new password</h2>
          <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 18px", lineHeight: 1.5 }}>
            Choose a strong password you don't use elsewhere. Minimum 5 characters.
          </p>

          {success ? (
            <div data-testid="text-reset-success" style={{ padding: "14px 16px", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 8, color: "#065F46", fontSize: 14, lineHeight: 1.5 }}>
              <strong>Password updated.</strong> Redirecting you to the login page…
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>New password</label>
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: "#111827", boxSizing: "border-box" }}
                  data-testid="input-new-password"
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>Confirm new password</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: "#111827", boxSizing: "border-box" }}
                  data-testid="input-confirm-password"
                />
              </div>
              {error && <div style={{ fontSize: 13, color: "#DC2626" }} data-testid="text-reset-error">{error}</div>}
              <button
                type="submit"
                disabled={submitting || !token}
                style={{ background: (submitting || !token) ? "#9CA3AF" : "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "10px 18px", fontSize: 14, fontWeight: 600, cursor: (submitting || !token) ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }}
                data-testid="btn-submit-reset"
              >
                {submitting ? "Updating…" : "Update password"}
              </button>
              <div style={{ textAlign: "center", marginTop: 4 }}>
                <button type="button" onClick={() => setLocation("/")} style={{ background: "none", border: "none", color: "#1A2744", fontSize: 13, cursor: "pointer", textDecoration: "underline", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-back-to-login">
                  Back to login
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
