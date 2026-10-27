'use client';
import { buttonClass, primaryButtonClass } from '@/components/ui/styles';
import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { isRecord } from '@/lib/auth';
import { isHomePath } from '@/lib/navigation';
export function SessionActions(): ReactElement {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  async function perform(action: 'refresh' | 'logout'): Promise<undefined> {
    if (loading) return;
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`/api/auth/${action}`, { method: 'POST' });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(
          isRecord(data) && typeof data.message === 'string'
            ? data.message
            : 'No se pudo completar la solicitud.',
        );
        if (response.status === 401) {
          router.replace('/login?reason=session');
          router.refresh();
        }
        return;
      }
      if (action === 'logout') router.replace('/login');
      else if (isRecord(data) && isHomePath(data.redirectTo)) {
        setMessage('Sesión renovada.');
        router.replace(data.redirectTo);
      } else
        setMessage('No se pudo abrir tu cuenta. Inicia sesión nuevamente.');
      router.refresh();
    } catch {
      setMessage('No se pudo conectar. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3" aria-busy={loading}>
      <div className="flex flex-col gap-3">
        <button
          disabled={loading}
          onClick={() => perform('refresh')}
          className={buttonClass}
        >
          Renovar sesión
        </button>
        <button
          disabled={loading}
          onClick={() => perform('logout')}
          className={primaryButtonClass}
        >
          Cerrar sesión
        </button>
      </div>
      <p role="status" className="text-sm text-ink2">
        {message}
      </p>
    </div>
  );
}
