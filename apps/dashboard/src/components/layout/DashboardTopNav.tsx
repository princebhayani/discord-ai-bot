'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, Check, Copy, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function DashboardTopNav({
  guildId,
  username,
  permissionLevel,
}: {
  guildId: string;
  username: string;
  permissionLevel: string;
}) {
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

  return (
    <header className="sticky top-0 z-40 w-full border-b border-zinc-800/80 bg-[#090a0f]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        {/* Left: Brand + Guild ID */}
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-200">
              <Bot className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-zinc-100 tracking-tight">
              HRBot
            </span>
          </Link>

          <span className="text-zinc-700 text-sm">/</span>

          <button
            type="button"
            onClick={handleCopyGuild}
            className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors"
            title="Click to copy Guild ID"
          >
            <span>{guildId}</span>
            {copiedGuild ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 text-zinc-500" />
            )}
          </button>
        </div>

        {/* Right: Status + User + Sign Out */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-[11px] font-medium hidden sm:inline text-zinc-300">Online</span>
          </div>

          <div className="h-4 w-px bg-zinc-800" />

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-300 hidden sm:inline truncate max-w-[140px]">
              {username}
            </span>
            <span className="rounded bg-zinc-800/80 border border-zinc-700/50 px-1.5 py-0.2 text-[9px] font-mono font-medium text-zinc-400 uppercase">
              {permissionLevel}
            </span>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="h-8 px-2 text-xs text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
