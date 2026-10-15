import Image from 'next/image';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import type { Role } from '@/lib/auth';
import { getNavigationItems } from '@/lib/navigation';
import { SessionActions } from './SessionActions';

const roleLabels: Record<Role, string> = {
  ADMINISTRADOR: 'Administrador',
  CONTADOR: 'Contador',
  SUPERVISOR: 'Supervisor',
  TRABAJADOR: 'Trabajador',
};

export function ApplicationShell({
  user,
  activePath,
  title,
  children,
}: {
  user: { email: string; role: Role } | null;
  activePath: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="min-h-screen bg-tint text-ink lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#application-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-30 focus:rounded-lg focus:bg-bg focus:p-3"
      >
        Ir al contenido
      </a>
      <aside className="border-b border-line bg-bg lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="flex items-center gap-3 border-b border-line px-5 py-5">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            className="rounded-xl border border-line"
            priority
          />
          <div>
            <p className="text-base font-extrabold tracking-tight">
              Moi<span className="text-salmon-deep">Food</span>
            </p>
            <p className="mt-0.5 text-xs text-ink2">Gestión interna</p>
          </div>
        </div>
        <nav
          aria-label="Navegación principal"
          className="flex flex-wrap gap-1 px-2.5 py-3 lg:block lg:space-y-1 lg:py-4"
        >
          {getNavigationItems(user?.role ?? null).map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={activePath === item.href ? 'page' : undefined}
              className={`rounded-[9px] px-3 py-2.5 text-[13.5px] outline-offset-2 focus-visible:outline-2 focus-visible:outline-salmon-ink lg:block ${activePath === item.href ? 'bg-tint2 font-semibold text-salmon-ink' : 'text-ink2 hover:bg-tint'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {user && (
          <div className="border-t border-line px-5 py-3 lg:mt-auto lg:py-4">
            <p className="break-all text-[13px] font-semibold">{user.email}</p>
            <p className="mt-1 text-xs text-salmon-ink">
              {roleLabels[user.role]}
            </p>
          </div>
        )}
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line bg-bg px-5 py-3 lg:px-7">
          <h1 className="text-[17px] font-bold tracking-tight">{title}</h1>
          {user && (
            <details className="max-w-full rounded-lg border border-line2 px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold text-salmon-ink">
                Mi sesión
              </summary>
              <div className="mt-3">
                <SessionActions />
              </div>
            </details>
          )}
        </header>
        <main
          id="application-content"
          tabIndex={-1}
          className="space-y-5 px-5 py-6 lg:px-7"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
