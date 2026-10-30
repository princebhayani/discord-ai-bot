import { NextResponse } from 'next/server';
import { z } from 'zod';
import { OptionalSnowflakeSchema } from '@hrbot/shared';
import { verifyDashboardModerator } from '@/lib/auth/guard';
import {
  addDashboardAdmin,
  removeDashboardAdmin,
} from '@/lib/data/dashboardDataService';

const AddAdminSchema = z
  .object({
    discordUserId: OptionalSnowflakeSchema.optional(),
    discordRoleId: OptionalSnowflakeSchema.optional(),
    label: z.string().trim().min(1).max(80),
    permissionLevel: z.enum(['owner', 'admin', 'moderator']).default('moderator'),
  })
  .refine(
    (d) => Boolean(d.discordUserId || d.discordRoleId),
    'Provide either a Discord User ID or Discord Role ID'
  );

export async function POST(req: Request) {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  if (
    auth.moderator.permissionLevel !== 'owner' &&
    auth.moderator.permissionLevel !== 'admin'
  ) {
    return NextResponse.json(
      { error: 'Only owners or admins can modify dashboard administrator allowlists.' },
      { status: 403 }
    );
  }

  try {
    const parsed = AddAdminSchema.parse(await req.json());
    const entry = await addDashboardAdmin({
      guildId: auth.moderator.guildId,
      discordUserId: parsed.discordUserId,
      discordRoleId: parsed.discordRoleId,
      label: parsed.label,
      permissionLevel: parsed.permissionLevel,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid administrator entry' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: Request) {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  if (
    auth.moderator.permissionLevel !== 'owner' &&
    auth.moderator.permissionLevel !== 'admin'
  ) {
    return NextResponse.json(
      { error: 'Only owners or admins can remove dashboard administrators.' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = z.string().uuid().parse(searchParams.get('id') ?? '');
    await removeDashboardAdmin(auth.moderator.guildId, id);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'Invalid admin entry ID' }, { status: 400 });
  }
}

