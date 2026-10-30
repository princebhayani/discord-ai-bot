import { PlayerIntegrationClient } from '@/components/PlayerIntegrationClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import {
  getOrInitServerSettings,
  listCategoryConfigs,
} from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function PlayerIntegrationPage() {
  const moderator = await requireDashboardModerator();
  const [settings, categories] = await Promise.all([
    getOrInitServerSettings(moderator.guildId),
    listCategoryConfigs(moderator.guildId),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          1-Line DOT Command Setup (Player Stats Bot)
        </h1>
        <p className="text-sm text-muted-foreground">
          Type your stats bot&apos;s DOT command on a single line (like <code>.p {'{tag}'}</code> or{' '}
          <code>.player {'{tag}'}</code>) and our bot will automatically look up the ticket
          opener&apos;s profile when they share their tag.
        </p>
      </div>

      <PlayerIntegrationClient
        initialConfig={settings.playerIntegrationConfig}
        initialCategories={categories}
      />
    </div>
  );
}
