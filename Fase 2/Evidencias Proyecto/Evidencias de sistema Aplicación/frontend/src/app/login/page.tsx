'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { mockLogin, setSessionCookie, landingPathForRole } from '@/lib/mock-auth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // TODO(SPRINT-1-T06): reemplazar por POST /auth/login contra NestJS.
    const user = mockLogin(email, password);
    setLoading(false);

    if (!user) {
      setError('Correo o contraseña incorrectos.');
      return;
    }
    setSessionCookie(user);
    router.push(landingPathForRole(user.rol));
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <Card className="w-full max-w-[360px]">
        <form onSubmit={handleSubmit}>
          <div className="text-center mb-5.5">
            <div className="w-11 h-11 mx-auto mb-2.5 rounded-xl bg-salmon text-white flex items-center justify-center font-extrabold">
              M
            </div>
            <div className="font-extrabold text-[17px]">
              Moi<span className="text-salmon-deep">Food</span>
            </div>
            <div className="font-mono text-[10px] tracking-widest uppercase text-muted mt-1">
              Gestión interna
            </div>
          </div>

          {error && (
            <div className="bg-crit-bg text-crit rounded-lg px-3.5 py-2.5 text-[12.5px] mb-3.5">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5 mb-4">
            <label htmlFor="email" className="text-[12.5px] font-semibold text-ink2">
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@moifood.cl"
              className="border border-line2 rounded-lg px-3.5 py-2.5 bg-bg text-ink
                         focus:outline-none focus:ring-2 focus:ring-salmon"
            />
          </div>

          <div className="flex flex-col gap-1.5 mb-4">
            <label htmlFor="password" className="text-[12.5px] font-semibold text-ink2">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="border border-line2 rounded-lg px-3.5 py-2.5 bg-bg text-ink
                         focus:outline-none focus:ring-2 focus:ring-salmon"
            />
          </div>

          <Button type="submit" variant="primary" size="md" className="w-full" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </Button>

          <div className="mt-4 font-mono text-[10px] text-center text-muted border border-dashed border-line2 rounded-lg px-2.5 py-1.5">
            Mock — usar admin@moifood.cl / admin123 o trabajador@moifood.cl / trabajo123
          </div>
        </form>
      </Card>
    </main>
  );
}
