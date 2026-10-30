-- ============================================================================
-- Migration 0001: Initial Schema for Discord Ticket AI Conversation Assistant
-- ============================================================================
-- Persistent tables:
--   1. server_settings
--   2. ticket_category_configs
--   8. dashboard_admins
--
-- Temporary active-ticket tables (deleted immediately upon confirmed closure):
--   3. ticket_sessions
--   4. ticket_messages
--   5. ticket_answers
--   6. player_lookups
--   7. staff_reports
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Helper function to automatically maintain updated_at timestamps
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. server_settings (Persistent per-guild configuration)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.server_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL UNIQUE,
  guild_name TEXT NOT NULL DEFAULT 'Discord Server',
  bot_enabled BOOLEAN NOT NULL DEFAULT true,
  default_welcome_message TEXT NOT NULL DEFAULT E'Hello! Welcome to Support.\n\nI''m your automated support assistant.\n\nI''ll help collect some information about your issue so that our support team can review it efficiently.',
  ticket_detection_config JSONB NOT NULL DEFAULT '{
    "providerBotIds": [],
    "channelNamePrefixes": ["ticket-", "support-"],
    "topicMarkers": ["ticket", "opened by"],
    "requireProviderVerification": true,
    "waitForProviderEmbedMs": 8000,
    "threadClosurePolicy": "locked_only",
    "webhookEnabled": false
  }'::jsonb,
  ai_settings JSONB NOT NULL DEFAULT '{
    "model": "",
    "systemInstructions": "You are a polite, concise, automated Discord ticket support assistant. Never pretend to be human staff. Ask one main question at a time, never repeat answered questions, and stay focused on gathering ticket information.",
    "maxTokens": 900,
    "temperature": 0.2,
    "globalConcurrencyLimit": 5,
    "perTicketRateLimitPerMinute": 12,
    "structuredOutputsEnabled": true,
    "fallbackMessage": "Thank you for your message. A human moderator will follow up with you shortly."
  }'::jsonb,
  player_integration_config JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "externalBotUserId": "",
    "commandPrefix": ".",
    "executionChannelId": "",
    "timeoutMs": 12000,
    "maxLookupsPerTicket": 3,
    "supportedActions": ["lookup_player", "lookup_clan", "lookup_profile"],
    "commandTemplates": {
      "lookup_player": "{prefix}player {target}",
      "lookup_clan": "{prefix}clan {target}",
      "lookup_profile": "{prefix}profile {target}"
    },
    "parserConfig": {
      "strategy": "embed_and_regex",
      "fieldMappings": {
        "playerTag": ["Player Tag", "Tag"],
        "playerName": ["Name", "Player", "IGN"],
        "townHallLevel": ["Town Hall", "TH", "TH Level"],
        "clanName": ["Clan"],
        "donations": ["Donations", "Donated"],
        "trophies": ["Trophies"]
      },
      "regexPatterns": {
        "playerTag": "#[A-Z0-9]{3,16}",
        "townHallLevel": "(?:TH|Town\\s*Hall)[:\\s]*(\\d{1,2})",
        "trophies": "(?:Trophies)[:\\s]*([\\d,]+)"
      }
    }
  }'::jsonb,
  report_settings JSONB NOT NULL DEFAULT '{
    "destinationMode": "staff_channel",
    "staffReportChannelId": "",
    "allowVerifiedPrivateThreadDestination": false,
    "includePlayerSummaryInTicket": false,
    "staffRoleIds": [],
    "staffUserIds": [],
    "includeRawAnswers": true,
    "includeLookupDetails": true,
    "privacyRedactionEnabled": true
  }'::jsonb,
  operational_metrics JSONB NOT NULL DEFAULT '{
    "groqRequestsTotal": 0,
    "groqPromptTokensTotal": 0,
    "groqCompletionTokensTotal": 0,
    "playerLookupsSucceeded": 0,
    "playerLookupsFailed": 0,
    "reportsDelivered": 0,
    "sessionsCleanedUp": 0,
    "recentErrors": []
  }'::jsonb,
  bot_heartbeat_at TIMESTAMPTZ,
  config_version INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_server_settings_guild_id
  ON public.server_settings(guild_id);

DROP TRIGGER IF EXISTS trg_server_settings_updated_at ON public.server_settings;
CREATE TRIGGER trg_server_settings_updated_at
  BEFORE UPDATE ON public.server_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. ticket_category_configs (Persistent per-category questionnaires & rules)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_category_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES public.server_settings(guild_id) ON DELETE CASCADE,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  welcome_message TEXT,
  category_instructions TEXT NOT NULL DEFAULT '',
  faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  player_lookup_enabled BOOLEAN NOT NULL DEFAULT false,
  report_channel_override_id TEXT,
  config_version INTEGER NOT NULL DEFAULT 1,
  published_snapshot JSONB,
  published_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_ticket_category_configs_guild_category UNIQUE (guild_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_category_configs_lookup
  ON public.ticket_category_configs(guild_id, category_id, enabled);

DROP TRIGGER IF EXISTS trg_ticket_category_configs_updated_at ON public.ticket_category_configs;
CREATE TRIGGER trg_ticket_category_configs_updated_at
  BEFORE UPDATE ON public.ticket_category_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. ticket_sessions (TEMPORARY — active AI ticket conversations only)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES public.server_settings(guild_id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL UNIQUE,
  parent_channel_id TEXT,
  category_id TEXT NOT NULL,
  category_name TEXT NOT NULL DEFAULT '',
  is_thread BOOLEAN NOT NULL DEFAULT false,
  is_private_thread BOOLEAN NOT NULL DEFAULT false,
  provider_verified_by TEXT NOT NULL DEFAULT 'category',
  player_discord_id TEXT,
  player_username TEXT,
  status TEXT NOT NULL DEFAULT 'initializing'
    CHECK (status IN (
      'initializing',
      'active',
      'lookup_pending',
      'ready_for_review',
      'human_handoff',
      'closing'
    )),
  welcome_sent BOOLEAN NOT NULL DEFAULT false,
  report_delivered BOOLEAN NOT NULL DEFAULT false,
  config_version INTEGER NOT NULL DEFAULT 1,
  config_snapshot JSONB NOT NULL,
  last_processed_message_id TEXT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_sessions_guild_status
  ON public.ticket_sessions(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_ticket_sessions_channel_id
  ON public.ticket_sessions(channel_id);

DROP TRIGGER IF EXISTS trg_ticket_sessions_updated_at ON public.ticket_sessions;
CREATE TRIGGER trg_ticket_sessions_updated_at
  BEFORE UPDATE ON public.ticket_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. ticket_messages (TEMPORARY — cascades on ticket_sessions delete)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ticket_sessions(id) ON DELETE CASCADE,
  discord_message_id TEXT UNIQUE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('player', 'assistant', 'staff', 'system')),
  sender_discord_id TEXT,
  content TEXT NOT NULL,
  redacted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_session_created
  ON public.ticket_messages(session_id, created_at ASC);

-- ----------------------------------------------------------------------------
-- 5. ticket_answers (TEMPORARY — cascades on ticket_sessions delete)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ticket_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ticket_sessions(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  answer_value JSONB NOT NULL,
  raw_text TEXT,
  validated BOOLEAN NOT NULL DEFAULT true,
  validation_note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT uq_ticket_answers_session_key UNIQUE (session_id, question_key)
);

CREATE INDEX IF NOT EXISTS idx_ticket_answers_session
  ON public.ticket_answers(session_id);

DROP TRIGGER IF EXISTS trg_ticket_answers_updated_at ON public.ticket_answers;
CREATE TRIGGER trg_ticket_answers_updated_at
  BEFORE UPDATE ON public.ticket_answers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. player_lookups (TEMPORARY — cascades on ticket_sessions delete)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.player_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.ticket_sessions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  query_target TEXT NOT NULL,
  approved_command TEXT NOT NULL,
  command_message_id TEXT,
  response_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed', 'timed_out', 'unsupported')),
  parsed_data JSONB,
  error_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_player_lookups_session_status
  ON public.player_lookups(session_id, status);

-- ----------------------------------------------------------------------------
-- 7. staff_reports (TEMPORARY — cascades on ticket_sessions delete)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE REFERENCES public.ticket_sessions(id) ON DELETE CASCADE,
  destination_channel_id TEXT,
  delivered_message_id TEXT,
  player_summary_message_id TEXT,
  report_payload JSONB NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'delivered', 'failed')),
  delivery_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_staff_reports_session
  ON public.staff_reports(session_id);

DROP TRIGGER IF EXISTS trg_staff_reports_updated_at ON public.staff_reports;
CREATE TRIGGER trg_staff_reports_updated_at
  BEFORE UPDATE ON public.staff_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. dashboard_admins (Persistent administrator & moderator allowlist)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id TEXT NOT NULL REFERENCES public.server_settings(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT,
  discord_role_id TEXT,
  supabase_user_id UUID,
  label TEXT NOT NULL DEFAULT '',
  permission_level TEXT NOT NULL DEFAULT 'moderator'
    CHECK (permission_level IN ('owner', 'admin', 'moderator')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_dashboard_admins_principal
    CHECK (discord_user_id IS NOT NULL OR discord_role_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_admins_guild_user
  ON public.dashboard_admins(guild_id, discord_user_id)
  WHERE discord_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dashboard_admins_guild_role
  ON public.dashboard_admins(guild_id, discord_role_id)
  WHERE discord_role_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_dashboard_admins_updated_at ON public.dashboard_admins;
CREATE TRIGGER trg_dashboard_admins_updated_at
  BEFORE UPDATE ON public.dashboard_admins
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
