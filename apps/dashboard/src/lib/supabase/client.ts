import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client strictly restricted to public anon credentials for Discord OAuth2 sign-in.
 * Service-role credentials are NEVER exposed to the browser.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return createBrowserClient(url, anonKey);
}

