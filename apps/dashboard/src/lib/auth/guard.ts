import 'server-only';
import { redirect } from 'next/navigation';
import {
  createSupabaseServiceClient,
  createSupabaseSsrClient,
  isSupabaseConfigured,
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
  const guildId = process.env.DEFAULT_GUILD_ID ?? process.env.DISCORD_GUILD_ID ?? '';
  return guildId.trim();
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
    }
> {
  const guildId = getTargetGuildId();
  if (!isSupabaseConfigured() || !guildId) {
    return {
      authorized: false,
      reason: 'unconfigured',
      message:
        'Supabase environment variables (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) and DEFAULT_GUILD_ID must be configured.',
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

  const discordIdentity = user.identities?.find((id) => id.provider === 'discord');
  const metadata = user.user_metadata ?? {};
  const discordUserId = String(
    discordIdentity?.id ?? metadata.provider_id ?? metadata.sub ?? ''
  ).trim();

  if (!discordUserId) {
    return {
      authorized: false,
      reason: 'forbidden',
      message: 'Your account is not linked to a verified Discord OAuth2 identity.',
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
      message: 'Unable to verify moderator allowlist in Supabase.',
    };
  }

  const entries = (allowlistRows ?? []) as Array<Record<string, unknown>>;

  // 1. Direct Discord User ID or Supabase User ID match
  const directMatch = entries.find(
    (row) =>
      row.discord_user_id === discordUserId || row.supabase_user_id === user.id
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
      message: `Discord user ID ${discordUserId} is not on the approved moderator/role allowlist for guild ${guildId}.`,
    };
  }

  // Link supabase_user_id on first verified login for fast RLS checks
  if (matchedRow.discord_user_id === discordUserId && !matchedRow.supabase_user_id) {
    await serviceClient
      .from('dashboard_admins')
      .update({ supabase_user_id: user.id })
      .eq('id', matchedRow.id);
  }

  const perm = String(matchedRow.permission_level ?? 'moderator');
  const permissionLevel: VerifiedModeratorContext['permissionLevel'] =
    perm === 'owner' || perm === 'admin' ? perm : 'moderator';

  return {
    authorized: true,
    moderator: {
      supabaseUserId: user.id,
      discordUserId,
      username: String(
        metadata.full_name ?? metadata.name ?? metadata.custom_claims?.global_name ?? 'Moderator'
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
    redirect(`/login?${params.toString()}`);
  }
  return check.moderator;
}

