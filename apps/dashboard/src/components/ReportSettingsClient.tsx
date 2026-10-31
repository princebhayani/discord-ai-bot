'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Lock,
  Plus,
  Save,
  Send,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type { ReportDestinationMode, ReportSettings } from '@hrbot/shared';
import type { DashboardAdminEntry } from '@/lib/data/dashboardDataService';
import { useSaveStatus } from '@/hooks/useSaveStatus';
import { StatusBanner } from '@/components/layout/StatusBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function ReportSettingsClient({
  initialReportSettings,
  initialAdmins,
  canManageAdmins,
}: {
  initialReportSettings: ReportSettings;
  initialAdmins: DashboardAdminEntry[];
  canManageAdmins: boolean;
}) {
  const router = useRouter();
  const { status, runSave } = useSaveStatus();

  const [reportSettings, setReportSettings] =
    useState<ReportSettings>(initialReportSettings);
  const [roleIdsInput, setRoleIdsInput] = useState(
    initialReportSettings.staffRoleIds.join(', ')
  );
  const [userIdsInput, setUserIdsInput] = useState(
    initialReportSettings.staffUserIds.join(', ')
  );

  const [admins, setAdmins] = useState<DashboardAdminEntry[]>(initialAdmins);
  const [adminUserId, setAdminUserId] = useState('');
  const [adminRoleId, setAdminRoleId] = useState('');
  const [adminLabel, setAdminLabel] = useState('');
  const [adminLevel, setAdminLevel] = useState<'owner' | 'admin' | 'moderator'>(
    'moderator'
  );

  async function saveReportSettings() {
    const parsedRoles = roleIdsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedUsers = userIdsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: ReportSettings = {
      ...reportSettings,
      staffRoleIds: parsedRoles,
      staffUserIds: parsedUsers,
    };

    await runSave(async () => {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportSettings: payload }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed saving report settings');
      setReportSettings(payload);
      router.refresh();
      return 'Published Moderator Report & Privacy configuration.';
    });
  }

  async function addAdminAllowlistEntry() {
    await runSave(async () => {
      const res = await fetch('/api/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          discordUserId: adminUserId.trim() || undefined,
          discordRoleId: adminRoleId.trim() || undefined,
          label: adminLabel.trim() || 'Moderator',
          permissionLevel: adminLevel,
        }),
      });
      const json = (await res.json()) as { entry?: DashboardAdminEntry; error?: string };
      if (!res.ok || !json.entry) {
        throw new Error(json.error ?? 'Failed adding allowlist entry');
      }
      setAdmins((prev) => [...prev, json.entry!]);
      setAdminUserId('');
      setAdminRoleId('');
      setAdminLabel('');
      router.refresh();
      return 'Added moderator allowlist entry.';
    });
  }

  async function deleteAdminEntry(id: string) {
    await runSave(async () => {
      const res = await fetch(`/api/admins?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed removing allowlist entry');
      setAdmins((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
      return 'Removed moderator allowlist entry.';
    });
  }

  return (
    <div className="space-y-6">
      <StatusBanner status={status} />

      {/* Report Destinations */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Send className="h-4 w-4 text-primary" />
                Pre-Existing Report Delivery Destinations
              </CardTitle>
              <CardDescription className="text-xs">
                The bot delivers intake summaries into pre-existing Discord destinations. It never creates channels, archives threads, or changes permissions.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary">
              Staff Confidential
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Delivery Destination Mode</Label>
              <select
                className="h-9 w-full rounded-md border border-border/60 bg-muted/30 px-3 text-xs focus:border-primary focus:outline-none"
                value={reportSettings.destinationMode}
                onChange={(e) =>
                  setReportSettings({
                    ...reportSettings,
                    destinationMode: e.target.value as ReportDestinationMode,
                  })
                }
              >
                <option value="staff_channel" className="bg-background text-foreground">
                  Pre-Existing Staff-Only Report Channel
                </option>
                <option value="existing_private_thread" className="bg-background text-foreground">
                  Existing Private Ticket Thread (Ticket Bot Managed)
                </option>
                <option value="both" className="bg-background text-foreground">Both Destinations</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Staff Report Channel Snowflake ID</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="17-20 digit Discord Snowflake ID"
                value={reportSettings.staffReportChannelId}
                onChange={(e) =>
                  setReportSettings({
                    ...reportSettings,
                    staffReportChannelId: e.target.value,
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Staff Role IDs to Ping (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="e.g. 111111111111111111, 222222222222222222"
                value={roleIdsInput}
                onChange={(e) => setRoleIdsInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Staff User IDs for Handoff Detection (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="e.g. 333333333333333333, 444444444444444444"
                value={userIdsInput}
                onChange={(e) => setUserIdsInput(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div>
                <p className="text-xs font-medium text-foreground">
                  Allow Private Thread Destination
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Omits confidential notes if applicant is in thread
                </p>
              </div>
              <Switch
                checked={reportSettings.allowVerifiedPrivateThreadDestination}
                onCheckedChange={(checked) =>
                  setReportSettings({
                    ...reportSettings,
                    allowVerifiedPrivateThreadDestination: checked,
                  })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 p-3">
              <div>
                <p className="text-xs font-medium text-foreground">
                  Post Applicant Summary in Ticket
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Confirms submitted answers to the member in chat
                </p>
              </div>
              <Switch
                checked={reportSettings.includePlayerSummaryInTicket}
                onCheckedChange={(checked) =>
                  setReportSettings({
                    ...reportSettings,
                    includePlayerSummaryInTicket: checked,
                  })
                }
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <Label className="text-xs text-muted-foreground cursor-pointer">Structured Answers</Label>
              <Switch
                checked={reportSettings.includeRawAnswers}
                onCheckedChange={(checked) =>
                  setReportSettings({ ...reportSettings, includeRawAnswers: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <Label className="text-xs text-muted-foreground cursor-pointer">Privacy Redaction</Label>
              <Switch
                checked={reportSettings.privacyRedactionEnabled}
                onCheckedChange={(checked) =>
                  setReportSettings({
                    ...reportSettings,
                    privacyRedactionEnabled: checked,
                  })
                }
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={saveReportSettings}
              className="shadow-sm shadow-primary/20 hover:shadow-primary/40 text-xs"
            >
              <Save className="mr-2 h-4 w-4" />
              Publish Report &amp; Privacy Rules
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dashboard Moderator Allowlist */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Dashboard Staff Allowlist
          </CardTitle>
          <CardDescription className="text-xs">
            Manage which Discord users or roles have access to view and edit this configuration dashboard.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {canManageAdmins && (
            <div className="grid gap-3 rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Discord User ID</Label>
                <Input
                  className="bg-background border-border/60 font-mono text-xs"
                  placeholder="User Snowflake ID"
                  value={adminUserId}
                  onChange={(e) => setAdminUserId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Discord Role ID</Label>
                <Input
                  className="bg-background border-border/60 font-mono text-xs"
                  placeholder="Role Snowflake ID"
                  value={adminRoleId}
                  onChange={(e) => setAdminRoleId(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Label / Note</Label>
                <Input
                  className="bg-background border-border/60 text-xs"
                  placeholder="e.g. Head Moderator"
                  value={adminLabel}
                  onChange={(e) => setAdminLabel(e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2">
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
                  value={adminLevel}
                  onChange={(e) =>
                    setAdminLevel(e.target.value as 'owner' | 'admin' | 'moderator')
                  }
                >
                  <option value="moderator">Moderator</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs border-border/60 hover:bg-primary/10 hover:text-primary shrink-0"
                  onClick={addAdminAllowlistEntry}
                  disabled={!adminUserId.trim() && !adminRoleId.trim()}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {admins.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 italic text-center py-4">
                No custom allowlist entries configured. Server owner has full access.
              </p>
            ) : (
              admins.map((adm) => (
                <div
                  key={adm.id}
                  className="flex items-center justify-between rounded-lg border border-border/50 bg-background/50 p-3"
                >
                  <div className="flex items-center gap-3">
                    <UserCheck className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{adm.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {adm.discordUserId
                          ? `User: ${adm.discordUserId}`
                          : `Role: ${adm.discordRoleId}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase font-mono">
                      {adm.permissionLevel}
                    </Badge>
                    {canManageAdmins && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deleteAdminEntry(adm.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
