'use client';

import { useTransition, type ReactElement } from 'react';
import { SessionActions } from '@/components/SessionActions';
import { buttonClass } from '@/components/ui/styles';

export function SessionRecovery({
  onRetry,
  title = 'No se pudo verificar tu sesión',
}: {
  onRetry: () => undefined;
  title?: string;
}): ReactElement {
  const [pending, startTransition] = useTransition();
  return (
    <section
      className="space-y-5 rounded-[14px] border border-line bg-bg p-5"
      aria-labelledby="session-unavailable-title"
      aria-busy={pending}
    >
      <h1 id="session-unavailable-title" className="text-xl font-bold">
        {title}
      </h1>
      <p role="alert" className="text-sm leading-6 text-ink2">
        El servicio no está disponible en este momento. Intenta nuevamente o
        cierra tu sesión en este dispositivo.
      </p>
      <button
        type="button"
        disabled={pending}
        className={buttonClass}
        onClick={() => startTransition(onRetry)}
      >
        {pending ? 'Intentando…' : 'Intentar nuevamente'}
      </button>
      <SessionActions />
    </section>
  );
}
