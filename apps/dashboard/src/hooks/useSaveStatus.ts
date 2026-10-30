'use client';

import { useState, useCallback } from 'react';

export interface SaveStatus {
  state: 'idle' | 'saving' | 'saved' | 'error';
  message?: string;
}

export function useSaveStatus() {
  const [status, setStatus] = useState<SaveStatus>({ state: 'idle' });

  const runSave = useCallback(async (fn: () => Promise<string | void>) => {
    setStatus({ state: 'saving', message: 'Publishing configuration...' });
    try {
      const msg = await fn();
      setStatus({
        state: 'saved',
        message: msg || 'Configuration published. New tickets will use this version.',
      });
    } catch (err) {
      setStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Failed to save configuration.',
      });
    }
  }, []);

  return { status, runSave };
}

