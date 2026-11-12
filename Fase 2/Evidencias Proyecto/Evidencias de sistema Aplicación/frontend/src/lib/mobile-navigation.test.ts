import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES } from './auth';
import { getNavigationItems } from './navigation';
import {
  getMobileNavigation,
  getMobileLabel,
  getNavigationIcon,
} from './mobile-navigation';

test('La barra móvil conserva todos los destinos autorizados y deja sitio para Más', () => {
  for (const role of ROLES) {
    const { primary, additional } = getMobileNavigation(role);
    assert.ok(primary.length + (additional.length ? 1 : 0) <= 5);
    const all = [...primary, ...additional].map((item) => item.href);
    assert.equal(new Set(all).size, all.length);
    assert.deepEqual(
      all.sort(),
      getNavigationItems(role)
        .map((item) => item.href)
        .sort(),
    );
  }
});
test('El portal móvil no incluye rutas administrativas ni pierde constancias', () => {
  const { primary, additional } = getMobileNavigation('TRABAJADOR');
  assert.equal(additional.length, 0);
  assert.ok(primary.every((item) => item.href.startsWith('/portal')));
  assert.ok(primary.some((item) => item.href === '/portal/propinas'));
});
test('Más conserva auditoría, alertas, medios de pago, liquidaciones y reparto del administrador', () => {
  const { additional } = getMobileNavigation('ADMINISTRADOR');
  assert.deepEqual(
    additional.map((item) => item.href),
    [
      '/admin/auditoria',
      '/admin/alertas-dt',
      '/admin/medios-pago',
      '/admin/productos',
      '/admin/importacion-ventas',
      '/admin/panel-ventas',
      '/admin/reportes-ventas',
      '/admin/calendario-locales',
      '/liquidaciones',
      '/propinas',
    ],
  );
});

test('Mis propinas se ofrece en móvil solo a trabajador y supervisor', () => {
  for (const role of ROLES) {
    const { primary, additional } = getMobileNavigation(role);
    assert.equal(
      [...primary, ...additional].some(
        (item) => item.href === '/portal/propinas',
      ),
      role === 'TRABAJADOR' || role === 'SUPERVISOR',
    );
  }
});
test('Cada destino tiene icono compartido y etiqueta móvil legible', () => {
  for (const role of ROLES)
    for (const item of getNavigationItems(role)) {
      assert.ok(getNavigationIcon(item.href));
      assert.ok(getMobileLabel(item).length > 0);
    }
});
