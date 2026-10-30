import { PlayerIntegrationClient } from '@/components/PlayerIntegrationClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import { getOrInitServerSettings } from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function PlayerIntegrationPage() {
  const moderator = await requireDashboardModerator();
  const settings = await getOrInitServerSettings(moderator.guildId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Player-Data Bot Integration</h1>
        <p className="text-sm text-muted-foreground">
          Configure approved lookup command templates, strict external bot ID verification,
          response parsing, and timeouts.
        </p>
      </div>

      <PlayerIntegrationClient initialConfig={settings.playerIntegrationConfig} />
    </div>
  );
}

