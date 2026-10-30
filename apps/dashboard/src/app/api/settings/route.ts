import { NextResponse } from 'next/server';
import { verifyDashboardModerator } from '@/lib/auth/guard';
import { updateServerSettingsSection } from '@/lib/data/dashboardDataService';

export async function PATCH(req: Request) {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const updated = await updateServerSettingsSection(auth.moderator.guildId, body);
    return NextResponse.json({ settings: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed updating server settings' },
      { status: 400 }
    );
  }
}

