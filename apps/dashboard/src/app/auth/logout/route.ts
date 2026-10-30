import { NextResponse, type NextRequest } from 'next/server';
import {
  createSupabaseRouteHandlerClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  if (!isSupabaseConfigured()) {
    return response;
  }

  const { supabase, applyCookies } = createSupabaseRouteHandlerClient(request);
  await supabase.auth.signOut();
  return applyCookies(response);
}

