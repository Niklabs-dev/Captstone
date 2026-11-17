import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseCountDetail,
  parseCountSummary,
} from './inventory-count-contract';
import {
  canDownloadCount,
  countExportFileName,
  countLineCells,
  countProgress,
  countQuery,
  countResponsible,
  EMPTY_COUNT_FILTERS,
  formatChileDateTime,
  hasCountFilters,
  inventoryCountError,
  isCalendarDate,
  parseCountFilters,
} from './inventory-counts';
import { getNavigationItems, getPageRedirect } from './navigation';

// Revisión y descarga de tomas de inventario (SPRINT-5-T09). El contrato
// compartido se prueba en inventory-count-contract.test.ts (SPRINT-5-T17).
const STORE = '0b6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f';
const COUNT = '1c6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f';
const PERSON = {
  id: '2d6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
  firstName: 'Ana',
  lastName: 'Pérez',
};
const FINALIZER = { ...PERSON, firstName: 'Bruno' };

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: COUNT,
    status: 'CONFIRMED',
    countDate: '2026-11-11',
    startedAt: '2026-11-11T23:05:00.000Z',
    storeId: STORE,
    store: { id: STORE, name: 'Subway Melipilla Centro' },
    startedBy: PERSON,
    finalizedAt: '2026-11-12T01:15:00.000Z',
    finalizedBy: FINALIZER,
    countedProducts: 2,
    ...overrides,
  };
}
function product(overrides: Record<string, unknown> = {}) {
  return {
    id: '3e6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
    sku: 'CAR-01',
    name: 'Carne Fajita',
    alternativeNames: [],
    unit: 'KG',
    packageName: 'bolsa',
    packagesPerBox: 2,
    packageContent: '2.500',
    boxContent: '5.000',
    looseOnly: false,
    hasFormat: true,
    isActive: true,
    templateRowId: '4f6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
    section: 'COSTO DE ALIMENTOS',
    templatePosition: 3,
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
    ...overrides,
  };
}
function line(overrides: Record<string, unknown> = {}) {
  return {
    id: '5a6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
    productId: '3e6f7d1e-3c2a-4b5d-8e9f-1a2b3c4d5e6f',
    boxes: 1,
    packages: 3,
    looseQuantity: '2.450',
    countedQuantity: '14.950',
    productSku: 'CAR-01',
    productName: 'Carne Fajita (al contar)',
    unit: 'KG',
    packageName: 'bolsa',
    boxContent: '5.000',
    packagesPerBox: 2,
    packageContent: '2.500',
    looseOnly: false,
    savedAt: '2026-11-11T23:30:00.000Z',
    savedBy: PERSON,
    ...overrides,
  };
}
function detail(items: unknown[]) {
  return {
    ...summary(),
    totalProducts: items.length,
    pendingProducts: 0,
    items,
  };
}

test('valida los filtros del listado y arma la consulta', () => {
  assert.deepEqual(parseCountFilters({}), {
    ok: true,
    filters: EMPTY_COUNT_FILTERS,
  });
  const ok = parseCountFilters({
    storeId: STORE,
    status: 'OPEN',
    from: '2026-11-01',
    to: '2026-11-30',
  });
  assert.equal(ok.ok, true);
  assert.equal(
    countQuery(ok.filters),
    `storeId=${STORE}&status=OPEN&from=2026-11-01&to=2026-11-30`,
  );
  assert.equal(countQuery(EMPTY_COUNT_FILTERS), '');
  assert.equal(
    countQuery({ ...EMPTY_COUNT_FILTERS, status: 'CONFIRMED' }),
    'status=CONFIRMED',
  );
  assert.equal(hasCountFilters(EMPTY_COUNT_FILTERS), false);
  assert.equal(hasCountFilters(ok.filters), true);
  // Un arreglo en la URL (?status=a&status=b) se ignora.
  assert.equal(parseCountFilters({ status: ['OPEN', 'CONFIRMED'] }).ok, true);
  const cases: [Record<string, string>, RegExp][] = [
    [{ storeId: 'abc' }, /local/],
    [{ status: 'DRAFT' }, /estado/],
    [{ from: '2026-13-01' }, /fechas/],
    [{ to: '11-11-2026' }, /fechas/],
    [{ from: '2026-11-30', to: '2026-11-01' }, /posterior/],
    // Igual que la API: los años 0000 a 0099 no son fechas válidas y no se
    // consultan (SPRINT-5-T17).
    [{ from: '0050-01-01' }, /fechas/],
    [{ from: '0000-01-01' }, /fechas/],
    [{ to: '0099-12-31' }, /fechas/],
  ];
  for (const [params, message] of cases) {
    const result = parseCountFilters(params);
    assert.equal(result.ok, false, JSON.stringify(params));
    if (!result.ok) assert.match(result.message, message);
  }
  assert.equal(parseCountFilters({ from: '0100-01-01' }).ok, true);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('0050-01-01'), false);
});

test('arma las celdas del detalle con la copia guardada de la línea', () => {
  const counted = parseCountDetail(
    detail([{ product: product(), counted: true, line: line() }]),
  )!.items[0];
  assert.deepEqual(countLineCells(counted), {
    name: 'Carne Fajita (al contar)',
    sku: 'CAR-01',
    boxes: '1 caja',
    packages: '3 bolsas',
    loose: '2,450 kg',
    total: '14,950 kg',
  });
  const onlyLoose = parseCountDetail(
    detail([
      {
        product: product(),
        counted: true,
        line: line({
          boxes: 2,
          packages: null,
          looseQuantity: null,
          countedQuantity: '10.000',
          productSku: null,
        }),
      },
    ]),
  )!.items[0];
  assert.deepEqual(countLineCells(onlyLoose), {
    name: 'Carne Fajita (al contar)',
    sku: null,
    boxes: '2 cajas',
    packages: '—',
    loose: '—',
    total: '10,000 kg',
  });
  const pending = parseCountDetail(
    detail([{ product: product(), counted: false, line: null }]),
  )!.items[0];
  assert.deepEqual(countLineCells(pending), {
    name: 'Carne Fajita',
    sku: 'CAR-01',
    boxes: '—',
    packages: '—',
    loose: '—',
    total: '—',
  });
});

test('avance, responsable, fecha-hora y descarga solo de finalizadas', () => {
  assert.equal(countProgress(12, 140), '12 de 140 productos contados');
  assert.equal(countProgress(1, 1), '1 de 1 producto contado');
  const finalized = parseCountSummary(summary())!;
  const open = parseCountSummary(
    summary({ status: 'OPEN', finalizedAt: null, finalizedBy: null }),
  )!;
  assert.equal(countResponsible(finalized), 'Bruno Pérez');
  assert.equal(countResponsible(open), 'Ana Pérez');
  // 01:15 UTC del 12 es 22:15 del 11 en Chile (horario de verano, UTC-3).
  assert.equal(
    formatChileDateTime('2026-11-12T01:15:00.000Z'),
    '11-11-2026 22:15',
  );
  assert.equal(canDownloadCount(finalized), true);
  assert.equal(canDownloadCount(open), false);
});

test('usa el nombre del Excel solo si es seguro', () => {
  assert.equal(
    countExportFileName(
      'attachment; filename="inventario-subway-melipilla-centro-11-11-2026.xlsx"',
      '2026-11-11',
    ),
    'inventario-subway-melipilla-centro-11-11-2026.xlsx',
  );
  assert.equal(
    countExportFileName('attachment; filename=inventario.xlsx', '2026-11-11'),
    'inventario.xlsx',
  );
  for (const unsafe of [
    null,
    'attachment',
    'attachment; filename="../../x.xlsx"',
    'attachment; filename="inventario.exe"',
    'attachment; filename=".xlsx"',
  ])
    assert.equal(
      countExportFileName(unsafe, '2026-11-11'),
      'inventario-2026-11-11.xlsx',
    );
});

test('mensajes de error por estado y operación', () => {
  assert.match(inventoryCountError(403), /Solo el administrador/);
  assert.match(inventoryCountError(404, 'detail'), /no existe/);
  assert.match(inventoryCountError(409, 'export'), /en curso/);
  assert.match(inventoryCountError(400), /filtros/);
  assert.match(inventoryCountError(500, 'export'), /descargar el Excel/);
  assert.match(inventoryCountError(503), /conectar/);
});

test('solo el administrador ve y entra a /admin/inventarios', () => {
  assert.ok(
    getNavigationItems('ADMINISTRADOR').some(
      (item) => item.href === '/admin/inventarios',
    ),
  );
  for (const role of ['SUPERVISOR', 'CONTADOR', 'TRABAJADOR'] as const) {
    assert.ok(
      !getNavigationItems(role).some(
        (item) => item.href === '/admin/inventarios',
      ),
    );
    for (const path of ['/admin/inventarios', `/admin/inventarios/${COUNT}`])
      assert.notEqual(getPageRedirect(role, path), null, `${role} ${path}`);
  }
  assert.equal(getPageRedirect('ADMINISTRADOR', '/admin/inventarios'), null);
  assert.equal(
    getPageRedirect('ADMINISTRADOR', `/admin/inventarios/${COUNT}`),
    null,
  );
});
