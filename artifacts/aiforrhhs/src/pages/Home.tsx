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
  "Child Welfare / CPS",
  "Adult Protective Services",
  "Eligibility & Benefits",
  "In-Home Supportive Services (IHSS)",
  "Behavioral Health",
  "Public Health",
  "Housing & Homeless Services",
  "Administrative / Operations",
  "Other"
];

const registerSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(5, { message: "Password must be at least 5 characters" }),
  county: z.string().min(1, { message: "Please select a county" }),
  serviceCategory: z.string().min(1, { message: "Please select a category" }),
  domainNote: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, { message: "Password is required" }),
});

export default function Home() {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading: isUserLoading } = useGetMe({ query: { retry: false } });
  const [mode, setMode] = useState<"register" | "login">("register");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const loginMutation = useLogin();
  const registerMutation = useRegister();

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", county: "", serviceCategory: "", domainNote: "" },
  });

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (user && !isUserLoading) {
      setLocation("/chat");
    }
  }, [user, isUserLoading, setLocation]);

  if (isUserLoading) {
    return <div className="min-h-screen bg-navy flex items-center justify-center"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>;
  }

  const isDomainMatch = (email: string) => {
    if (!email) return true;
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return true;
    return domain.endsWith('.gov') || domain.endsWith('.ca.gov') || domain.endsWith('.ca.us') || domain.endsWith('.org') || domain.endsWith('.edu');
  };

  const watchEmail = registerForm.watch("email");
  const watchCategory = registerForm.watch("serviceCategory");
  const showDomainNote = !isDomainMatch(watchEmail);

  const onRegister = (values: z.infer<typeof registerSchema>) => {
    registerMutation.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/chat");
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Registration failed", description: err?.message || "An error occurred." });
      }
    });
  };

  const onLogin = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        setLocation("/chat");
      },
      onError: (err: any) => {
        toast({ variant: "destructive", title: "Login failed", description: err?.message || "Invalid credentials." });
      }
    });
  };

  return (
    <div className="min-h-screen bg-sidebar text-foreground flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="font-serif text-4xl text-primary font-bold tracking-tight">AIforHHS</h1>
        </div>

        <div className="px-4 py-4 rounded-lg border border-primary/40 bg-primary/10 text-center">
          <p className="font-sans text-sm font-semibold text-white leading-snug">
            AIforHHS never stores your conversations. Avoid entering client names, case numbers, or other identifying information.
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
                            {COUNTIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
                            {SERVICE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
                          <FormLabel className="text-card-foreground">Connection to County HHS</FormLabel>
                          <FormControl>
                            <Input placeholder="Briefly describe your role" className="text-foreground bg-background" {...field} data-testid="input-domain-note" />
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
              <Form {...loginForm}>
                <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
                  <FormField
                    control={loginForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">Work Email</FormLabel>
                        <FormControl>
                          <Input placeholder="name@county.ca.gov" className="text-foreground bg-background" {...field} data-testid="input-login-email" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={loginForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-card-foreground">Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" className="text-foreground bg-background" {...field} data-testid="input-login-password" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="text-right">
                     <button type="button" className="text-sm text-primary hover:underline" data-testid="btn-forgot-password">Forgot password?</button>
                  </div>
                  <Button type="submit" className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={loginMutation.isPending} data-testid="btn-login">
                    {loginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Log In
                  </Button>
                </form>
              </Form>
              <div className="text-center text-sm">
                <button type="button" onClick={() => setMode("register")} className="text-primary hover:underline" data-testid="btn-switch-register">
                  Need an account? Register
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="text-center text-xs text-muted-foreground/60">
          Built by IQmeetEQ
        </div>
      </div>
    </div>
  );
}
