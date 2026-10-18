'use client';

import type { ReactElement } from 'react';
import { SessionRecovery } from '@/components/SessionRecovery';

// La cabecera y navegación pertenecen al layout padre y se conservan.
export default function AuthenticatedError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): ReactElement {
  return (
    <div className="max-w-2xl">
      <SessionRecovery
        title="No se pudo cargar esta vista"
        onRetry={() => {
          retry();
        }}
      />
    </div>
  );
}
