import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useGetMe, useLogin, useRegister, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const COUNTIES = [
  "Alameda", "Alpine", "Amador", "Butte", "Calaveras", "Colusa", "Contra Costa", "Del Norte", "El Dorado",
  "Fresno", "Glenn", "Humboldt", "Imperial", "Inyo", "Kern", "Kings", "Lake", "Lassen", "Los Angeles",
  "Madera", "Marin", "Mariposa", "Mendocino", "Merced", "Modoc", "Mono", "Monterey", "Napa", "Nevada",
  "Orange", "Placer", "Plumas", "Riverside", "Sacramento", "San Benito", "San Bernardino", "San Diego",
  "San Francisco", "San Joaquin", "San Luis Obispo", "San Mateo", "Santa Barbara", "Santa Clara", "Santa Cruz",
  "Shasta", "Sierra", "Siskiyou", "Solano", "Sonoma", "Stanislaus", "Sutter", "Tehama", "Trinity", "Tulare",
  "Tuolumne", "Ventura", "Yolo", "Yuba"
];

const SERVICE_CATEGORIES = [
  "Child Support Services",
  "Child Welfare / CPS",
  "Adult Protective Services",
  "Eligibility & Benefits",
  "In-Home Supportive Services (IHSS)",
  "Behavioral Health",
  "Primary Health Services",
  "Public Health",
  "Housing & Homeless Services",
  "Administrative / Operations",
  "Other"
];

function isDomainMatch(email: string): boolean {
  if (!email) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return true;
  return (
    domain.endsWith(".gov") ||
    domain.endsWith(".ca.gov") ||
    domain.endsWith(".ca.us") ||
    domain.endsWith(".org") ||
    domain.endsWith(".edu")
  );
}

const registerSchema = z
  .object({
    email: z.string().email({ message: "Invalid email address" }),
    password: z.string().min(5, { message: "Password must be at least 5 characters" }),
    county: z.string().min(1, { message: "Please select a county" }),
    serviceCategory: z.string().min(1, { message: "Please select a category" }),
    domainNote: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!isDomainMatch(data.email)) {
      const note = data.domainNote?.trim() ?? "";
      if (note.length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please tell us a bit more about your connection (at least 10 characters).",
          path: ["domainNote"],
        });
      }
    }
  });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, { message: "Password is required" }),
});

export default function Home() {
  const [, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading } = useGetMe({ query: { retry: false } });
  const [mode, setMode] = useState<"register" | "login">("login");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  // Forgot-password modal state
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotCounty, setForgotCounty] = useState("");
  const [forgotCategory, setForgotCategory] = useState("");
  const [forgotError, setForgotError] = useState("");
  const [forgotInfo, setForgotInfo] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [supportEmail, setSupportEmail] = useState("anthony@iqmeeteq.com");

  useEffect(() => {
    fetch("/api/auth/support-email")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.supportEmail) setSupportEmail(d.supportEmail); })
      .catch(() => {});
  }, []);

  const openForgot = () => {
    setForgotOpen(true);
    setForgotStep(1);
    setForgotEmail(loginEmail);
    setForgotCounty("");
    setForgotCategory("");
    setForgotError("");
    setForgotInfo("");
  };

  const closeForgot = () => {
    if (forgotSubmitting) return;
    setForgotOpen(false);
  };

  const submitForgotStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(forgotEmail.trim())) {
      setForgotError("Please enter a valid email address.");
      return;
    }
    setForgotStep(2);
  };

  const submitForgotStep2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotError("");
    setForgotInfo("");
    if (!forgotCounty || !forgotCategory) {
      setForgotError("Please select your county and service category.");
      return;
    }
    setForgotSubmitting(true);
    try {
      const res = await fetch("/api/auth/forgot-password/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim(), county: forgotCounty, serviceCategory: forgotCategory }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        setLocation(`/reset-password?token=${encodeURIComponent(data.token)}`);
        return;
      }
      if (res.status === 429) {
        setForgotError(`Too many failed attempts. Please contact ${supportEmail} for help.`);
      } else {
        setForgotError(`We couldn't verify those details. If you keep having trouble, contact ${supportEmail}.`);
      }
    } catch {
      setForgotError(`Something went wrong. Please try again or contact ${supportEmail}.`);
    }
    setForgotSubmitting(false);
  };

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", county: "", serviceCategory: "", domainNote: "" },
  });

  useEffect(() => {
    if (user && !isUserLoading) {
      setLocation("/chat");
    }
  }, [user, isUserLoading, setLocation]);

  if (isUserLoading) {
    return <div className="min-h-screen bg-navy flex items-center justify-center"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>;
  }

  const watchEmail = registerForm.watch("email");
  const showDomainNote = !isDomainMatch(watchEmail);

  const onRegister = (values: z.infer<typeof registerSchema>) => {
    registerMutation.mutate({ data: values }, {
      onSuccess: () => {
        setLoginEmail(values.email);
        setMode("login");
        toast({ title: "Account created!", description: "Please log in with your new credentials." });
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Registration failed", description: err?.message || "An error occurred." });
      },
    });
  };

  const onLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    if (!loginEmail || !loginPassword) {
      setLoginError("Email and password are required.");
      return;
    }
    loginMutation.mutate({ data: { email: loginEmail, password: loginPassword } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/chat");
      },
      onError: (err: any) => {
        setLoginError(err?.message || "Invalid credentials.");
        toast({ variant: "destructive", title: "Login failed", description: err?.message || "Invalid credentials." });
      },
    });
  };

  return (
    <div className="min-h-screen bg-sidebar text-foreground flex flex-col items-center justify-center p-4" style={{ position: "relative" }}>
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="font-serif text-4xl text-primary font-bold tracking-tight">AI for HHS</h1>
        </div>

        <div className="px-4 py-4 rounded-lg border border-primary/40 bg-primary/10 text-center">
          <p className="font-sans text-sm font-semibold text-white leading-snug">
            AI for HHS never stores your conversations. Avoid entering client names, case numbers, or other identifying information.
          </p>
        </div>

        <div className="bg-card p-6 rounded-lg shadow-lg border border-border">
          {mode === "register" ? (
            <div className="space-y-6">
              <Form {...registerForm}>
                <form onSubmit={registerForm.handleSubmit(onRegister)} className="space-y-4">
                  <FormField
                    control={registerForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">Work Email</FormLabel>
                        <FormControl>
                          <Input placeholder="name@county.ca.gov" className="text-foreground bg-background" {...field} data-testid="input-register-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" className="text-foreground bg-background" {...field} data-testid="input-register-password" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="county"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">County</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="text-foreground bg-background" data-testid="select-county">
                              <SelectValue placeholder="Select your county" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent position="popper" className="max-h-64 overflow-y-auto">
                            {COUNTIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="serviceCategory"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">Service Category</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger className="text-foreground bg-background" data-testid="select-category">
                              <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent position="popper" className="max-h-64 overflow-y-auto">
                            {SERVICE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {showDomainNote && (
                    <FormField
                      control={registerForm.control}
                      name="domainNote"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-card-foreground">Tell us about your connection to county HHS</FormLabel>
                          <FormControl>
                            <textarea
                              placeholder="Briefly describe your role or connection (e.g., I'm a contractor supporting Sacramento DHSS...)"
                              className="flex w-full rounded-md border border-gray-300 bg-background px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                              rows={3}
                              data-testid="input-domain-note"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={registerMutation.isPending} data-testid="btn-register">
                    {registerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Register
                  </Button>
                </form>
              </Form>
              <div className="text-center text-sm">
                <button type="button" onClick={() => setMode("login")} className="text-primary hover:underline" data-testid="btn-switch-login">
                  Already have an account? Log in
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <form onSubmit={onLogin} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-card-foreground" htmlFor="login-email">Work Email</label>
                  <input
                    id="login-email"
                    type="email"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="name@county.ca.gov"
                    autoComplete="email"
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium text-card-foreground" htmlFor="login-password">Password</label>
                  <input
                    id="login-password"
                    type="password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="flex h-9 w-full rounded-md border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 shadow-sm placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    data-testid="input-login-password"
                  />
                </div>
                {loginError && <p className="text-sm text-destructive">{loginError}</p>}
                <div className="text-right">
                  <button type="button" onClick={openForgot} className="text-sm text-primary hover:underline" data-testid="btn-forgot-password">Forgot password?</button>
                </div>
                <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={loginMutation.isPending} data-testid="btn-login">
                  {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Log In
                </Button>
              </form>
              <div className="text-center" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#C8963E",
                    fontSize: 16,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    padding: "4px 8px",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.textDecoration = "underline")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.textDecoration = "none")}
                  data-testid="btn-switch-register"
                >
                  Need an account? Register
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="text-center text-xs text-muted-foreground/60">
          Built by <a href="https://headandheartca.com" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }} onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")} onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}>IQmeetEQ</a>
        </div>
      </div>

      {/* Forgot password modal */}
      {forgotOpen && (
        <div
          onClick={closeForgot}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
          data-testid="forgot-password-modal"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "#fff", borderRadius: 12, padding: "28px 32px", maxWidth: 460, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
          >
            <h2 style={{ fontFamily: "'DM Serif Display', serif", fontSize: 24, color: "#1A2744", margin: "0 0 6px" }}>Reset your password</h2>
            <p style={{ fontSize: 13, color: "#6B7280", margin: "0 0 18px", lineHeight: 1.5 }}>
              {forgotStep === 1
                ? "Enter the email associated with your account."
                : "Confirm your county and service category to verify your identity."}
            </p>

            {forgotStep === 1 ? (
              <form onSubmit={submitForgotStep1} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>Email</label>
                  <input
                    type="email"
                    autoFocus
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="name@county.ca.gov"
                    style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: "#111827", boxSizing: "border-box" }}
                    data-testid="input-forgot-email"
                  />
                </div>
                {forgotError && <div style={{ fontSize: 13, color: "#DC2626" }}>{forgotError}</div>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                  <button type="button" onClick={closeForgot} style={{ background: "#fff", color: "#4B5563", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 18px", fontSize: 14, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-forgot-cancel">Cancel</button>
                  <button type="submit" style={{ background: "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-forgot-next">Next</button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitForgotStep2} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ fontSize: 12, color: "#6B7280", padding: "8px 12px", background: "#F9FAFB", borderRadius: 6, border: "1px solid #E5E7EB" }}>
                  <strong style={{ color: "#374151" }}>{forgotEmail}</strong>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>County</label>
                  <select
                    value={forgotCounty}
                    onChange={(e) => setForgotCounty(e.target.value)}
                    style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: forgotCounty ? "#111827" : "#9CA3AF", background: "#fff", boxSizing: "border-box" }}
                    data-testid="select-forgot-county"
                  >
                    <option value="">Select your county…</option>
                    {COUNTIES.map((c) => <option key={c} value={c} style={{ color: "#111827" }}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#374151", marginBottom: 6 }}>Service category</label>
                  <select
                    value={forgotCategory}
                    onChange={(e) => setForgotCategory(e.target.value)}
                    style={{ width: "100%", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 12px", fontSize: 14, color: forgotCategory ? "#111827" : "#9CA3AF", background: "#fff", boxSizing: "border-box" }}
                    data-testid="select-forgot-category"
                  >
                    <option value="">Select your category…</option>
                    {SERVICE_CATEGORIES.map((c) => <option key={c} value={c} style={{ color: "#111827" }}>{c}</option>)}
                  </select>
                </div>
                {forgotError && <div style={{ fontSize: 13, color: "#DC2626" }} data-testid="text-forgot-error">{forgotError}</div>}
                {forgotInfo && <div style={{ fontSize: 13, color: "#0369A1" }}>{forgotInfo}</div>}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 4 }}>
                  <button type="button" onClick={() => setForgotStep(1)} disabled={forgotSubmitting} style={{ background: "#fff", color: "#4B5563", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 18px", fontSize: 14, cursor: forgotSubmitting ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-forgot-back">Back</button>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" onClick={closeForgot} disabled={forgotSubmitting} style={{ background: "#fff", color: "#4B5563", border: "1px solid #D1D5DB", borderRadius: 6, padding: "9px 18px", fontSize: 14, cursor: forgotSubmitting ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                    <button type="submit" disabled={forgotSubmitting} style={{ background: forgotSubmitting ? "#9CA3AF" : "#1A2744", color: "#fff", border: "none", borderRadius: 6, padding: "9px 18px", fontSize: 14, fontWeight: 600, cursor: forgotSubmitting ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif" }} data-testid="btn-forgot-verify">
                      {forgotSubmitting ? "Verifying…" : "Verify & continue"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Subtle gear icon — bottom-right corner, admin entry point */}
      <a
        href="/admin"
        title="Admin"
        style={{
          position: "fixed",
          bottom: 18,
          right: 20,
          opacity: 0.18,
          color: "#9CA3AF",
          textDecoration: "none",
          transition: "opacity 0.2s",
          lineHeight: 1,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.55")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.18")}
        data-testid="btn-admin-gear"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </a>
    </div>
  );
}
