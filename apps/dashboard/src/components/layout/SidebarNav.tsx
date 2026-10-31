'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bot,
  Check,
  Copy,
  FileText,
  FolderKanban,
  ListChecks,
  LogOut,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface NavGroup {
  title: string;
  items: Array<{
    href: string;
    label: string;
    icon: typeof Activity;
    badge?: string;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'WORKSPACE',
    items: [
      { href: '/', label: 'Overview', icon: Activity },
      { href: '/server-info', label: 'Server & Persona', icon: Sparkles },
      { href: '/categories', label: 'Category Setup', icon: FolderKanban },
    ],
  },
  {
    title: 'INTAKE PIPELINE',
    items: [
      { href: '/questions', label: 'Question Builder', icon: ListChecks },
    ],
  },
  {
    title: 'ENGINE & GUARDS',
    items: [
      { href: '/ai-settings', label: 'AI & Detection', icon: Bot },
      { href: '/reports', label: 'Staff & Admins', icon: Users },
    ],
  },
];

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
  const [copiedGuild, setCopiedGuild] = useState(false);

  async function handleSignOut() {
    await fetch('/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  function handleCopyGuild() {
    navigator.clipboard.writeText(guildId);
    setCopiedGuild(true);
    setTimeout(() => setCopiedGuild(false), 2000);
  }

  const roleColor =
    permissionLevel === 'owner'
      ? 'border-purple-500/30 text-purple-400 bg-purple-500/10'
      : permissionLevel === 'admin'
        ? 'border-blue-500/30 text-blue-400 bg-blue-500/10'
        : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10';

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border/70 bg-card/50 backdrop-blur-md">
      {/* Brand Header */}
      <div className="border-b border-border/70 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-primary to-indigo-500 text-primary-foreground shadow-md shadow-primary/20">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                Ticket Assistant
              </p>
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            </div>
            <button
              onClick={handleCopyGuild}
              className="mt-0.5 flex items-center gap-1.5 rounded text-[11px] font-mono text-muted-foreground transition-colors hover:text-foreground"
              title="Click to copy Discord Guild ID"
            >
              <span>Guild {guildId.slice(0, 6)}…</span>
              {copiedGuild ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <Copy className="h-3 w-3 opacity-60" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </p>
            <div className="space-y-0.5 pt-1">
              {group.items.map((item) => {
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
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150',
                      active
                        ? 'bg-primary/15 text-primary font-semibold shadow-sm shadow-primary/10 border-l-2 border-primary'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-4 w-4 transition-colors',
                        active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User Card & Sign Out */}
      <div className="border-t border-border/70 p-3 bg-secondary/20">
        <div className="mb-2.5 flex items-center gap-2.5 rounded-lg border border-border/50 bg-card/60 p-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary font-mono text-xs font-semibold text-foreground">
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{username}</p>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span
                className={cn(
                  'rounded border px-1.5 py-0.2 text-[9px] font-medium uppercase tracking-wider',
                  roleColor
                )}
              >
                {permissionLevel}
              </span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2 border-border/60 text-xs font-medium text-muted-foreground hover:border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
          onClick={handleSignOut}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}

