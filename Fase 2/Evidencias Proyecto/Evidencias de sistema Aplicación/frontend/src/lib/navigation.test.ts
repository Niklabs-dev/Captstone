import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES } from './auth';
import {
  getHomePath,
  getPageRedirect,
  isHomePath,
  getNavigationItems,
} from './navigation';

test('La navegación permite recorrer inicio, usuarios y auditoría al administrador', () => {
  assert.deepEqual(getNavigationItems('ADMINISTRADOR'), [
    { href: '/dashboard', label: 'Inicio' },
    { href: '/admin/usuarios', label: 'Usuarios' },
    { href: '/admin/auditoria', label: 'Auditoría' },
  ]);
});

test('Cada rol recibe únicamente enlaces permitidos y el trabajador conserva su portal', () => {
  for (const role of ROLES) {
    for (const item of getNavigationItems(role))
      assert.equal(getPageRedirect(role, item.href), null);
    assert.equal(getNavigationItems(role)[0].href, getHomePath(role));
    if (role !== 'ADMINISTRADOR')
      assert.equal(getNavigationItems(role).length, 1);
  }
  assert.deepEqual(getNavigationItems(null), [
    { href: '/dashboard', label: 'Inicio' },
  ]);
});

test('El trabajador inicia en su portal y los otros roles en el dashboard', () => {
  for (const role of ROLES)
    assert.equal(
      getHomePath(role),
      role === 'TRABAJADOR' ? '/portal' : '/dashboard',
    );
});

test('El trabajador vuelve al portal desde los módulos privados y sus subrutas', () => {
  for (const path of [
    '/dashboard',
    '/dashboard/reportes',
    '/admin',
    '/admin/usuarios',
    '/documentos/privado',
    '/propinas',
    '/ventas',
    '/caja',
    '/inventario',
    '/usuarios',
    '/auditoria',
  ])
    assert.equal(
      getPageRedirect('TRABAJADOR', path),
      '/portal?reason=forbidden',
    );
  assert.equal(getPageRedirect('TRABAJADOR', '/portal'), null);
  assert.equal(getPageRedirect('TRABAJADOR', '/portal/liquidaciones'), null);
});

test('El portal es exclusivo del trabajador y no produce ciclos de redirección', () => {
  for (const role of ROLES) {
    const home = getHomePath(role);
    assert.equal(getPageRedirect(role, home), null);
    if (role !== 'TRABAJADOR') {
      assert.equal(
        getPageRedirect(role, '/portal'),
        '/dashboard?reason=forbidden',
      );
      assert.equal(
        getPageRedirect(role, '/portal/documentos'),
        '/dashboard?reason=forbidden',
      );
    }
  }
});

test('Solo el administrador entra a las páginas administrativas', () => {
  assert.equal(getPageRedirect('ADMINISTRADOR', '/admin/usuarios'), null);
  for (const role of ['SUPERVISOR', 'CONTADOR'] as const) {
    assert.equal(
      getPageRedirect(role, '/admin/usuarios'),
      '/dashboard?reason=forbidden',
    );
    assert.equal(getPageRedirect(role, '/dashboard'), null);
    assert.equal(getPageRedirect(role, '/administracion-publica'), null);
  }
});

test('El cliente rechaza destinos externos o no autorizados', () => {
  for (const destination of [
    'https://evil.example',
    '//evil.example',
    '/admin/usuarios',
    '/portal?next=evil',
    undefined,
    null,
    1,
    {},
  ])
    assert.equal(isHomePath(destination), false);
  assert.equal(isHomePath('/portal'), true);
  assert.equal(isHomePath('/dashboard'), true);
});
