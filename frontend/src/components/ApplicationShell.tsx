import { brandTitleClass, brandCaptionClass } from '@/components/ui/styles';
import Image from 'next/image';
import type { ReactElement, ReactNode } from 'react';
import type { Role } from '@/lib/auth';
import {
  ApplicationNavigation,
  ApplicationHeading,
} from './ApplicationNavigation';
import { SessionMenu } from './SessionMenu';

const roleLabels: Record<Role, string> = {
  ADMINISTRADOR: 'Administrador',
  CONTADOR: 'Contador',
  SUPERVISOR: 'Supervisor',
  TRABAJADOR: 'Trabajador',
};

export function ApplicationShell({
  user,
  children,
}: {
  user: { email: string; role: Role };
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
        <div className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5 lg:py-5">
          <Image
            src="/logo.png"
            alt=""
            width={46}
            height={46}
            className="rounded-xl border border-line"
            priority
          />
          <div>
            <p className={brandTitleClass}>
              Moi<span className="text-salmon-deep">Food</span>
            </p>
            <p className={`${brandCaptionClass} mt-0.5`}>Gestión interna</p>
          </div>
        </div>
        <ApplicationNavigation role={user.role} />
        <div className="border-t border-line px-4 py-3 sm:px-5 lg:mt-auto lg:py-4">
          <p className="break-all text-[13px] font-semibold">{user.email}</p>
          <p className="mt-1 text-xs text-salmon-ink">
            {roleLabels[user.role]}
          </p>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-line bg-bg px-4 py-3 sm:px-5 lg:px-7">
          <ApplicationHeading />
          <SessionMenu />
        </header>
        <main
          id="application-content"
          tabIndex={-1}
          className="min-w-0 space-y-5 px-4 py-5 wrap-anywhere sm:px-5 sm:py-6 lg:px-7"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
