-- ============================================================================
-- Migration 0002: Row Level Security (RLS) & Idempotent Closure Cleanup RPC
-- ============================================================================

-- Enable RLS across all persistent and temporary tables
ALTER TABLE public.server_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_category_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_admins ENABLE ROW LEVEL SECURITY;

-- Extract Discord User ID from Supabase OAuth JWT metadata when signed in via Discord OAuth2
CREATE OR REPLACE FUNCTION public.current_discord_user_id()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'user_metadata' ->> 'provider_id',
    auth.jwt() -> 'user_metadata' ->> 'sub'
  );
$$;

-- Check whether the authenticated user is an active dashboard moderator/admin for a guild
CREATE OR REPLACE FUNCTION public.is_guild_dashboard_admin(target_guild_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_admins da
    WHERE da.guild_id = target_guild_id
      AND da.active = true
      AND (
        (da.supabase_user_id IS NOT NULL AND da.supabase_user_id = auth.uid())
        OR (
          da.discord_user_id IS NOT NULL
          AND da.discord_user_id = public.current_discord_user_id()
        )
      )
  );
$$;

-- Check whether the authenticated user is an owner or admin for managing dashboard_admins
CREATE OR REPLACE FUNCTION public.is_guild_owner_or_admin(target_guild_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_admins da
    WHERE da.guild_id = target_guild_id
      AND da.active = true
      AND da.permission_level IN ('owner', 'admin')
      AND (
        (da.supabase_user_id IS NOT NULL AND da.supabase_user_id = auth.uid())
        OR (
          da.discord_user_id IS NOT NULL
          AND da.discord_user_id = public.current_discord_user_id()
        )
      )
  );
$$;

-- ----------------------------------------------------------------------------
-- Persistent Configuration Policies (Verified Dashboard Admins Only)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Guild admins can view server_settings" ON public.server_settings;
CREATE POLICY "Guild admins can view server_settings"
  ON public.server_settings
  FOR SELECT
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can update server_settings" ON public.server_settings;
CREATE POLICY "Guild admins can update server_settings"
  ON public.server_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id))
  WITH CHECK (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can view ticket_category_configs" ON public.ticket_category_configs;
CREATE POLICY "Guild admins can view ticket_category_configs"
  ON public.ticket_category_configs
  FOR SELECT
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can insert ticket_category_configs" ON public.ticket_category_configs;
CREATE POLICY "Guild admins can insert ticket_category_configs"
  ON public.ticket_category_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can update ticket_category_configs" ON public.ticket_category_configs;
CREATE POLICY "Guild admins can update ticket_category_configs"
  ON public.ticket_category_configs
  FOR UPDATE
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id))
  WITH CHECK (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can delete ticket_category_configs" ON public.ticket_category_configs;
CREATE POLICY "Guild admins can delete ticket_category_configs"
  ON public.ticket_category_configs
  FOR DELETE
  TO authenticated
  USING (public.is_guild_owner_or_admin(guild_id));

DROP POLICY IF EXISTS "Guild admins can view dashboard_admins" ON public.dashboard_admins;
CREATE POLICY "Guild admins can view dashboard_admins"
  ON public.dashboard_admins
  FOR SELECT
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id));

DROP POLICY IF EXISTS "Guild owners/admins can manage dashboard_admins" ON public.dashboard_admins;
CREATE POLICY "Guild owners/admins can manage dashboard_admins"
  ON public.dashboard_admins
  FOR ALL
  TO authenticated
  USING (public.is_guild_owner_or_admin(guild_id))
  WITH CHECK (public.is_guild_owner_or_admin(guild_id));

-- ----------------------------------------------------------------------------
-- Temporary Session Policies (Privacy-First)
-- ----------------------------------------------------------------------------
-- Verified guild admins can see high-level session counts/statuses on Overview,
-- while private temporary conversation tables (ticket_messages, ticket_answers,
-- player_lookups, staff_reports) have NO client/browser SELECT policies at all.
-- Only the server-side bot service-role key can access them during active tickets.
DROP POLICY IF EXISTS "Guild admins can view active session metadata" ON public.ticket_sessions;
CREATE POLICY "Guild admins can view active session metadata"
  ON public.ticket_sessions
  FOR SELECT
  TO authenticated
  USING (public.is_guild_dashboard_admin(guild_id));

-- ----------------------------------------------------------------------------
-- Idempotent Ticket Closure Cleanup RPC (Server-Side / Service Role Only)
-- ----------------------------------------------------------------------------
-- Deletes all temporary conversation, answer, lookup, report, and session rows
-- for a closed ticket channel/thread while never touching persistent tables.
CREATE OR REPLACE FUNCTION public.cleanup_closed_ticket_session(
  target_guild_id TEXT,
  target_channel_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_session_id UUID;
  deleted_messages INT := 0;
  deleted_answers INT := 0;
  deleted_lookups INT := 0;
  deleted_reports INT := 0;
BEGIN
  SELECT id
    INTO target_session_id
    FROM public.ticket_sessions
   WHERE guild_id = target_guild_id
     AND channel_id = target_channel_id
   LIMIT 1;

  IF target_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'cleaned', false,
      'alreadyAbsent', true,
      'channelId', target_channel_id
    );
  END IF;

  -- Explicit deletes for audit counts (ON DELETE CASCADE also guarantees removal)
  DELETE FROM public.ticket_messages WHERE session_id = target_session_id;
  GET DIAGNOSTICS deleted_messages = ROW_COUNT;

  DELETE FROM public.ticket_answers WHERE session_id = target_session_id;
  GET DIAGNOSTICS deleted_answers = ROW_COUNT;

  DELETE FROM public.player_lookups WHERE session_id = target_session_id;
  GET DIAGNOSTICS deleted_lookups = ROW_COUNT;

  DELETE FROM public.staff_reports WHERE session_id = target_session_id;
  GET DIAGNOSTICS deleted_reports = ROW_COUNT;

  DELETE FROM public.ticket_sessions WHERE id = target_session_id;

  RETURN jsonb_build_object(
    'cleaned', true,
    'alreadyAbsent', false,
    'sessionId', target_session_id,
    'channelId', target_channel_id,
    'deletedMessages', deleted_messages,
    'deletedAnswers', deleted_answers,
    'deletedLookups', deleted_lookups,
    'deletedReports', deleted_reports
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_closed_ticket_session(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_closed_ticket_session(TEXT, TEXT) TO service_role;

