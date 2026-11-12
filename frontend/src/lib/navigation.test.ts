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
    { href: '/admin/medios-pago', label: 'Medios de pago' },
    { href: '/admin/productos', label: 'Productos' },
    { href: '/admin/importacion-ventas', label: 'Importar ventas' },
    { href: '/admin/panel-ventas', label: 'Panel de ventas' },
    { href: '/admin/reportes-ventas', label: 'Reportes de ventas' },
    { href: '/admin/calendario-locales', label: 'Calendario de locales' },
    { href: '/liquidaciones', label: 'Liquidaciones' },
    { href: '/propinas', label: 'Propinas' },
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
        role === 'SUPERVISOR' ? null : '/dashboard?reason=forbidden',
      );
    }
  }
});

test('Mis propinas solo se enlaza y permite a trabajador y supervisor (SPRINT-4-T02)', () => {
  for (const role of ROLES) {
    const allowed = role === 'TRABAJADOR' || role === 'SUPERVISOR';
    for (const path of ['/portal/propinas', '/portal/propinas/constancia'])
      assert.equal(
        getPageRedirect(role, path),
        allowed ? null : '/dashboard?reason=forbidden',
      );
    assert.equal(
      getNavigationItems(role).some((item) => item.href === '/portal/propinas'),
      allowed,
    );
  }
  assert.equal(
    getPageRedirect('CONTADOR', '/portal/propinas-falsas'),
    '/dashboard?reason=forbidden',
  );
});

test('La vista de repartos se retiró: el supervisor vuelve a su inicio y el trabajador a su portal (SPRINT-4A-T08)', () => {
  for (const path of ['/propinas/repartos', '/propinas/repartos/historico'])
    assert.equal(getPageRedirect('SUPERVISOR', path), '/dashboard');
  for (const role of ROLES)
    assert.equal(
      getNavigationItems(role).some((item) =>
        item.href.startsWith('/propinas/repartos'),
      ),
      false,
    );
  assert.equal(
    getPageRedirect('TRABAJADOR', '/propinas/repartos'),
    '/portal?reason=forbidden',
  );
  // Ya no tiene vista propia: solo la cubre el prefijo de /propinas.
  assert.deepEqual(getNavigationView('/propinas/repartos'), {
    href: '/propinas',
    title: 'Propinas',
  });
});

test('Solo administrador y contador entran al histórico de repartos, sin ítem de menú (SPRINT-4A-T08)', () => {
  for (const role of ROLES) {
    const manager = role === 'ADMINISTRADOR' || role === 'CONTADOR';
    for (const path of [
      '/propinas/historico',
      '/propinas/historico/a9000000-0000-4000-8000-000000000001',
    ])
      assert.equal(
        getPageRedirect(role, path),
        manager
          ? null
          : role === 'TRABAJADOR'
            ? '/portal?reason=forbidden'
            : '/dashboard?reason=forbidden',
      );
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/propinas/historico',
      ),
      false,
    );
  }
  assert.deepEqual(
    getNavigationView(
      '/propinas/historico/a9000000-0000-4000-8000-000000000001',
    ),
    { href: '/propinas/historico', title: 'Repartos anteriores' },
  );
});

test('Administrador y contador usan /propinas en lugar de los repartos (SPRINT-4A-T07)', () => {
  for (const role of ROLES) {
    const manager = role === 'ADMINISTRADOR' || role === 'CONTADOR';
    const hrefs = getNavigationItems(role).map((item) => item.href);
    assert.equal(hrefs.includes('/propinas'), manager);
    assert.equal(
      getPageRedirect(role, '/propinas'),
      manager
        ? null
        : role === 'TRABAJADOR'
          ? '/portal?reason=forbidden'
          : '/dashboard?reason=forbidden',
    );
    if (manager) {
      assert.equal(getPageRedirect(role, '/propinas/repartos'), '/propinas');
      assert.equal(
        getPageRedirect(role, '/propinas/repartos/historico'),
        '/propinas',
      );
    }
  }
  assert.deepEqual(getNavigationView('/propinas'), {
    href: '/propinas',
    title: 'Propinas',
  });
  // Las subrutas conservan su propia vista activa y sus permisos.
  assert.equal(
    getNavigationView('/propinas/diarias').href,
    '/propinas/diarias',
  );
  assert.equal(
    getPageRedirect('CONTADOR', '/propinas/diarias'),
    '/dashboard?reason=forbidden',
  );
  assert.equal(getPageRedirect('SUPERVISOR', '/propinas/diarias'), null);
});

test('La importación de ventas es exclusiva del administrador (SPRINT-4R-T11)', () => {
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/admin/importacion-ventas',
      ),
      allowed,
    );
    assert.equal(
      getPageRedirect(role, '/admin/importacion-ventas') === null,
      allowed,
    );
  }
});

test('Panel y calendario de ventas son exclusivos del administrador (SPRINT-4R-T14)', () => {
  const pages = [
    ['/admin/panel-ventas', 'Panel de ventas'],
    ['/admin/calendario-locales', 'Calendario de locales'],
  ] as const;
  for (const [href, title] of pages) {
    assert.deepEqual(getNavigationView(href), { href, title });
    for (const role of ROLES) {
      const allowed = role === 'ADMINISTRADOR';
      assert.equal(
        getNavigationItems(role).some((item) => item.href === href),
        allowed,
      );
      assert.equal(getPageRedirect(role, href) === null, allowed);
    }
  }
  // El detalle de una operación diaria hereda el panel y su protección.
  const detail =
    '/admin/panel-ventas/operaciones/3f2e1d0c-9b8a-4765-8432-10fedcba9876';
  assert.equal(getNavigationView(detail).title, 'Panel de ventas');
  assert.equal(getPageRedirect('ADMINISTRADOR', detail), null);
  for (const role of ['SUPERVISOR', 'CONTADOR'] as const)
    assert.equal(getPageRedirect(role, detail), '/dashboard?reason=forbidden');
  assert.equal(
    getPageRedirect('TRABAJADOR', detail),
    '/portal?reason=forbidden',
  );
});

test('Administrador y contador leen los reportes de ventas y el detalle de la operación (SPRINT-4A-T23)', () => {
  const detail =
    '/admin/reportes-ventas/operaciones/3f2e1d0c-9b8a-4765-8432-10fedcba9876';
  assert.deepEqual(getNavigationView('/admin/reportes-ventas'), {
    href: '/admin/reportes-ventas',
    title: 'Reportes de ventas',
  });
  assert.deepEqual(getNavigationView(detail), {
    href: '/admin/reportes-ventas',
    title: 'Reportes de ventas',
  });
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR' || role === 'CONTADOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/admin/reportes-ventas',
      ),
      allowed,
    );
    const denied =
      role === 'TRABAJADOR'
        ? '/portal?reason=forbidden'
        : '/dashboard?reason=forbidden';
    for (const path of ['/admin/reportes-ventas', detail])
      assert.equal(getPageRedirect(role, path), allowed ? null : denied);
  }
  // El contador no gana otras páginas administrativas ni de escritura.
  for (const path of [
    '/admin',
    '/admin/importacion-ventas',
    '/admin/panel-ventas',
    '/admin/calendario-locales',
    '/admin/medios-pago',
    '/admin/reportes-ventas-falsos',
    '/propinas/diarias',
  ])
    assert.equal(
      getPageRedirect('CONTADOR', path),
      '/dashboard?reason=forbidden',
    );
  assert.deepEqual(getNavigationItems('CONTADOR'), [
    { href: '/dashboard', label: 'Inicio' },
    { href: '/liquidaciones', label: 'Liquidaciones' },
    { href: '/propinas', label: 'Propinas' },
    { href: '/admin/reportes-ventas', label: 'Reportes de ventas' },
  ]);
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
test('El módulo de SPRINT-4-T32 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/admin/medios-pago'), {
    href: '/admin/medios-pago',
    title: 'Medios de pago',
  });
  for (const role of ROLES) {
    const allowed = role === 'ADMINISTRADOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/admin/medios-pago',
      ),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/admin/medios-pago') === null, allowed);
  }
});
test('El módulo de SPRINT-4R-T01 usa la navegación común y respeta los roles', () => {
  assert.deepEqual(getNavigationView('/propinas/diarias'), {
    href: '/propinas/diarias',
    title: 'Operación diaria',
  });
  assert.deepEqual(getNavigationView('/propinas/diarias/ajuste'), {
    href: '/propinas/diarias',
    title: 'Operación diaria',
  });
  for (const role of ROLES) {
    const allowed = role === 'SUPERVISOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) =>
          item.href === '/propinas/diarias' &&
          item.label === 'Operación diaria',
      ),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/propinas/diarias') === null, allowed);
  }
});
test('Mis documentos y Mis liquidaciones permanecen separados para trabajadores y supervisores', () => {
  assert.deepEqual(getNavigationView('/portal/documentos'), {
    href: '/portal/documentos',
    title: 'Mis documentos',
  });
  for (const role of ROLES) {
    const allowed = role === 'TRABAJADOR' || role === 'SUPERVISOR';
    assert.equal(
      getNavigationItems(role).some(
        (item) => item.href === '/portal/documentos',
      ),
      allowed,
    );
    assert.equal(getPageRedirect(role, '/portal/documentos') === null, allowed);
    if (allowed)
      assert.equal(
        getNavigationItems(role).some(
          (item) => item.href === '/portal/liquidaciones',
        ),
        true,
      );
  }
});
