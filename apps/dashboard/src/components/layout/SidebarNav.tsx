'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  FileText,
  FolderKanban,
  ListChecks,
  LogOut,
  ShieldCheck,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { href: '/', label: 'Overview', icon: Activity },
  { href: '/server-info', label: 'Server Info & Persona', icon: Sparkles },
  { href: '/player-integration', label: 'DOT Commands', icon: Terminal },
  { href: '/categories', label: 'Category Management', icon: FolderKanban },
  { href: '/questions', label: 'Question Builder', icon: ListChecks },
  { href: '/reports', label: 'Report Settings', icon: FileText },
  { href: '/ai-settings', label: 'AI & Detection', icon: Bot },
] as const;

export function SidebarNav({
  username,
  permissionLevel,
  guildId,
}: {
  username: string;
  permissionLevel: string;
  guildId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="border-b p-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">Ticket AI Assistant</p>
            <p className="text-xs text-muted-foreground">Guild {guildId.slice(0, 8)}…</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/'
              ? pathname === '/'
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <div className="mb-3">
          <p className="truncate text-sm font-medium">{username}</p>
          <p className="text-xs capitalize text-muted-foreground">Role: {permissionLevel}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}

