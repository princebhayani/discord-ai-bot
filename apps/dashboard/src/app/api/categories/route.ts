import { NextResponse } from 'next/server';
import { z } from 'zod';
import { SnowflakeSchema } from '@hrbot/shared';
import { verifyDashboardModerator } from '@/lib/auth/guard';
import {
  deleteCategoryConfig,
  upsertAndPublishCategoryConfig,
} from '@/lib/data/dashboardDataService';

export async function PUT(req: Request) {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  try {
    const body = (await req.json()) as unknown;
    const saved = await upsertAndPublishCategoryConfig(auth.moderator.guildId, body);
    return NextResponse.json({ category: saved });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed publishing category config' },
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
      { error: 'Only server owners or admins can delete category configurations.' },
      { status: 403 }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const categoryId = SnowflakeSchema.parse(searchParams.get('categoryId') ?? '');
    await deleteCategoryConfig(auth.moderator.guildId, categoryId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof z.ZodError ? 'Invalid categoryId' : 'Failed deleting category';
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

