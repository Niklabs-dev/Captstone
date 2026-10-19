'use client';

import type { ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { SessionRecovery } from '@/components/SessionRecovery';
import { brandCaptionClass, brandTitleClass } from '@/components/ui/styles';

// Sin validación del backend no se muestra identidad, rol ni contenido privado.
export function SessionUnavailable(): ReactElement {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-tint text-ink">
      <header className="border-b border-line bg-bg px-5 py-5 lg:px-7">
        <p className={brandTitleClass}>
          Moi<span className="text-salmon-deep">Food</span>
        </p>
        <p className={`${brandCaptionClass} mt-0.5`}>Gestión interna</p>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-8">
        <SessionRecovery
          onRetry={() => {
            router.refresh();
          }}
        />
      </main>
    </div>
  );
}
