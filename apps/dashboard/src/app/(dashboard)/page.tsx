import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  FolderKanban,
  SearchCheck,
  Shield,
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {serverSettings.guildName} — Assistant Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Conversational AI observer working alongside your existing ticket-management bot.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={botOnline ? 'success' : 'secondary'}>
            {botOnline ? 'Bot Worker Online' : 'Bot Worker Offline / No Recent Heartbeat'}
          </Badge>
          <Badge variant={serverSettings.botEnabled ? 'default' : 'outline'}>
            {serverSettings.botEnabled ? 'AI Assistant Enabled' : 'AI Assistant Paused'}
          </Badge>
        </div>
      </div>

      {/* Primary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active AI Sessions</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeSessions.length}</div>
            <p className="text-xs text-muted-foreground">
              {metrics.sessionsCleanedUp} closed tickets auto-purged
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Enabled Categories</CardTitle>
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {enabledCategories.length}{' '}
              <span className="text-sm font-normal text-muted-foreground">
                / {categories.length}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Disabled categories strictly ignored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Groq API Usage</CardTitle>
            <Bot className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.groqRequestsTotal.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalTokens.toLocaleString()} total tokens ({serverSettings.aiSettings.model})
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Player Data Lookups</CardTitle>
            <SearchCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.playerLookupsSucceeded.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.playerLookupsFailed} failed/timed out • {metrics.reportsDelivered} staff
              reports sent
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Active Ticket Sessions Status (No Private Transcripts!) */}
        <Card>
          <CardHeader>
            <CardTitle>Active Ticket Sessions</CardTitle>
            <CardDescription>
              Session state isolation overview. Private conversation transcripts are never shown in
              general analytics and are deleted upon ticket closure.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activeSessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No active AI ticket conversations right now.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Channel / Thread ID</th>
                      <th className="pb-2 font-medium">Category</th>
                      <th className="pb-2 font-medium">Status</th>
                      <th className="pb-2 font-medium">Snapshot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {activeSessions.map((s) => (
                      <tr key={s.id}>
                        <td className="py-2.5 font-mono text-xs">
                          {s.channelId} {s.isThread ? '(Thread)' : ''}
                        </td>
                        <td className="py-2.5">{s.categoryName}</td>
                        <td className="py-2.5">
                          <Badge variant="outline">{s.status}</Badge>
                        </td>
                        <td className="py-2.5 text-xs text-muted-foreground">
                          v{s.configVersion}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category Status Matrix */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Configured Ticket Categories</CardTitle>
              <CardDescription>
                AI responds exclusively inside enabled categories.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/categories">Manage</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No categories configured yet. Add your Discord support categories to enable the AI
                assistant.
              </p>
            ) : (
              <div className="space-y-2.5">
                {categories.map((cat) => (
                  <div
                    key={cat.categoryId}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{cat.categoryName}</p>
                      <p className="text-xs text-muted-foreground">
                        ID: {cat.categoryId} • {cat.questions.length} questions • v
                        {cat.configVersion}
                      </p>
                    </div>
                    <Badge variant={cat.enabled ? 'success' : 'secondary'}>
                      {cat.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Operational Errors & Non-Interference Safety Summary */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Recent Operational Errors
            </CardTitle>
            <CardDescription>
              Sanitized operational diagnostics (never contains player message text).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metrics.recentErrors.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                No recent operational errors recorded.
              </div>
            ) : (
              <div className="space-y-2">
                {metrics.recentErrors.slice(0, 6).map((err, idx) => (
                  <div key={idx} className="rounded-md border p-2.5 text-xs">
                    <div className="flex justify-between font-medium">
                      <span>
                        [{err.code}] {err.component}
                      </span>
                      <span className="text-muted-foreground">{err.timestamp}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">{err.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              Lifecycle Boundary Guarantees
            </CardTitle>
            <CardDescription>
              Enforced permissions and temporary retention architecture.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-xs text-muted-foreground">
            <p>
              • <strong>Read/Send Only:</strong> Never creates, closes, deletes, moves, locks, or
              archives channels or threads.
            </p>
            <p>
              • <strong>Snapshot Versioning:</strong> Active tickets retain the exact questionnaire
              version from when they opened (Server Config v{serverSettings.configVersion}).
            </p>
            <p>
              • <strong>Automatic Closure Purge:</strong> Messages, answers, lookups, and reports
              are deleted from Supabase as soon as your ticket bot closes the ticket.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

