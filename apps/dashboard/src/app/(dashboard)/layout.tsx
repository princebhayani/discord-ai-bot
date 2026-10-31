import Link from 'next/link';
import { ExternalLink, Radio } from 'lucide-react';
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
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header Bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 bg-card/40 px-8 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-border/60 bg-secondary/50 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span>Guild {moderator.guildId}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span>Worker Active</span>
            </div>

            <span className="rounded-full border border-border/50 bg-secondary/40 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
              openai/gpt-oss-120b
            </span>

            <Link
              href="https://discord.com"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              <span>Discord</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto p-8">
          <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

