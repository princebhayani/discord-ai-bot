import { requireDashboardModerator } from '@/lib/auth/guard';
import { getOverviewDashboardData } from '@/lib/data/dashboardDataService';
import { SimpleDashboardClient } from '@/components/SimpleDashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const moderator = await requireDashboardModerator();
  const { serverSettings, categories, activeSessions, botOnline } =
    await getOverviewDashboardData(moderator.guildId);

  return (
    <SimpleDashboardClient
      initialServerSettings={serverSettings}
      initialCategories={categories}
      activeSessions={activeSessions}
      botOnline={botOnline}
    />
  );
}
