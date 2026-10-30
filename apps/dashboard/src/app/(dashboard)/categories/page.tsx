import { CategoryManagerClient } from '@/components/CategoryManagerClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import {
  getOrInitServerSettings,
  listCategoryConfigs,
} from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const moderator = await requireDashboardModerator();
  const [serverSettings, categories] = await Promise.all([
    getOrInitServerSettings(moderator.guildId),
    listCategoryConfigs(moderator.guildId),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Category Management</h1>
        <p className="text-sm text-muted-foreground">
          Select which Discord ticket categories activate the AI assistant, customize welcome
          messages, and manage category FAQs.
        </p>
      </div>

      <CategoryManagerClient
        initialServerSettings={serverSettings}
        initialCategories={categories}
      />
    </div>
  );
}

