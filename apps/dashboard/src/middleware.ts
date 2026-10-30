import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function getMiddlewareSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).trim();
  const anonKey = (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  // If Supabase fell back to Site URL ('/?code=...' or '/?error=...') because '/auth/callback'
  // was not yet added to Redirect URLs, forward seamlessly to '/auth/callback'.
  if (
    pathname === '/' &&
    (searchParams.has('code') || searchParams.has('error') || searchParams.has('error_description'))
  ) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = '/auth/callback';
    return NextResponse.redirect(callbackUrl);
  }

  const cfg = getMiddlewareSupabaseConfig();
  if (!cfg) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(
            name,
            value,
            options as Parameters<typeof supabaseResponse.cookies.set>[2]
          );
        }
      },
    },
  });

  // Refresh session token if needed
  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/discord|auth/callback|auth/logout).*)',
  ],
};

