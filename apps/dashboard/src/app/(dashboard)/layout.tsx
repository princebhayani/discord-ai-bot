import { SidebarNav } from '@/components/layout/SidebarNav';
import { requireDashboardModerator } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function ProtectedDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const moderator = await requireDashboardModerator();

  return (
    <div className="flex min-h-screen bg-background">
      <SidebarNav
        username={moderator.username}
        permissionLevel={moderator.permissionLevel}
        guildId={moderator.guildId}
      />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-6xl space-y-6">{children}</div>
      </main>
    </div>
  );
}

