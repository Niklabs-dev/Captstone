import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { UsersPanel } from '@/components/users/UsersPanel';
import { getUsersSession } from '@/lib/users-session';
import { listManagedUsers } from '@/lib/users-backend';
import { collectStores, type StoreOption } from '@/lib/users';
export const metadata: Metadata = { title: 'Usuarios | MoiFood' };
export default async function UsersPage(): Promise<ReactElement> {
  const session = await getUsersSession();
  if (!session.ok) {
    if (session.status === 401) redirect('/login?reason=session');
    if (session.status === 403) redirect('/dashboard?reason=forbidden');
    return (
      <main className="mx-auto max-w-lg p-6">
        <h1 className="text-xl font-bold">Usuarios</h1>
        <p role="alert" className="mt-4 text-u-crit">
          {session.message}
        </p>
        <Link href="/admin/usuarios" className="mt-4 inline-block underline">
          Intentar nuevamente
        </Link>
      </main>
    );
  }
  const result = await listManagedUsers(session.token);
  if (!result.ok && result.status === 401) redirect('/login?reason=session');
  if (!result.ok && result.status === 403)
    redirect('/dashboard?reason=forbidden');
  const users = result.ok ? result.data : [];
  let stores: StoreOption[] = [];
  let error = result.ok ? '' : result.message;
  try {
    stores = collectStores(
      users,
      JSON.parse(process.env.USER_MANAGEMENT_STORES ?? '[]') as unknown,
    );
  } catch {
    error =
      'No se pudo cargar el catálogo de locales. Intenta nuevamente más tarde.';
  }
  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_1fr]">
      <aside className="flex flex-col border-b border-u-line bg-u-bg md:sticky md:top-0 md:h-screen md:border-r md:border-b-0">
        <div className="flex items-center gap-3 border-b border-u-line px-5 py-5">
          <Image
            src="/moi-food-logo.png"
            alt=""
            width={46}
            height={46}
            className="rounded-xl border border-u-line"
            priority
          />
          <div>
            <p className="text-base font-extrabold tracking-tight">
              Moi<span className="text-u-salmon-deep">Food</span>
            </p>
            <p className="mt-0.5 font-u-mono text-[9.5px] uppercase tracking-[0.14em] text-u-muted">
              Gestión interna
            </p>
          </div>
        </div>
        <nav aria-label="Administración" className="flex-1 px-2.5 py-4">
          <p className="mb-2 px-2.5 font-u-mono text-[9px] uppercase tracking-[0.18em] text-u-muted">
            Núcleo transversal
          </p>
          <Link
            href="/admin/usuarios"
            aria-current="page"
            className="block rounded-[9px] bg-u-tint2 px-3 py-2.5 text-[13.5px] font-semibold text-u-salmon-ink"
          >
            Usuarios
          </Link>
        </nav>
        <div className="hidden border-t border-u-line px-4 py-4 md:block">
          <p className="break-all text-[13px] font-semibold">
            {session.user.email}
          </p>
          <p className="mt-1 font-u-mono text-[9.5px] uppercase tracking-widest text-u-salmon-deep">
            Administrador
          </p>
          <Link
            href="/dashboard"
            className="mt-3 inline-block text-xs text-u-ink2 underline"
          >
            Volver al inicio
          </Link>
        </div>
      </aside>
      <main className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-u-line bg-u-bg px-5 py-3 sm:px-7">
          <div>
            <p className="font-u-mono text-[10px] uppercase tracking-widest text-u-muted">
              Núcleo transversal
            </p>
            <h1 className="text-[17px] font-bold tracking-tight">
              Usuarios y roles
            </h1>
          </div>
          <span className="rounded-[9px] bg-u-tint px-3 py-2 font-u-mono text-[10px] text-u-ink2">
            Administrador
          </span>
        </header>
        <div className="px-4 py-6 pb-16 sm:px-7">
          <UsersPanel
            initialUsers={users}
            initialError={error}
            currentUserId={session.user.id}
            stores={stores}
          />
        </div>
      </main>
    </div>
  );
}
