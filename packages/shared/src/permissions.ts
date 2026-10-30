/**
 * Strict Discord permission bitfields (matching Discord API v10 flags)
 * enforcing the non-negotiable least-privilege boundary for Bot 2.
 */
export const ALLOWED_CHANNEL_PERMISSIONS = {
  ViewChannel: 1n << 10n,           // 1024
  SendMessages: 1n << 11n,          // 2048
  EmbedLinks: 1n << 14n,            // 16384
  ReadMessageHistory: 1n << 16n,    // 65536
  SendMessagesInThreads: 1n << 38n, // 274877906944
} as const;

export const FORBIDDEN_PERMISSIONS = {
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageRoles: 1n << 28n,
  ManageThreads: 1n << 34n,
  CreatePublicThreads: 1n << 35n,
  CreatePrivateThreads: 1n << 36n,
} as const;

export const REQUIRED_PERMISSION_BITFIELD: bigint =
  ALLOWED_CHANNEL_PERMISSIONS.ViewChannel |
  ALLOWED_CHANNEL_PERMISSIONS.SendMessages |
  ALLOWED_CHANNEL_PERMISSIONS.EmbedLinks |
  ALLOWED_CHANNEL_PERMISSIONS.ReadMessageHistory |
  ALLOWED_CHANNEL_PERMISSIONS.SendMessagesInThreads;

export const FORBIDDEN_PERMISSION_MASK: bigint =
  FORBIDDEN_PERMISSIONS.Administrator |
  FORBIDDEN_PERMISSIONS.ManageChannels |
  FORBIDDEN_PERMISSIONS.ManageRoles |
  FORBIDDEN_PERMISSIONS.ManageThreads |
  FORBIDDEN_PERMISSIONS.CreatePublicThreads |
  FORBIDDEN_PERMISSIONS.CreatePrivateThreads;

/**
 * Verifies a permission bitfield never requests any ticket-management or administrative permissions.
 */
export function assertLeastPrivilegePermissions(bitfield: bigint): void {
  const overlap = bitfield & FORBIDDEN_PERMISSION_MASK;
  if (overlap !== 0n) {
    const names = Object.entries(FORBIDDEN_PERMISSIONS)
      .filter(([, flag]) => (overlap & flag) !== 0n)
      .map(([name]) => name);
    throw new Error(
      `Forbidden ticket-management permission(s) detected: ${names.join(', ')}`
    );
  }
}

/**
 * Generates an OAuth2 bot invite link with ONLY the minimal observation/conversation permissions.
 */
export function buildLeastPrivilegeBotInviteUrl(clientId: string): string {
  assertLeastPrivilegePermissions(REQUIRED_PERMISSION_BITFIELD);
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    scope: 'bot',
    permissions: REQUIRED_PERMISSION_BITFIELD.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

