import type { Role } from './auth';
import { getNavigationItems, type NavigationItem } from './navigation';

export function getMobileNavigation(role: Role): {
  primary: readonly NavigationItem[];
  additional: readonly NavigationItem[];
} {
  const items = getNavigationItems(role);
  if (items.length <= 5) return { primary: items, additional: [] };
  // Cuatro plazas más «Más»: las tareas del administrador y, para el
  // supervisor (SPRINT-5-T07), la operación diaria, el inventario y sus
  // propinas; documentos y liquidaciones pasan a «Más».
  const primary = items.filter((item) =>
    [
      '/dashboard',
      '/admin/usuarios',
      '/admin/locales',
      '/admin/documentos',
      '/propinas/diarias',
      '/inventario',
      '/portal/propinas',
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
    '/admin/medios-pago': 'wallet',
    '/admin/productos': 'store',
    '/admin/inventarios': 'audit',
    '/admin/importacion-ventas': 'document',
    '/admin/panel-ventas': 'chart',
    '/admin/reportes-ventas': 'audit',
    '/admin/calendario-locales': 'calendar',
    '/liquidaciones': 'wallet',
    '/propinas': 'tips',
    '/propinas/diarias': 'tips',
    '/propinas/historico': 'tips',
    '/inventario': 'inventory',
    '/portal/propinas': 'tips',
    '/portal/documentos': 'document',
    '/portal/liquidaciones': 'wallet',
  } as const;
  return icons[href];
}

export function getMobileLabel(item: NavigationItem): string {
  // Distingue las constancias propias de los módulos de gestión de propinas.
  if (item.href === '/portal/propinas') return 'Mis propinas';
  if (item.href === '/propinas/diarias') return 'Operación';
  if (item.href === '/inventario') return 'Inventario';
  if (item.href.includes('propinas')) return 'Propinas';
  if (item.href.includes('documentos')) return 'Documentos';
  if (item.href.includes('liquidaciones')) return 'Liquidaciones';
  return item.label;
}
