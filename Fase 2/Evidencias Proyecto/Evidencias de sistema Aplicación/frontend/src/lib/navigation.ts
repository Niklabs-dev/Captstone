import type { Role } from './auth';

export type HomePath = '/portal' | '/dashboard';

export function getHomePath(role: Role): HomePath {
  return role === 'TRABAJADOR' ? '/portal' : '/dashboard';
}

// Se aplica a las páginas privadas; las API conservan su autorización propia.
export function getPageRedirect(role: Role, pathname: string): string | null {
  const inPortal = pathname === '/portal' || pathname.startsWith('/portal/');
  if (role === 'TRABAJADOR')
    return inPortal ? null : '/portal?reason=forbidden';
  if (inPortal) return '/dashboard?reason=forbidden';
  const inAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (inAdmin && role !== 'ADMINISTRADOR') return '/dashboard?reason=forbidden';
  return null;
}

// Solo se aceptan los destinos internos que decide el servidor.
export function isHomePath(value: unknown): value is HomePath {
  return value === '/portal' || value === '/dashboard';
}
