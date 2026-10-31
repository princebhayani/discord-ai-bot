import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import {
  DEPRECATED_GROQ_MODEL_REPLACEMENTS,
  getGroqModelCapabilities,
  KNOWN_GROQ_MODELS,
} from '@hrbot/shared';
import { verifyDashboardModerator } from '@/lib/auth/guard';

export async function GET() {
  const auth = await verifyDashboardModerator();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.message }, { status: 403 });
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({
      source: 'curated_catalog',
      models: KNOWN_GROQ_MODELS,
    });
  }

  try {
    const groq = new Groq({ apiKey });
    const list = await groq.models.list();
    const liveIds = (list.data ?? [])
      .map((m) => m.id)
      .filter(
        (id) =>
          !id.includes('whisper') &&
          !id.includes('orpheus') &&
          !id.includes('guard') &&
          !id.includes('tts') &&
          !DEPRECATED_GROQ_MODEL_REPLACEMENTS[id]
      );

    const mergedMap = new Map(KNOWN_GROQ_MODELS.map((m) => [m.id, m]));
    for (const id of liveIds) {
      if (!mergedMap.has(id)) {
        mergedMap.set(id, getGroqModelCapabilities(id));
      }
    }

    return NextResponse.json({
      source: 'groq_live_api',
      models: Array.from(mergedMap.values()),
    });
  } catch {
    return NextResponse.json({
      source: 'curated_catalog_fallback',
      models: KNOWN_GROQ_MODELS,
    });
  }
}

