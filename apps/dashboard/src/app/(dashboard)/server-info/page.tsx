import { ServerInfoClient } from '@/components/ServerInfoClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import { getOrInitServerSettings } from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function ServerInfoPage() {
  const moderator = await requireDashboardModerator();
  const settings = await getOrInitServerSettings(moderator.guildId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Server Details & Human Bot Persona
        </h1>
        <p className="text-sm text-muted-foreground">
          Add everything about your server, clans, requirements, and response times in one place so
          your bot talks naturally like a real human recruiter.
        </p>
      </div>

      <ServerInfoClient initialSettings={settings} />
    </div>
  );
}

