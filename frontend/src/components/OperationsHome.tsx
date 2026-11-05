import Link from 'next/link';
import type { ReactElement } from 'react';
import type { Role } from '@/lib/auth';
import { getNavigationItems, type NavigationItem } from '@/lib/navigation';
import { getNavigationIcon } from '@/lib/mobile-navigation';
import { Icon } from './ui/Icon';
import { featuredModuleClass, homeModuleClass } from './ui/styles';

const introductions: Record<
  Role,
  {
    title: string;
    description: string;
    href: NavigationItem['href'];
    action: string;
  }
> = {
  ADMINISTRADOR: {
    title: 'Tu equipo, al día',
    description:
      'Gestiona las cuentas y los locales. Todo lo que necesitas para acompañar a tu equipo.',
    href: '/admin/usuarios',
    action: 'Ver usuarios',
  },
  CONTADOR: {
    title: 'Cada reparto, en orden',
    description:
      'Revisa las propinas, valida el reparto y registra su entrega a los trabajadores.',
    href: '/propinas/repartos',
    action: 'Revisar reparto',
  },
  SUPERVISOR: {
    title: 'Tu jornada, organizada',
    description:
      'Registra las propinas del día y mantén la información de tu local al día.',
    href: '/propinas/diarias',
    action: 'Registrar propinas',
  },
  TRABAJADOR: {
    title: 'Tu información, a mano',
    description:
      'Documentos, liquidaciones y constancias de propinas, en un solo lugar.',
    href: '/portal/documentos',
    action: 'Consultar documentos',
  },
};
const actionLabels: Partial<Record<NavigationItem['href'], string>> = {
  '/admin/usuarios': 'Gestionar usuarios',
  '/admin/locales': 'Gestionar locales',
  '/admin/auditoria': 'Consultar auditoría',
  '/admin/documentos': 'Gestionar documentos',
  '/admin/alertas-dt': 'Abrir alertas DT',
  '/admin/medios-pago': 'Gestionar medios de pago',
  '/liquidaciones': 'Abrir liquidaciones',
};

export function OperationsHome({
  role,
  email,
  forbidden,
}: {
  role: Role;
  email: string;
  forbidden: boolean;
}): ReactElement {
  const feature = introductions[role];
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {forbidden && (
        <p
          role="status"
          className="rounded-xl border border-line2 bg-tint2 p-4 text-sm text-ink2"
        >
          Tu cuenta no tiene acceso a la página solicitada. Te redirigimos al
          inicio, donde puedes continuar con las funciones de tu rol.
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">
            {role === 'TRABAJADOR'
              ? 'Tu espacio personal'
              : 'Bienvenido al sistema'}
          </h2>
          <p className="mt-1 truncate text-sm text-ink2" title={email}>
            {email}
          </p>
        </div>
      </div>
      <section aria-labelledby="home-feature-title">
        <Link
          href={feature.href}
          prefetch={false}
          aria-label={feature.action}
          className={featuredModuleClass}
        >
          <h2
            id="home-feature-title"
            className="text-xl font-bold tracking-tight"
          >
            {feature.title}
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-6">
            {feature.description}
          </p>
          <span className="mt-4 inline-flex items-center gap-3 text-sm font-semibold">
            {feature.action}
            <Icon name="arrow" />
          </span>
        </Link>
      </section>
      <section aria-labelledby="home-modules-title">
        <h2 id="home-modules-title" className="text-base font-bold">
          {role === 'TRABAJADOR' ? 'Mi información laboral' : 'Accesos rápidos'}
        </h2>

        <div className="mt-4 grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-4 lg:gap-4">
          {getNavigationItems(role)
            .slice(1)
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                aria-label={actionLabels[item.href] ?? item.label}
                className={homeModuleClass}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-line bg-bg text-salmon-ink transition-colors group-hover:border-line2 group-hover:bg-tint2">
                  <Icon name={getNavigationIcon(item.href)} />
                </span>
                <span>{item.label}</span>
              </Link>
            ))}
        </div>
      </section>
    </div>
  );
}
