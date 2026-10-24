import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLES } from './auth';
import {
  getHomePath,
  getPageRedirect,
  isHomePath,
  getNavigationItems,
  getNavigationView,
} from './navigation';

test('El layout identifica la vista activa y el título sin confundir prefijos de rutas', () => {
  assert.deepEqual(getNavigationView('/dashboard'), {
    href: '/dashboard',
    title: 'Inicio',
  });
  assert.deepEqual(getNavigationView('/admin/usuarios/123'), {
    href: '/admin/usuarios',
    title: 'Usuarios y roles',
  });
  assert.deepEqual(getNavigationView('/admin/auditoria'), {
    href: '/admin/auditoria',
    title: 'Auditoría del sistema',
  });
  assert.deepEqual(getNavigationView('/portal/liquidaciones'), {
    href: '/portal/liquidaciones',
    title: 'Mis liquidaciones',
  });
  assert.deepEqual(getNavigationView('/admin/usuarios-publicos'), {
    href: null,
    title: 'Gestión interna',
  });
});

test('La navegación permite recorrer inicio, usuarios y auditoría al administrador', () => {
  assert.deepEqual(getNavigationItems('ADMINISTRADOR'), [
    { href: '/dashboard', label: 'Inicio' },
    { href: '/admin/usuarios', label: 'Usuarios' },
    { href: '/admin/locales', label: 'Locales' },
    { href: '/admin/auditoria', label: 'Auditoría' },
    { href: '/admin/documentos', label: 'Documentos' },
    { href: '/admin/alertas-dt', label: 'Alertas DT' },
    { href: '/liquidaciones', label: 'Liquidaciones' },
  ]);
});

test('Cada rol recibe únicamente enlaces permitidos y el trabajador conserva su portal', () => {
  for (const role of ROLES) {
    for (const item of getNavigationItems(role))
      assert.equal(getPageRedirect(role, item.href), null);
    assert.equal(getNavigationItems(role)[0].href, getHomePath(role));
    if (
      role !== 'ADMINISTRADOR' &&
      role !== 'TRABAJADOR' &&
      role !== 'SUPERVISOR' &&
      role !== 'CONTADOR'
    )
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

test('El módulo de SPRINT-2-T10 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/admin/documentos'), {
    href: '/admin/documentos',
    title: 'Gestor documental',
  });
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/admin/documentos',
      ),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/admin/documentos') === null, allowed);
  }
});

test('El módulo de SPRINT-2-T11 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/admin/alertas-dt'), {
    href: '/admin/alertas-dt',
    title: 'Alertas de registro en la DT',
  });
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/admin/alertas-dt',
      ),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/admin/alertas-dt') === null, allowed);
  }
});

test('El módulo de SPRINT-2-T16 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/liquidaciones'), {
    href: '/liquidaciones',
    title: 'Gestión de liquidaciones',
  });
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR' || role === 'CONTADOR';
    assert.equal(
      getNavigationItems(role).some((item) => item.href === '/liquidaciones'),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/liquidaciones') === null, allowed);
  }
});

test('El módulo de SPRINT-2-T17 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/portal/liquidaciones'), {
    href: '/portal/liquidaciones',
    title: 'Mis liquidaciones',
  });
  for (const role of ROLES) {
    const allowed = role === 'TRABAJADOR' || role === 'SUPERVISOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/portal/liquidaciones',
      ),
      allowed,
    );
    assert.equal(
      getPageRedirect(role, '/portal/liquidaciones') === null,
      allowed,
    );
  }
});
