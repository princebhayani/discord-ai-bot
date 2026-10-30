import { ReportSettingsClient } from '@/components/ReportSettingsClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import {
  getOrInitServerSettings,
  listDashboardAdmins,
} from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const moderator = await requireDashboardModerator();
  const [settings, admins] = await Promise.all([
    getOrInitServerSettings(moderator.guildId),
    listDashboardAdmins(moderator.guildId),
  ]);

  const canManageAdmins =
    moderator.permissionLevel === 'owner' || moderator.permissionLevel === 'admin';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Report Destinations, Privacy & Moderator Allowlist
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure pre-existing staff report destinations, confidentiality safeguards, and
          dashboard administrator permissions.
        </p>
      </div>

      <ReportSettingsClient
        initialReportSettings={settings.reportSettings}
        initialAdmins={admins}
        canManageAdmins={canManageAdmins}
      />
    </div>
  );
}

