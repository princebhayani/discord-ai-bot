'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
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
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function signInWithDiscord() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo,
          scopes: 'identify guilds',
        },
      });
      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start Discord OAuth2 flow');
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-2 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <CardTitle className="text-xl">Ticket AI Moderator Console</CardTitle>
        <CardDescription>
          Sign in with Discord OAuth2. Access is restricted to server-verified moderators and
          allowlisted roles.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reason === 'forbidden' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-800">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Your Discord account is not on the approved <code>dashboard_admins</code> user or
              role allowlist for this server.
            </span>
          </div>
        )}

        {reason === 'unconfigured' && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900">
            Dashboard server environment variables (<code>SUPABASE_URL</code>,{' '}
            <code>SUPABASE_SERVICE_ROLE_KEY</code>, <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>,{' '}
            <code>DEFAULT_GUILD_ID</code>) must be configured before signing in.
          </div>
        )}

        {errorMsg && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-800">
            {errorMsg}
          </div>
        )}

        <Button
          onClick={signInWithDiscord}
          disabled={loading}
          className="w-full"
          size="lg"
        >
          {loading ? 'Redirecting to Discord…' : 'Sign in with Discord'}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          This assistant never manages or closes Discord tickets — all ticket lifecycle controls
          remain with your existing ticket bot.
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
        <LoginCardInner />
      </Suspense>
    </main>
  );
}

