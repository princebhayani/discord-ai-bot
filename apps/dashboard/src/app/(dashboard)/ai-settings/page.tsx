import { AiSettingsClient } from '@/components/AiSettingsClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import { getOrInitServerSettings } from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function AiSettingsPage() {
  const moderator = await requireDashboardModerator();
  const settings = await getOrInitServerSettings(moderator.guildId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          AI Engine & Ticket Detection Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure Groq model selection, system instructions, concurrency/rate limits, and
          existing ticket-bot verification rules.
        </p>
      </div>

      <AiSettingsClient
        initialAiSettings={settings.aiSettings}
        initialDetectionConfig={settings.ticketDetectionConfig}
      />
    </div>
  );
}

