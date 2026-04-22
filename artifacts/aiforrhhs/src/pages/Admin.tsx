import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { setAdminAuthenticated } from "@/lib/adminAuth";
import { 
  useGetAdminStats, 
  useGetAdminUsers, 
  useGetAdminFeedback, 
  useGetAdminConfig,
  useUpdateAdminConfig,
  getGetAdminConfigQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogOut, TrendingUp, Users, MessageSquare, AlertCircle, ThumbsUp, ThumbsDown } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default function Admin() {
  const [location, setLocation] = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const auth = sessionStorage.getItem("adminAuth");
    if (auth === "true") {
      setAdminAuthenticated(true);
      setIsAuthenticated(true);
    }
    setIsCheckingAuth(false);
  }, []);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onLogin = (values: z.infer<typeof loginSchema>) => {
    if (values.email === "anthony@iqmeeteq.com" && values.password === "95682") {
      sessionStorage.setItem("adminAuth", "true");
      setAdminAuthenticated(true);
      setIsAuthenticated(true);
    } else {
      toast({ variant: "destructive", title: "Access Denied", description: "Invalid admin credentials." });
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("adminAuth");
    setAdminAuthenticated(false);
    setIsAuthenticated(false);
  };

  if (isCheckingAuth) {
    return <div className="min-h-screen bg-sidebar flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-sidebar flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-card p-8 rounded-lg shadow-xl border border-border">
          <div className="text-center mb-8">
            <h1 className="font-serif text-3xl font-bold text-card-foreground">Admin Portal</h1>
            <p className="text-muted-foreground mt-2">Sign in to access the AIforHHS dashboard</p>
          </div>
          <Form {...loginForm}>
            <form onSubmit={loginForm.handleSubmit(onLogin)} className="space-y-4">
              <FormField
                control={loginForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="admin@example.com" {...field} data-testid="input-admin-email" />
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
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} data-testid="input-admin-password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" data-testid="btn-admin-login">Log In</Button>
            </form>
          </Form>
        </div>
      </div>
    );
  }

  return <AdminDashboard onLogout={handleLogout} />;
}

function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { data: stats, isLoading: statsLoading } = useGetAdminStats({ query: { retry: false } });
  const { data: users, isLoading: usersLoading } = useGetAdminUsers({ query: { retry: false } });
  const { data: feedback, isLoading: feedbackLoading } = useGetAdminFeedback({ query: { retry: false } });
  const { data: config, isLoading: configLoading } = useGetAdminConfig({ query: { retry: false } });
  
  const updateConfig = useUpdateAdminConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleConfigUpdate = (key: string, value: any) => {
    updateConfig.mutate({ data: { [key]: value } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAdminConfigQueryKey() });
        toast({ title: "Settings updated", description: "The configuration has been saved." });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Error", description: "Failed to update configuration." });
      }
    });
  };

  const isLoading = statsLoading || usersLoading || feedbackLoading || configLoading;

  if (isLoading || !stats || !users || !feedback || !config) {
    return <div className="min-h-screen bg-sidebar flex items-center justify-center"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-sidebar">
      <header className="bg-sidebar text-white px-6 py-4 flex items-center justify-between shadow-sm">
        <h1 className="font-serif text-2xl font-bold tracking-tight">AIforHHS <span className="text-primary font-sans text-sm ml-2 font-normal uppercase tracking-wider">Admin</span></h1>
        <Button variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent" onClick={onLogout} data-testid="btn-admin-logout">
          <LogOut className="w-4 h-4 mr-2" /> Sign Out
        </Button>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Users</CardTitle>
              <Users className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalUsers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Conversations</CardTitle>
              <MessageSquare className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalConversations}</div>
              <p className="text-xs text-muted-foreground mt-1">{stats.avgMessagesPerConversation.toFixed(1)} avg. messages per chat</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">API Spend (MTD)</CardTitle>
              <TrendingUp className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${stats.currentMonthSpend.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground mt-1">Threshold: ${stats.spendThreshold}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Unmatched Domains</CardTitle>
              <AlertCircle className="w-4 h-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats.unmatchedDomainCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Requires review</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="bg-white border border-border w-full justify-start h-auto p-1">
            <TabsTrigger value="overview" className="data-[state=active]:bg-primary data-[state=active]:text-white">Overview</TabsTrigger>
            <TabsTrigger value="users" className="data-[state=active]:bg-primary data-[state=active]:text-white">Users</TabsTrigger>
            <TabsTrigger value="feedback" className="data-[state=active]:bg-primary data-[state=active]:text-white">Feedback</TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-primary data-[state=active]:text-white">Settings</TabsTrigger>
          </TabsList>
          
          <TabsContent value="overview" className="space-y-4 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Top Counties</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>County</TableHead>
                        <TableHead className="text-right">Users</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.usersByCounty.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell>{c.label}</TableCell>
                          <TableCell className="text-right font-medium">{c.count}</TableCell>
                        </TableRow>
                      ))}
                      {stats.usersByCounty.length === 0 && (
                        <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No data available</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Task Launcher Usage</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.taskLauncherUsage.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell className="max-w-[200px] truncate" title={t.label}>{t.label}</TableCell>
                          <TableCell className="text-right font-medium">{t.count}</TableCell>
                        </TableRow>
                      ))}
                      {stats.taskLauncherUsage.length === 0 && (
                        <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground">No data available</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                  
                  <div className="mt-8">
                    <h4 className="text-sm font-medium mb-4">Response Ratings</h4>
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center">
                          <ThumbsUp className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xl font-bold">{stats.thumbsUpCount}</div>
                          <div className="text-xs text-muted-foreground">Helpful</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-red-100 text-red-700 flex items-center justify-center">
                          <ThumbsDown className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xl font-bold">{stats.thumbsDownCount}</div>
                          <div className="text-xs text-muted-foreground">Not Helpful</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="users" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Registered Users</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>County</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Domain Match</TableHead>
                      <TableHead>Registered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.email}</TableCell>
                        <TableCell>{u.county}</TableCell>
                        <TableCell>{u.serviceCategory}</TableCell>
                        <TableCell>
                          {u.domainMatch ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Yes</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 w-fit">No</span>
                              {u.domainNote && <span className="text-xs text-muted-foreground italic truncate max-w-[150px]" title={u.domainNote}>{u.domainNote}</span>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                    {users.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No users found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="feedback" className="mt-6">
             <Card>
              <CardHeader>
                <CardTitle>User Feedback</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {feedback.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium capitalize">{f.feedbackType.replace(/_/g, ' ')}</TableCell>
                        <TableCell>{f.detail || "-"}</TableCell>
                        <TableCell>{new Date(f.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                    {feedback.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">No feedback found</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="mt-6">
             <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle>System Configuration</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Active AI Model</label>
                  <Select 
                    value={config.activeModel} 
                    onValueChange={(val) => handleConfigUpdate("activeModel", val)}
                  >
                    <SelectTrigger data-testid="select-model">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Sonnet 4.6">Sonnet 4.6 (Default)</SelectItem>
                      <SelectItem value="Opus 4.6">Opus 4.6 (High capability, higher cost)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Select the model used for new conversations.</p>
                </div>

                <div className="space-y-2 pt-4">
                  <label className="text-sm font-medium">Monthly Spend Threshold ($)</label>
                  <div className="flex items-center gap-3">
                    <Input 
                      type="number" 
                      defaultValue={config.spendThreshold}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val !== config.spendThreshold) {
                          handleConfigUpdate("spendThreshold", val);
                        }
                      }}
                      data-testid="input-threshold"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">System will automatically downgrade to Sonnet when this threshold is reached to control costs.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
