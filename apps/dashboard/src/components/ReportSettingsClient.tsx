'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Lock,
  Plus,
  Save,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type { ReportSettings } from '@hrbot/shared';
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

  async function saveStaffIdentifiers() {
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
      destinationMode: 'none',
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
      if (!res.ok) throw new Error(json.error ?? 'Failed saving staff settings');
      setReportSettings(payload);
      router.refresh();
      return 'Saved staff & moderator Discord IDs.';
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

      {/* Staff & Moderator Identification (For in-ticket distinction) */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Staff &amp; Moderator Discord Identification
              </CardTitle>
              <CardDescription className="text-xs">
                Helps the assistant accurately distinguish staff/administrators from the single ticket opener. When staff chat inside tickets, the bot automatically yields and will never confuse staff for the applicant.
              </CardDescription>
            </div>
            <Badge variant="outline" className="font-mono text-xs border-primary/30 text-primary">
              Ticket Protection
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Staff Discord User IDs (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="e.g. 333333333333333333, 444444444444444444"
                value={userIdsInput}
                onChange={(e) => setUserIdsInput(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Messages from these user IDs are recognized as staff activity.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Staff Role IDs (comma-separated)</Label>
              <Input
                className="bg-muted/30 border-border/60 font-mono text-xs"
                placeholder="e.g. 111111111111111111, 222222222222222222"
                value={roleIdsInput}
                onChange={(e) => setRoleIdsInput(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Members holding these Discord roles are treated as moderators.
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              onClick={saveStaffIdentifiers}
              className="shadow-sm shadow-primary/20 hover:shadow-primary/40 text-xs"
            >
              <Save className="mr-2 h-4 w-4" />
              Save Staff Identifiers
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Dashboard Moderator & Admin Allowlist */}
      <Card className="glass-card border border-border/60">
        <CardHeader className="pb-4 border-b border-border/40">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Users className="h-4 w-4 text-primary" />
            Dashboard Staff Allowlist &amp; Permissions
          </CardTitle>
          <CardDescription className="text-xs">
            Manage which Discord users or roles have access to view and configure this dashboard.
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
                  placeholder="e.g. Lead Moderator"
                  value={adminLabel}
                  onChange={(e) => setAdminLabel(e.target.value)}
                />
              </div>

              <div className="flex items-end gap-2">
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-xs focus:border-primary focus:outline-none"
                  value={adminLevel}
                  onChange={(e) =>
                    setAdminLevel(e.target.value as 'owner' | 'admin' | 'moderator')
                  }
                >
                  <option value="moderator" className="bg-background text-foreground">Moderator</option>
                  <option value="admin" className="bg-background text-foreground">Admin</option>
                  <option value="owner" className="bg-background text-foreground">Owner</option>
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
                No custom allowlist entries configured. Server owner has full access by default.
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
                          ? `User ID: ${adm.discordUserId}`
                          : `Role ID: ${adm.discordRoleId}`}
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
