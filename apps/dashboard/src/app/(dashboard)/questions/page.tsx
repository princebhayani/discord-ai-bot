import { QuestionBuilderClient } from '@/components/QuestionBuilderClient';
import { requireDashboardModerator } from '@/lib/auth/guard';
import { listCategoryConfigs } from '@/lib/data/dashboardDataService';

export const dynamic = 'force-dynamic';

export default async function QuestionsPage() {
  const moderator = await requireDashboardModerator();
  const categories = await listCategoryConfigs(moderator.guildId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Question Builder</h1>
        <p className="text-sm text-muted-foreground">
          Design dynamic conversational questionnaires per category with field validation,
          conditional visibility, and real-time preview.
        </p>
      </div>

      <QuestionBuilderClient initialCategories={categories} />
    </div>
  );
}

