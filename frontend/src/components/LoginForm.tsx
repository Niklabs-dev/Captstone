'use client';
import {
  inputClass,
  buttonClass,
  primaryButtonClass,
  labelClass,
} from '@/components/ui/styles';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { isRecord } from '@/lib/auth';
import { isHomePath } from '@/lib/navigation';
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
      if (!isRecord(data) || !isHomePath(data.redirectTo)) {
        setError('No se pudo abrir tu cuenta. Intenta nuevamente.');
        return;
      }
      router.replace(data.redirectTo);
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
    <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
      {expired && (
        <p className="rounded-lg bg-warn-bg p-3 text-sm text-ink2">
          Inicia sesión o renueva tu sesión para continuar.
        </p>
      )}
      {error && (
        <p
          role="alert"
          id="login-error"
          className="rounded-lg bg-crit-bg p-3 text-sm text-crit"
        >
          {error}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="email" className={labelClass}>
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
          className={inputClass}
          placeholder="nombre@moi-food.cl"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className={labelClass}>
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
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className={`${primaryButtonClass} w-full`}
      >
        {loading ? 'Conectando…' : 'Ingresar'}
      </button>
      {canRefresh && (
        <button
          type="button"
          disabled={loading}
          onClick={() => authenticate('/api/auth/refresh')}
          className={`${buttonClass} w-full`}
        >
          Renovar sesión anterior
        </button>
      )}
    </form>
  );
}
