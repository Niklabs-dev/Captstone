import type { Role } from './auth';
import { getNavigationItems, type NavigationItem } from './navigation';

export function getMobileNavigation(role: Role): {
  primary: readonly NavigationItem[];
  additional: readonly NavigationItem[];
} {
  const items = getNavigationItems(role);
  if (items.length <= 5) return { primary: items, additional: [] };
  const primary = items.filter((item) =>
    [
      '/dashboard',
      '/admin/usuarios',
      '/admin/locales',
      '/admin/documentos',
    ].includes(item.href),
  );
  return {
    primary,
    additional: items.filter((item) => !primary.includes(item)),
  };
}

export function getNavigationIcon(href: NavigationItem['href']) {
  const icons = {
    '/dashboard': 'home',
    '/portal': 'home',
    '/admin/usuarios': 'users',
    '/admin/locales': 'store',
    '/admin/auditoria': 'audit',
    '/admin/documentos': 'document',
    '/admin/alertas-dt': 'bell',
    '/liquidaciones': 'wallet',
    '/propinas/diarias': 'tips',
    '/propinas/repartos': 'tips',
    '/portal/propinas': 'tips',
    '/portal/documentos': 'document',
    '/portal/liquidaciones': 'wallet',
  } as const;
  return icons[href];
}

export function getMobileLabel(item: NavigationItem): string {
  if (item.href.includes('propinas')) return 'Propinas';
  if (item.href.includes('documentos')) return 'Documentos';
  if (item.href.includes('liquidaciones')) return 'Liquidaciones';
  return item.label;
}
