'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, ShieldAlert, ShieldCheck } from 'lucide-react';
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
  const missing = searchParams.get('missing');
  const uid = searchParams.get('uid');
  const gid = searchParams.get('gid');
  const [loading, setLoading] = useState(false);

  function signInWithDiscord() {
    setLoading(true);
    window.location.href = '/auth/discord';
  }

  return (
    <Card className="w-full max-w-lg">
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
          <div className="space-y-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-900">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Discord login succeeded{uid ? <> as User ID <code>{uid}</code></> : null}, but your
                account is not yet in <code>dashboard_admins</code>
                {gid ? <> for server <code>{gid}</code></> : null}.
              </span>
            </div>
            {uid && (
              <pre className="overflow-x-auto rounded bg-background/80 p-2 text-[11px] text-foreground">
{`INSERT INTO public.dashboard_admins (guild_id, discord_user_id, label, permission_level)
VALUES ('${gid || 'YOUR_DISCORD_GUILD_ID'}', '${uid}', 'Owner', 'owner');`}
              </pre>
            )}
          </div>
        )}

        {reason === 'unconfigured' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Missing Dashboard Environment Variables</p>
              <p className="mt-1">
                {missing ? (
                  <>
                    Please set <code>{missing}</code> in Vercel Environment Variables and redeploy.
                  </>
                ) : (
                  <>
                    Configure <code>SUPABASE_URL</code>, <code>SUPABASE_ANON_KEY</code>, and{' '}
                    <code>SUPABASE_SECRET_KEY</code> in Vercel Environment Variables.
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        {reason === 'oauth_error' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-900">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">Discord OAuth2 Sign-In Failed</p>
              <p className="mt-1">{detail ?? 'Unable to complete Discord OAuth2 sign-in.'}</p>
            </div>
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
