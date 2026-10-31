import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  FolderKanban,
  ListChecks,
  MessageSquare,
  SearchCheck,
  Shield,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { requireDashboardModerator } from '@/lib/auth/guard';
import { getOverviewDashboardData } from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const moderator = await requireDashboardModerator();
  const { serverSettings, categories, activeSessions, botOnline } =
    await getOverviewDashboardData(moderator.guildId);

  const enabledCategories = categories.filter((c) => c.enabled);
  const metrics = serverSettings.operationalMetrics;
  const totalTokens =
    metrics.groqPromptTokensTotal + metrics.groqCompletionTokensTotal;

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/70 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
              {serverSettings.guildName}
            </h1>
            <span className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary">
              v{serverSettings.configVersion}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Intelligent front-desk ticket assistant & community intake observer.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
              botOnline
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            }`}
          >
            <span className="relative flex h-2 w-2">
              {botOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2 w-2 rounded-full ${
                  botOnline ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </span>
            <span>{botOnline ? 'Worker Live' : 'Worker Offline'}</span>
          </div>

          <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
              serverSettings.botEnabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border/60 bg-secondary/50 text-muted-foreground'
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            <span>{serverSettings.botEnabled ? 'Assistant Active' : 'Assistant Paused'}</span>
          </div>
        </div>
      </div>

      {/* Quick Access Action Banners */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card to-card/60 p-6 backdrop-blur-md transition-all hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Identity & Brain</span>
              </div>
              <h3 className="text-lg font-bold text-foreground">Server Details & Bot Persona</h3>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm">
                Define your community overview, rules, expected response times, welcome greeting, and
                conversational tone.
              </p>
            </div>
            <Button asChild size="sm" className="shrink-0 font-medium">
              <Link href="/server-info">Configure Persona</Link>
            </Button>
          </div>
        </div>

        <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card to-card/60 p-6 backdrop-blur-md transition-all hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/5">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-2.5 py-1 text-xs font-semibold text-indigo-400">
                <ListChecks className="h-3.5 w-3.5" />
                <span>Custom Questions</span>
              </div>
              <h3 className="text-lg font-bold text-foreground">Questionnaire Builder</h3>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-sm">
                Design custom community onboarding questions (activity, goals, vibe, availability) with
                one-click presets.
              </p>
            </div>
            <Button asChild variant="outline" size="sm" className="shrink-0 font-medium border-border/70 hover:bg-secondary/60">
              <Link href="/questions">Edit Questions</Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border/70 bg-card/60 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active Sessions</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{activeSessions.length}</span>
            <span className="text-xs text-muted-foreground">live tickets</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {metrics.sessionsCleanedUp} closed tickets auto-purged
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active Categories</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400">
              <FolderKanban className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{enabledCategories.length}</span>
            <span className="text-xs text-muted-foreground">/ {categories.length} configured</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Non-enabled categories ignored
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Engine Throughput</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Bot className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{metrics.groqRequestsTotal.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">AI calls</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground truncate" title={`${totalTokens.toLocaleString()} tokens`}>
            {totalTokens.toLocaleString()} tokens ({serverSettings.aiSettings.model})
          </p>
        </div>

        <div className="rounded-xl border border-border/70 bg-card/60 p-5 backdrop-blur-md">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Intake Reports</p>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <SearchCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-foreground">{metrics.reportsDelivered.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground">delivered to staff</span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Delivered to confidential mod channel
          </p>
        </div>
      </div>

      {/* Live Ticket Sessions Table */}
      <Card className="border-border/70 bg-card/60 backdrop-blur-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-foreground">Real-Time Ticket Sessions</CardTitle>
            <CardDescription className="text-xs">
              Live isolated conversational sessions. Raw transcripts are securely auto-purged on ticket closure.
            </CardDescription>
          </div>
          <span className="rounded-full bg-secondary/60 px-2.5 py-1 text-xs font-mono text-muted-foreground">
            {activeSessions.length} active
          </span>
        </CardHeader>
        <CardContent>
          {activeSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary/50 text-muted-foreground mb-3">
                <MessageSquare className="h-6 w-6" />
              </div>
              <p className="text-sm font-semibold text-foreground">No active ticket sessions</p>
              <p className="mt-1 text-xs text-muted-foreground max-w-sm">
                When a member opens a ticket in an enabled Discord category, the assistant will greet them and appear here live.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border/70 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="pb-3 font-semibold">Channel</th>
                    <th className="pb-3 font-semibold">Category</th>
                    <th className="pb-3 font-semibold">Session Status</th>
                    <th className="pb-3 font-semibold">Config Snapshot</th>
                    <th className="pb-3 font-semibold">Opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {activeSessions.map((s) => {
                    const statusColor =
                      s.status === 'ready_for_review'
                        ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                        : s.status === 'human_handoff'
                          ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                          : 'border-primary/30 text-primary bg-primary/10';

                    return (
                      <tr key={s.id} className="hover:bg-secondary/20 transition-colors">
                        <td className="py-3 font-mono text-foreground flex items-center gap-1.5">
                          <span className="text-muted-foreground">#</span>
                          <span>{s.channelId}</span>
                          {s.isThread && (
                            <span className="rounded bg-secondary px-1 text-[10px] text-muted-foreground">Thread</span>
                          )}
                        </td>
                        <td className="py-3 font-medium text-foreground">{s.categoryName}</td>
                        <td className="py-3">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusColor}`}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            <span>{s.status.replace(/_/g, ' ')}</span>
                          </span>
                        </td>
                        <td className="py-3 font-mono text-muted-foreground">v{s.configVersion}</td>
                        <td className="py-3 text-muted-foreground">{new Date(s.openedAt).toLocaleTimeString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Safety & Lifecycle Summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-border/70 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="h-4 w-4 text-primary" />
              <span>Permission Guard & Safety Boundaries</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Hardware-level least-privilege token boundary enforcement.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                <strong>Zero Channel Mutations:</strong> The bot operates strictly on read/send permissions. It cannot delete, close, lock, or rename channels.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                <strong>Single Opener Tracking:</strong> Exactly one user is identified as the ticket opener; staff speaking in tickets are never mistaken for ticket applicants.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p>
                <strong>Automatic Closure Purge:</strong> When your existing ticket bot closes the ticket, all temporary transcripts and session records are deleted from Supabase.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span>Operational Health Logs</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Sanitized operational error telemetry (never contains user message text).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.recentErrors.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span>All operational subsystems running healthy. No errors recorded.</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {metrics.recentErrors.slice(0, 5).map((err, idx) => (
                  <div key={idx} className="rounded-lg border border-border/70 bg-secondary/30 p-2.5 text-xs">
                    <div className="flex justify-between font-medium">
                      <span className="text-foreground">
                        [{err.code}] {err.component}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{err.timestamp}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground text-[11px]">{err.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

