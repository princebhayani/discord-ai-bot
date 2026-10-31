'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Bot, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

function LoginCardInner() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');
  const detail = searchParams.get('detail') ?? searchParams.get('error_description');
  const [loading, setLoading] = useState(false);

  function signInWithDiscord() {
    setLoading(true);
    window.location.href = '/auth/discord';
  }

  return (
    <Card className="w-full max-w-md border-zinc-800 bg-zinc-900/50 backdrop-blur-md shadow-xl">
      <CardHeader className="space-y-2.5 text-center pb-4">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-800 border border-zinc-700/60 text-zinc-200">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <CardTitle className="text-xl font-semibold text-zinc-100 tracking-tight">
            HRBot Moderator Console
          </CardTitle>
          <CardDescription className="text-xs text-zinc-400 mt-1">
            Sign in with Discord to manage server greeting and ticket intake settings.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-2">
        {reason === 'forbidden' && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="space-y-1">
              <p className="font-medium text-red-200">Access Denied</p>
              <p className="text-zinc-400 leading-relaxed text-[11px]">
                Your Discord account is not authorized to access this server dashboard. Please contact a server administrator to request access.
              </p>
            </div>
          </div>
        )}

        {reason === 'unconfigured' && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="space-y-1">
              <p className="font-medium text-amber-200">Configuration Required</p>
              <p className="text-zinc-400 leading-relaxed text-[11px]">
                Dashboard environment variables have not been configured. Please verify your deployment settings.
              </p>
            </div>
          </div>
        )}

        {reason === 'oauth_error' && (
          <div className="flex items-start gap-2.5 rounded-lg border border-red-500/20 bg-red-500/10 p-3.5 text-xs text-red-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <div className="space-y-1">
              <p className="font-medium text-red-200">Sign-In Failed</p>
              <p className="text-zinc-400 leading-relaxed text-[11px]">
                {detail ?? 'Unable to complete Discord OAuth2 sign-in. Please try again.'}
              </p>
            </div>
          </div>
        )}

        <Button
          onClick={signInWithDiscord}
          disabled={loading}
          className="w-full h-10 text-xs font-medium bg-zinc-100 hover:bg-white text-zinc-900 transition-colors shadow-sm"
          size="lg"
        >
          {loading ? 'Redirecting to Discord…' : 'Sign in with Discord'}
        </Button>

        <p className="text-center text-[11px] text-zinc-500 pt-1">
          Access is restricted to authorized server administrators and moderators.
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6 bg-[#07090e]">
      <Suspense fallback={<div className="text-xs text-zinc-500">Loading…</div>}>
        <LoginCardInner />
      </Suspense>
    </main>
  );
}
