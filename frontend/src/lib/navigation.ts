import type { Role } from './auth';

export type HomePath = '/portal' | '/dashboard';

export interface NavigationItem {
  href:
    | HomePath
    | '/admin/locales'
    | '/admin/usuarios'
    | '/admin/auditoria'
    | '/admin/documentos'
    | '/admin/alertas-dt'
    | '/liquidaciones'
    | '/propinas/diarias'
    | '/portal/liquidaciones'
    | '/portal/documentos'
    | '/portal/propinas';
  label: string;
}

export function getNavigationView(pathname: string): {
  href: NavigationItem['href'] | null;
  title: string;
} {
  const views = [
    { href: '/portal/propinas', title: 'Mis propinas' },
    { href: '/portal/documentos', title: 'Mis documentos' },
    { href: '/portal/liquidaciones', title: 'Mis liquidaciones' },
    { href: '/admin/documentos', title: 'Gestor documental' },
    { href: '/admin/alertas-dt', title: 'Alertas de registro en la DT' },
    { href: '/liquidaciones', title: 'Gestión de liquidaciones' },
    { href: '/propinas/diarias', title: 'Registro diario de propinas' },
    { href: '/dashboard', title: 'Inicio' },
    { href: '/admin/usuarios', title: 'Usuarios y roles' },
    { href: '/admin/locales', title: 'Locales' },
    { href: '/admin/auditoria', title: 'Auditoría del sistema' },
    { href: '/portal', title: 'Portal del Trabajador' },
  ] as const;
  return (
    views.find(
      (view) => pathname === view.href || pathname.startsWith(`${view.href}/`),
    ) ?? { href: null, title: 'Gestión interna' }
  );
}

// Una sola fuente de enlaces para todas las vistas; los permisos siguen en el servidor.
export function getNavigationItems(
  role: Role | null,
): readonly NavigationItem[] {
  if (role === 'TRABAJADOR')
    return [
      { href: '/portal', label: 'Inicio' },
      { href: '/portal/propinas', label: 'Mis propinas' },
      { href: '/portal/documentos', label: 'Mis documentos' },
      { href: '/portal/liquidaciones', label: 'Mis liquidaciones' },
    ];
  const home: NavigationItem = { href: '/dashboard', label: 'Inicio' };
  if (role === 'SUPERVISOR')
    return [
      home,
      { href: '/propinas/diarias', label: 'Propinas diarias' },
      { href: '/portal/documentos', label: 'Mis documentos' },
      { href: '/portal/liquidaciones', label: 'Mis liquidaciones' },
    ];
  return role === 'ADMINISTRADOR'
    ? [
        home,
        { href: '/admin/usuarios', label: 'Usuarios' },
        { href: '/admin/locales', label: 'Locales' },
        { href: '/admin/auditoria', label: 'Auditoría' },
        { href: '/admin/documentos', label: 'Documentos' },
        { href: '/admin/alertas-dt', label: 'Alertas DT' },
        { href: '/liquidaciones', label: 'Liquidaciones' },
      ]
    : role === 'CONTADOR'
      ? [home, { href: '/liquidaciones', label: 'Liquidaciones' }]
      : [home];
}

export function getHomePath(role: Role): HomePath {
  return role === 'TRABAJADOR' ? '/portal' : '/dashboard';
}

// Se aplica a las páginas privadas; las API conservan su autorización propia.
export function getPageRedirect(role: Role, pathname: string): string | null {
  const inPortal = pathname === '/portal' || pathname.startsWith('/portal/');
  if (
    role === 'SUPERVISOR' &&
    ['/portal/documentos', '/portal/liquidaciones'].some(
      (path) => pathname === path || pathname.startsWith(path + '/'),
    )
  )
    return null;
  if (role === 'TRABAJADOR')
    return inPortal ? null : '/portal?reason=forbidden';
  if (inPortal) return '/dashboard?reason=forbidden';
  if (
    (pathname === '/propinas/diarias' ||
      pathname.startsWith('/propinas/diarias/')) &&
    role !== 'SUPERVISOR'
  )
    return '/dashboard?reason=forbidden';
  if (
    (pathname === '/liquidaciones' || pathname.startsWith('/liquidaciones/')) &&
    role !== 'ADMINISTRADOR' &&
    role !== 'CONTADOR'
  )
    return '/dashboard?reason=forbidden';
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (inAdmin && role !== 'ADMINISTRADOR') return '/dashboard?reason=forbidden';
  return null;
}

// Solo se aceptan los destinos internos que decide el servidor.
export function isHomePath(value: unknown): value is HomePath {
  return value === '/portal' || value === '/dashboard';
}
