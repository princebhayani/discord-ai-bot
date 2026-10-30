import { NextResponse, type NextRequest } from 'next/server';
import {
  createSupabaseRouteHandlerClient,
  resolvePublicOrigin,
} from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const origin = resolvePublicOrigin(request);
  const { searchParams } = new URL(request.url);

  const oauthError = searchParams.get('error');
  const oauthErrorDesc = searchParams.get('error_description');
  if (oauthError || oauthErrorDesc) {
    const params = new URLSearchParams({
      reason: 'oauth_error',
      detail: oauthErrorDesc || oauthError || 'Discord OAuth authorization failed.',
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  const code = searchParams.get('code');
  if (!code) {
    const params = new URLSearchParams({
      reason: 'oauth_error',
      detail: 'Missing authorization code in callback URL. Ensure your Vercel /auth/callback URL is added under Supabase -> Authentication -> URL Configuration -> Redirect URLs.',
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  const { supabase, applyCookies } = createSupabaseRouteHandlerClient(request);
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const params = new URLSearchParams({
      reason: 'oauth_error',
      detail: error.message,
    });
    return NextResponse.redirect(`${origin}/login?${params.toString()}`);
  }

  const response = NextResponse.redirect(`${origin}/`);
  return applyCookies(response);
}
