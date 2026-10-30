import { NextResponse, type NextRequest } from 'next/server';
import {
  createSupabaseRouteHandlerClient,
  getMissingSupabaseEnvVars,
  resolvePublicOrigin,
} from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const origin = resolvePublicOrigin(request);
  const missing = getMissingSupabaseEnvVars();

  if (missing.length > 0) {
    const params = new URLSearchParams({
      reason: 'unconfigured',
      missing: missing.join(', '),
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  const { supabase, applyCookies } = createSupabaseRouteHandlerClient(request);
  const redirectTo = `${origin}/auth/callback`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: {
      redirectTo,
      // Supabase Auth requires 'email' alongside 'identify' to populate auth.users
      scopes: 'identify email',
    },
  });

  if (error || !data?.url) {
    const params = new URLSearchParams({
      reason: 'oauth_error',
      detail: error?.message ?? 'Supabase did not return a Discord OAuth redirect URL.',
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  const response = NextResponse.redirect(data.url);
  return applyCookies(response);
}

