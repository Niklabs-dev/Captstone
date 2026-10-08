import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { REFRESH_COOKIE } from '@/lib/auth';
import { getSession } from '@/lib/session';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (session.ok) redirect('/dashboard');
  const params = await searchParams;
  const canRefresh = Boolean((await cookies()).get(REFRESH_COOKIE)?.value);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10 text-slate-900">
      <section
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm"
        aria-labelledby="login-title"
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-emerald-700">
          Moi-food · Gestión interna
        </p>
        <h1 id="login-title" className="mb-2 text-2xl font-bold">
          Iniciar sesión
        </h1>
        <p className="mb-7 text-sm text-slate-600">
          Ingresa con tu cuenta para acceder al sistema.
        </p>
        <LoginForm
          expired={params.reason === 'session'}
          canRefresh={canRefresh}
        />
      </section>
    </main>
  );
}
