'use client';
import { useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { isRecord } from '@/lib/auth';
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
      else setMessage('Sesión renovada.');
      router.refresh();
    } catch {
      setMessage('No se pudo conectar. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="space-y-3" aria-busy={loading}>
      <div className="flex flex-wrap gap-3">
        <button
          disabled={loading}
          onClick={() => perform('refresh')}
          className="rounded-lg border border-emerald-700 px-4 py-2 font-medium text-emerald-800 disabled:opacity-60"
        >
          Renovar sesión
        </button>
        <button
          disabled={loading}
          onClick={() => perform('logout')}
          className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white disabled:opacity-60"
        >
          Cerrar sesión
        </button>
      </div>
      <p role="status" className="text-sm text-slate-700">
        {message}
      </p>
    </div>
  );
}
