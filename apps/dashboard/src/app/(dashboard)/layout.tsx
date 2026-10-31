import { DashboardTopNav } from '@/components/layout/DashboardTopNav';
import { requireDashboardModerator } from '@/lib/auth/guard';

export const dynamic = 'force-dynamic';

export default async function ProtectedDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const moderator = await requireDashboardModerator();

  return (
    <div className="min-h-screen bg-[#07090e] text-zinc-100 flex flex-col antialiased">
      <DashboardTopNav
        guildId={moderator.guildId}
        username={moderator.username}
        permissionLevel={moderator.permissionLevel}
      />
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </div>
  );
}
