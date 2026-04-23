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
  const [mode, setMode] = useState<"register" | "login">("register");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

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
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/chat");
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
                  <button type="button" className="text-sm text-primary hover:underline" data-testid="btn-forgot-password">Forgot password?</button>
                </div>
                <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={loginMutation.isPending} data-testid="btn-login">
                  {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Log In
                </Button>
              </form>
              <div className="text-center text-sm">
                <button type="button" onClick={() => setMode("register")} className="text-primary hover:underline" data-testid="btn-switch-register">
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
