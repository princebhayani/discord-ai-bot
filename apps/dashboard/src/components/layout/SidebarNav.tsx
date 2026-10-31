'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Check,
  Copy,
  LogOut,
  ShieldCheck,
  Sparkles,
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
    title: 'BOT MANAGEMENT',
    items: [
      { href: '/', label: 'Server & Questions', icon: Sparkles },
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
    void navigator.clipboard.writeText(guildId);
    setCopiedGuild(true);
    setTimeout(() => setCopiedGuild(false), 2000);
  }

  const roleColor =
    permissionLevel === 'owner'
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : permissionLevel === 'admin'
      ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
      : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border/70 bg-[#090b10] select-none">
      {/* Brand & Bot Header */}
      <div className="border-b border-border/70 px-4 py-4 bg-secondary/10">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/25 transition-transform group-hover:scale-105">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-bold tracking-tight text-foreground block truncate">
              Ticket Assistant
            </span>
            <span className="text-[11px] font-medium text-muted-foreground block truncate">
              Control Center
            </span>
          </div>
        </Link>

        {/* Guild Identifier Pill */}
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border/50 bg-secondary/30 px-2.5 py-1.5 text-xs">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="font-mono text-[10px] text-muted-foreground truncate">
              {guildId}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCopyGuild}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            title="Copy Guild ID"
          >
            {copiedGuild ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="px-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              {group.title}
            </p>
            <div className="space-y-0.5 pt-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'group flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary text-primary-foreground shadow-sm shadow-primary/30 font-semibold'
                        : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-transform group-hover:scale-110',
                          active
                            ? 'text-primary-foreground'
                            : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      />
                      <span>{item.label}</span>
                    </div>
                    {item.badge && (
                      <span
                        className={cn(
                          'rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider',
                          active
                            ? 'bg-primary-foreground/20 text-primary-foreground'
                            : 'bg-primary/10 text-primary border border-primary/20'
                        )}
                      >
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

      {/* User Session Footer */}
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
