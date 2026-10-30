import { describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));

import { extractDiscordSnowflakeId } from './guard.js';

describe('Dashboard Discord OAuth2 Identity Guard', () => {
  it('extracts numeric Discord Snowflake ID instead of Supabase internal identity UUID', () => {
    const mockSupabaseUser = {
      id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      identities: [
        {
          id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // Supabase v2 internal UUID (NOT Discord ID!)
          provider: 'discord',
          identity_data: {
            sub: '987654321098765432',
            full_name: 'Prince',
          },
        },
      ],
      user_metadata: {
        provider_id: '987654321098765432',
      },
    } as unknown as User;

    expect(extractDiscordSnowflakeId(mockSupabaseUser)).toBe('987654321098765432');
  });
});

