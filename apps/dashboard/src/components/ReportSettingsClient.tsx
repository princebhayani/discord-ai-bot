'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Save, Trash2 } from 'lucide-react';
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

      <Card>
        <CardHeader>
          <CardTitle>Pre-Existing Report Delivery Destinations</CardTitle>
          <CardDescription>
            The assistant never creates channels or threads and never posts confidential staff
            analysis into player-visible ticket channels.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Delivery Mode</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={reportSettings.destinationMode}
                onChange={(e) =>
                  setReportSettings({
                    ...reportSettings,
                    destinationMode: e.target.value as ReportDestinationMode,
                  })
                }
              >
                <option value="staff_channel">
                  Pre-Existing Staff-Only Report Channel
                </option>
                <option value="existing_private_thread">
                  Existing Private Ticket Thread (Created by Ticket Provider)
                </option>
                <option value="both">Both Destinations</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Existing Staff-Only Report Channel ID</Label>
              <Input
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
              <Label>Staff Role IDs to Ping on Report (comma-separated)</Label>
              <Input
                placeholder="111111111111111111, 222222222222222222"
                value={roleIdsInput}
                onChange={(e) => setRoleIdsInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Staff Discord User IDs for Handoff Detection (comma-separated)</Label>
              <Input
                placeholder="333333333333333333, 444444444444444444"
                value={userIdsInput}
                onChange={(e) => setUserIdsInput(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">
                  Allow Existing Private Thread Destination
                </p>
                <p className="text-xs text-muted-foreground">
                  Automatically omits confidential staff analysis if player is a participant
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

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">
                  Post Player-Visible Summary in Ticket Channel
                </p>
                <p className="text-xs text-muted-foreground">
                  Sends a sanitized summary of submitted answers without staff assessment
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

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-xs">Include Structured Answers</Label>
              <Switch
                checked={reportSettings.includeRawAnswers}
                onCheckedChange={(checked) =>
                  setReportSettings({ ...reportSettings, includeRawAnswers: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-xs">Include Lookup Diagnostics</Label>
              <Switch
                checked={reportSettings.includeLookupDetails}
                onCheckedChange={(checked) =>
                  setReportSettings({ ...reportSettings, includeLookupDetails: checked })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label className="text-xs">Enforce Secret Redaction</Label>
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

          <Button type="button" onClick={saveReportSettings}>
            <Save className="h-4 w-4" />
            Publish Report Settings
          </Button>
        </CardContent>
      </Card>

      {/* Dashboard Moderator / Role Allowlist */}
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Access Allowlist (Discord Users & Roles)</CardTitle>
          <CardDescription>
            Controls which Discord OAuth2 users and server roles are permitted to access this
            administrative dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {admins.map((adm) => (
              <div
                key={adm.id}
                className="flex items-center justify-between rounded-lg border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {adm.label}{' '}
                    <Badge variant="outline" className="ml-2 capitalize">
                      {adm.permissionLevel}
                    </Badge>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {adm.discordUserId
                      ? `Discord User: ${adm.discordUserId}`
                      : `Discord Role: ${adm.discordRoleId}`}
                  </p>
                </div>
                {canManageAdmins && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteAdminEntry(adm.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {canManageAdmins && (
            <div className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-5">
              <Input
                placeholder="Label (e.g. Senior Mods)"
                value={adminLabel}
                onChange={(e) => setAdminLabel(e.target.value)}
              />
              <Input
                placeholder="Discord User ID (optional)"
                value={adminUserId}
                onChange={(e) => setAdminUserId(e.target.value)}
              />
              <Input
                placeholder="Discord Role ID (optional)"
                value={adminRoleId}
                onChange={(e) => setAdminRoleId(e.target.value)}
              />
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={adminLevel}
                onChange={(e) =>
                  setAdminLevel(e.target.value as 'owner' | 'admin' | 'moderator')
                }
              >
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
              <Button type="button" variant="outline" onClick={addAdminAllowlistEntry}>
                <Plus className="h-4 w-4" />
                Add Allowlist
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

