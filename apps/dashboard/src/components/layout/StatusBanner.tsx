'use client';

import type { SaveStatus } from '@/hooks/useSaveStatus';

export function StatusBanner({ status }: { status: SaveStatus }) {
  if (status.state === 'idle' || !status.message) {
    return null;
  }

  const styleMap = {
    saving: 'border-blue-500/30 bg-blue-500/10 text-blue-800',
    saved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800',
    error: 'border-red-500/30 bg-red-500/10 text-red-800',
  };

  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm font-medium ${styleMap[status.state]}`}
      role="status"
    >
      {status.message}
    </div>
  );
}

