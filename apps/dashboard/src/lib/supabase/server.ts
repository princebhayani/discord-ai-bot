import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';

export function getSupabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
}

export function getSupabaseAnonKey(): string {
  return (
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();
}

export function getSupabaseSecretKey(): string {
  return (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
}

export function getMissingSupabaseEnvVars(): string[] {
  const missing: string[] = [];
  const url = getSupabaseUrl();
  const anon = getSupabaseAnonKey();
  const secret = getSupabaseSecretKey();

  if (!url) {
    missing.push('SUPABASE_URL');
  } else if (
    url.includes('sb_secret_') ||
    url.includes('sb_publishable_') ||
    !/^https?:\/\/[a-z0-9.-]+/i.test(url)
  ) {
    missing.push(
      'SUPABASE_URL (must be https://<project-id>.supabase.co from Project Settings -> Data API, NOT an sb_secret_ key)'
    );
  }

  if (!anon) {
    missing.push('SUPABASE_ANON_KEY');
  } else if (anon.startsWith('sb_secret_')) {
    missing.push(
      'SUPABASE_ANON_KEY (must be your Publishable / anon key, NOT your sb_secret_ key)'
    );
  }

  if (!secret) {
    missing.push('SUPABASE_SECRET_KEY');
  }

  return missing;
}

export function isSupabaseConfigured(): boolean {
  return getMissingSupabaseEnvVars().length === 0;
}

/**
 * Resolves the browser-facing origin accurately behind Vercel's reverse proxy.
 */
export function resolvePublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

export async function createSupabaseSsrClient() {
  const cookieStore = await cookies();
  const url = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render context cannot mutate cookies; middleware/route handlers handle refresh
        }
      },
    },
  });
}

/**
 * Dedicated Route Handler Supabase SSR client that captures all PKCE & session cookies
 * and applies them directly onto a NextResponse (e.g., NextResponse.redirect) so cookies
 * are never dropped during OAuth redirects on Vercel Serverless Functions.
 */
export function createSupabaseRouteHandlerClient(request: NextRequest) {
  const pendingCookies: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
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
        for (const cookie of cookiesToSet) {
          pendingCookies.push(cookie);
        }
      },
    },
  });

  function applyCookies<T extends NextResponse>(response: T): T {
    for (const { name, value, options } of pendingCookies) {
      response.cookies.set(name, value, options as Parameters<typeof response.cookies.set>[2]);
    }
    return response;
  }

  return { supabase, applyCookies };
}

/**
 * Server-only Supabase administrative client using SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
 * Must ONLY be invoked after server-side moderator verification passes.
 */
export function createSupabaseServiceClient(): SupabaseClient {
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseSecretKey();
  if (!url || !serviceKey) {
    throw new Error(
      'Missing SUPABASE_URL or SUPABASE_SECRET_KEY on dashboard server.'
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
