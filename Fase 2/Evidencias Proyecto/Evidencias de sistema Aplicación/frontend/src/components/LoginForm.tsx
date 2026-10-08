'use client';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { isRecord } from '@/lib/auth';
export function LoginForm({
  expired,
  canRefresh,
}: {
  expired: boolean;
  canRefresh: boolean;
}): ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function authenticate(
    path: string,
    body?: { email: string; password: string },
  ): Promise<undefined> {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          isRecord(data) && typeof data.message === 'string'
            ? data.message
            : 'No se pudo iniciar sesión. Intenta nuevamente.',
        );
        return;
      }
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError('No se pudo conectar. Revisa tu conexión e intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<undefined> {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await authenticate('/api/auth/login', {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    });
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-5" aria-busy={loading}>
      {expired && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          Inicia sesión o renueva tu sesión para continuar.
        </p>
      )}
      {error && (
        <p
          role="alert"
          id="login-error"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">
          Correo electrónico
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
          disabled={loading}
          aria-describedby={error ? 'login-error' : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
          placeholder="nombre@moi-food.cl"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          maxLength={128}
          disabled={loading}
          aria-describedby={error ? 'login-error' : undefined}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:ring-2 focus:ring-emerald-600 disabled:opacity-60"
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:opacity-60"
      >
        {loading ? 'Conectando…' : 'Ingresar'}
      </button>
      {canRefresh && (
        <button
          type="button"
          disabled={loading}
          onClick={() => authenticate('/api/auth/refresh')}
          className="w-full rounded-lg border border-emerald-700 px-4 py-3 font-semibold text-emerald-800 disabled:opacity-60"
        >
          Renovar sesión anterior
        </button>
      )}
    </form>
  );
}
