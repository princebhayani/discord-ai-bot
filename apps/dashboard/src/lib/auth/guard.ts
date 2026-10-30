import 'server-only';
import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import {
  createSupabaseServiceClient,
  createSupabaseSsrClient,
  getMissingSupabaseEnvVars,
} from '../supabase/server';

export interface VerifiedModeratorContext {
  supabaseUserId: string;
  discordUserId: string;
  username: string;
  avatarUrl: string | null;
  guildId: string;
  permissionLevel: 'owner' | 'admin' | 'moderator';
}

export function getTargetGuildId(): string {
  const guildId = process.env.DISCORD_GUILD_ID ?? process.env.DEFAULT_GUILD_ID ?? '';
  return guildId.trim();
}

/**
 * Resolves the target Discord Guild ID from env (DISCORD_GUILD_ID / DEFAULT_GUILD_ID),
 * or auto-discovers it from Supabase when a single guild is configured in `server_settings`
 * or `dashboard_admins` so single-server deployments don't need extra Vercel env vars.
 */
async function resolveGuildId(): Promise<string> {
  const fromEnv = getTargetGuildId();
  if (fromEnv) {
    return fromEnv;
  }

  try {
    const serviceClient = createSupabaseServiceClient();
    const { data: settingsRows } = await serviceClient
      .from('server_settings')
      .select('guild_id')
      .limit(2);

    if (settingsRows && settingsRows.length === 1 && settingsRows[0]?.guild_id) {
      return String(settingsRows[0].guild_id).trim();
    }

    const { data: adminRows } = await serviceClient
      .from('dashboard_admins')
      .select('guild_id')
      .eq('active', true)
      .limit(20);

    const uniqueAdminGuilds = Array.from(
      new Set(
        (adminRows ?? [])
          .map((r) => String((r as Record<string, unknown>).guild_id ?? '').trim())
          .filter(Boolean)
      )
    );
    if (uniqueAdminGuilds.length === 1 && uniqueAdminGuilds[0]) {
      return uniqueAdminGuilds[0];
    }
  } catch {
    // Fall through to empty string if DB query fails
  }

  return '';
}

/**
 * Extracts the 15-22 digit Discord Snowflake User ID from Supabase Auth v2 user object.
 * Never returns `identity.id` (which is Supabase's internal UUID in GoTrue v2).
 */
export function extractDiscordSnowflakeId(user: User): string {
  const discordIdentity = user.identities?.find((id) => id.provider === 'discord');
  const identityRecord = (discordIdentity ?? {}) as unknown as Record<string, unknown>;
  const identityData =
    (discordIdentity?.identity_data as Record<string, unknown> | undefined) ?? {};
  const metadata = (user.user_metadata as Record<string, unknown> | undefined) ?? {};

  const candidates = [
    identityRecord.provider_id,
    identityData.provider_id,
    identityData.sub,
    identityData.id,
    metadata.provider_id,
    metadata.sub,
  ]
    .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
    .filter(Boolean);

  // Prefer strict numeric Discord Snowflake IDs (15-22 digits) over any UUID strings
  const snowflake = candidates.find((c) => /^\d{15,22}$/.test(c));
  return snowflake ?? candidates[0] ?? '';
}

async function fetchDiscordMemberRoles(
  guildId: string,
  discordUserId: string
): Promise<string[]> {
  const botToken = process.env.DASHBOARD_DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN;
  if (!botToken || !guildId || !discordUserId) {
    return [];
  }

  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      {
        headers: { Authorization: `Bot ${botToken}` },
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { roles?: unknown };
    return Array.isArray(data.roles)
      ? data.roles.filter((r): r is string => typeof r === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Verifies the caller is signed in via Discord OAuth2 (Supabase Auth) AND matches
 * an active user or Discord role allowlist entry in `dashboard_admins`.
 */
export async function verifyDashboardModerator(): Promise<
  | { authorized: true; moderator: VerifiedModeratorContext }
  | {
      authorized: false;
      reason: 'unconfigured' | 'unauthenticated' | 'forbidden';
      message: string;
      missingVars?: string[];
      discordUserId?: string;
      guildId?: string;
    }
> {
  const missingVars = getMissingSupabaseEnvVars();
  if (missingVars.length > 0) {
    return {
      authorized: false,
      reason: 'unconfigured',
      missingVars,
      message: `Missing required Vercel environment variables: ${missingVars.join(', ')}`,
    };
  }

  const ssrClient = await createSupabaseSsrClient();
  const {
    data: { user },
    error: authError,
  } = await ssrClient.auth.getUser();

  if (authError || !user) {
    return {
      authorized: false,
      reason: 'unauthenticated',
      message: 'Please sign in with Discord OAuth2 to access the moderator dashboard.',
    };
  }

  const discordUserId = extractDiscordSnowflakeId(user);
  if (!discordUserId) {
    return {
      authorized: false,
      reason: 'forbidden',
      message: 'Your account is not linked to a verified Discord OAuth2 identity.',
    };
  }

  const guildId = await resolveGuildId();
  if (!guildId) {
    return {
      authorized: false,
      reason: 'unconfigured',
      missingVars: ['DISCORD_GUILD_ID'],
      discordUserId,
      message:
        'No Discord Guild ID found. Either seed `server_settings` in Supabase SQL Editor or set `DISCORD_GUILD_ID` on Vercel.',
    };
  }

  const serviceClient = createSupabaseServiceClient();
  const { data: allowlistRows, error: dbErr } = await serviceClient
    .from('dashboard_admins')
    .select('*')
    .eq('guild_id', guildId)
    .eq('active', true);

  if (dbErr) {
    return {
      authorized: false,
      reason: 'forbidden',
      discordUserId,
      guildId,
      message: `Unable to read dashboard_admins in Supabase (${dbErr.message}). Make sure SQL migrations 0001 and 0002 have been executed.`,
    };
  }

  const entries = (allowlistRows ?? []) as Array<Record<string, unknown>>;

  // 1. Direct Discord User ID or Supabase User ID match
  const directMatch = entries.find(
    (row) =>
      String(row.discord_user_id ?? '').trim() === discordUserId ||
      row.supabase_user_id === user.id
  );

  let matchedRow = directMatch;

  // 2. Approved Discord Guild Role ID allowlist match
  if (!matchedRow) {
    const allowedRoleRows = entries.filter(
      (row) => typeof row.discord_role_id === 'string' && row.discord_role_id.length > 0
    );
    if (allowedRoleRows.length > 0) {
      const memberRoles = await fetchDiscordMemberRoles(guildId, discordUserId);
      matchedRow = allowedRoleRows.find((row) =>
        memberRoles.includes(String(row.discord_role_id))
      );
    }
  }

  if (!matchedRow) {
    return {
      authorized: false,
      reason: 'forbidden',
      discordUserId,
      guildId,
      message: `Discord User ID ${discordUserId} is not on the approved dashboard_admins allowlist for server ${guildId}.`,
    };
  }

  // Link supabase_user_id on first verified login for fast RLS checks
  if (String(matchedRow.discord_user_id ?? '').trim() === discordUserId && !matchedRow.supabase_user_id) {
    await serviceClient
      .from('dashboard_admins')
      .update({ supabase_user_id: user.id })
      .eq('id', matchedRow.id);
  }

  const metadata = (user.user_metadata as Record<string, unknown> | undefined) ?? {};
  const customClaims =
    (metadata.custom_claims as Record<string, unknown> | undefined) ?? {};
  const perm = String(matchedRow.permission_level ?? 'moderator');
  const permissionLevel: VerifiedModeratorContext['permissionLevel'] =
    perm === 'owner' || perm === 'admin' ? perm : 'moderator';

  return {
    authorized: true,
    moderator: {
      supabaseUserId: user.id,
      discordUserId,
      username: String(
        metadata.full_name ?? metadata.name ?? customClaims.global_name ?? 'Moderator'
      ),
      avatarUrl: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
      guildId,
      permissionLevel,
    },
  };
}

export async function requireDashboardModerator(): Promise<VerifiedModeratorContext> {
  const check = await verifyDashboardModerator();
  if (!check.authorized) {
    const params = new URLSearchParams({ reason: check.reason });
    if (check.missingVars && check.missingVars.length > 0) {
      params.set('missing', check.missingVars.join(', '));
    }
    if (check.discordUserId) {
      params.set('uid', check.discordUserId);
    }
    if (check.guildId) {
      params.set('gid', check.guildId);
    }
    redirect(`/login?${params.toString()}`);
  }
  return check.moderator;
}
