import { cookies } from 'next/headers';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import type { ReactElement } from 'react';
import { LoginForm } from '@/components/LoginForm';
import { REFRESH_COOKIE } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { getHomePath } from '@/lib/navigation';
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<ReactElement> {
  const session = await getSession();
  if (session.ok) redirect(getHomePath(session.data.role));
  const params = await searchParams;
  const canRefresh = Boolean((await cookies()).get(REFRESH_COOKIE)?.value);
  return (
    <main className="flex min-h-screen items-center justify-center bg-tint px-5 py-10 text-ink">
      <section
        className="w-full max-w-[360px] rounded-2xl border border-line bg-bg p-7 "
        aria-labelledby="login-title"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            className="mb-3 rounded-xl border border-line"
            priority
          />
          <p className="text-[17px] font-extrabold tracking-tight">
            Moi<span className="text-salmon-deep">Food</span>
          </p>
          <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
            Gestión interna
          </p>
        </div>
        <h1 id="login-title" className="mb-2 text-lg font-bold">
          Iniciar sesión
        </h1>
        <p className="mb-7 text-sm text-ink2">
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
