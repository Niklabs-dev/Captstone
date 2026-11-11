import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CREATE_METHOD,
  MAX_SALES_FILE_BYTES,
  NEW_METHOD_NAME_TAKEN,
  buildResolution,
  effectiveActiveImport,
  initialChoices,
  isResolvable,
  newMethodCode,
  newMethodNameError,
  parseResolutionBody,
  pendingLines,
  previewTableLines,
  resolvedConfirmError,
  resolvedConfirmFailure,
  resolvedPreviewLines,
  storeRememberBlock,
  fileDateDiffers,
  fileNameDate,
  latestSalesImports,
  parseConfirmBody,
  parseSalesImportDetail,
  parseSalesImportPreview,
  reportErrorMessage,
  salesFileError,
  salesImportDifferences,
  salesImportError,
  type SalesImportLine,
} from './sales-imports';
import { downloadSalesImportFile } from './sales-imports-client';

const id = 'a9000000-0000-4000-8000-000000000001';
const other = 'a9000000-0000-4000-8000-000000000002';
const person = { id, name: 'Admin Prueba', email: 'privado@moi-food.cl' };
const method = { id, code: 'CASH', name: 'Efectivo' };
const line = {
  lineNumber: 1,
  originalLabel: 'EFECTIVO',
  amount: 1000,
  percentage: 100,
  paymentMethod: method,
};
const version = {
  id,
  version: 1,
  status: 'PENDING',
  createdAt: '2026-03-15T12:00:00Z',
  confirmedAt: null,
  supersededAt: null,
};
const detail = {
  id,
  status: 'PENDING',
  version: 1,
  store: person,
  businessDate: '2026-03-14',
  issuedAt: '2026-03-15T12:30:00Z',
  totalAmount: 1000,
  fileName: 'ventas-15-03-2026.xlsx',
  sizeBytes: 2048,
  uploadedBy: person,
  createdAt: '2026-03-15T13:00:00Z',
  confirmedBy: null,
  confirmedAt: null,
  lines: [line],
  versions: [version],
};
const preview = {
  outcome: 'CREATED',
  canConfirm: true,
  issues: [],
  businessDate: '2026-03-14',
  periodStart: '2026-03-14T03:00:00Z',
  periodEnd: '2026-03-15T02:59:59Z',
  issuedAt: '2026-03-15T12:30:00Z',
  externalStoreCode: '901 - 12345',
  store: person,
  totalAmount: 1000,
  lines: [line],
  import: detail,
  activeImport: null,
};

test('La vista previa se proyecta sin campos ajenos al contrato', () => {
  const parsed = parseSalesImportPreview(preview);
  assert.ok(parsed);
  assert.deepEqual(parsed.store, { id, name: 'Admin Prueba' });
  assert.equal(JSON.stringify(parsed).includes('privado@'), false);
});

test('Acepta una carga sin resolver, sin importación guardada', () => {
  const parsed = parseSalesImportPreview({
    ...preview,
    outcome: 'UNRESOLVED',
    canConfirm: false,
    store: null,
    import: null,
    lines: [{ ...line, paymentMethod: null }],
    issues: [{ code: 'STORE_NOT_CONFIGURED', message: 'Configura el local.' }],
  });
  assert.ok(parsed);
  assert.equal(parsed.import, null);
  assert.equal(parsed.lines[0].paymentMethod, null);
});

test('Rechaza respuestas que no cumplen el contrato', () => {
  for (const bad of [
    { ...preview, outcome: 'OTRO' },
    { ...preview, businessDate: '2026-02-30' },
    { ...preview, totalAmount: 1.5 },
    { ...preview, lines: [{ ...line, amount: 'mil' }] },
    { ...preview, import: { ...detail, status: 'OTRO' } },
    { ...preview, issues: [{ code: 'X' }] },
  ])
    assert.equal(parseSalesImportPreview(bad), null);
  assert.equal(parseSalesImportDetail({ ...detail, versions: null }), null);
});

test('La confirmación solo admite el ID de la vigente o null', () => {
  assert.deepEqual(parseConfirmBody({ expectedActiveImportId: null }), {
    expectedActiveImportId: null,
  });
  assert.deepEqual(parseConfirmBody({ expectedActiveImportId: other }), {
    expectedActiveImportId: other,
  });
  for (const bad of [
    {},
    { expectedActiveImportId: 'x' },
    { expectedActiveImportId: null, storeId: id },
  ])
    assert.equal(parseConfirmBody(bad), null);
});

test('El archivo debe ser .xlsx, no vacío y de hasta 5 MB', () => {
  assert.equal(salesFileError({ name: 'ventas.XLSX', size: 10 }), null);
  assert.match(
    salesFileError({ name: 'ventas.xls', size: 10 }) ?? '',
    /\.xlsx/,
  );
  assert.match(salesFileError({ name: 'a.xlsx', size: 0 }) ?? '', /vacío/);
  assert.match(
    salesFileError({ name: 'a.xlsx', size: MAX_SALES_FILE_BYTES + 1 }) ?? '',
    /5 MB/,
  );
});

test('Detecta la fecha del nombre y su diferencia con el contenido', () => {
  assert.equal(fileNameDate('ventas-15-03-2026.xlsx'), '2026-03-15');
  assert.equal(fileNameDate('ventas_2026_03_15.xlsx'), '2026-03-15');
  assert.equal(fileNameDate('ventas.xlsx'), null);
  assert.equal(fileNameDate('ventas-31-02-2026.xlsx'), null);
  assert.equal(fileDateDiffers('ventas-15-03-2026.xlsx', '2026-03-14'), true);
  assert.equal(fileDateDiffers('ventas-14-03-2026.xlsx', '2026-03-14'), false);
  assert.equal(fileDateDiffers('ventas.xlsx', '2026-03-14'), false);
});

test('Las diferencias incluyen medios que cambian, aparecen o salen', () => {
  const entry = (
    code: string,
    amount: number,
    lineNumber: number,
  ): SalesImportLine => ({
    lineNumber,
    originalLabel: code,
    amount,
    percentage: null,
    paymentMethod: { id, code, name: code + ' nombre' },
    resolution: 'AUTOMATIC',
  });
  assert.deepEqual(
    salesImportDifferences(
      [entry('CASH', 100, 1), entry('DEBIT', 50, 2), entry('SAME', 7, 3)],
      [entry('CASH', 130, 1), entry('CREDIT', 20, 2), entry('SAME', 7, 3)],
    ).map((row) => [row.key, row.previous, row.next, row.delta]),
    [
      ['CASH', 100, 130, 30],
      ['DEBIT', 50, 0, -50],
      ['CREDIT', 0, 20, 20],
    ],
  );
});

test('Solo reenvía mensajes con códigos conocidos del parser', () => {
  assert.equal(
    reportErrorMessage({ code: 'TOTAL_MISMATCH', message: 'No cuadra.' }),
    'No cuadra.',
  );
  assert.equal(
    reportErrorMessage({ code: 'PAYMENTS_TOTAL_INVALID', message: 'Revisa.' }),
    'Revisa.',
  );
  for (const bad of [
    { code: 'P2002', message: 'prisma' },
    { code: 'FILE_INTERNAL_PATH', message: '/ruta/privada' },
    { message: 'sin código' },
    { code: 'TOTAL_MISMATCH', message: 'x'.repeat(401) },
    null,
  ])
    assert.equal(reportErrorMessage(bad), null);
});

test('Los estados desconocidos usan un mensaje seguro', () => {
  assert.match(salesImportError(409), /Vuelve a subir/);
  assert.equal(salesImportError(500), salesImportError(502));
});

test('El historial prioriza la carga más reciente, no la fecha de negocio', () => {
  const load = (name: string, createdAt: string) => ({ name, createdAt });
  assert.deepEqual(
    latestSalesImports(
      [
        load('negocio-nuevo', '2026-03-10T10:00:00Z'),
        load('correccion-antigua', '2026-03-12T10:00:00Z'),
        load('intermedia', '2026-03-11T10:00:00Z'),
      ],
      2,
    ).map((item) => item.name),
    ['correccion-antigua', 'intermedia'],
  );
});

test('La descarga informa un archivo alterado', async () => {
  const original = globalThis.fetch;
  try {
    for (const [integrity, altered] of [
      ['VALID', false],
      ['ALTERED', true],
    ] as const) {
      globalThis.fetch = () =>
        Promise.resolve(
          new Response('xlsx', { headers: { 'X-File-Integrity': integrity } }),
        );
      assert.equal((await downloadSalesImportFile(id)).altered, altered);
    }
    globalThis.fetch = () =>
      Promise.resolve(new Response('{}', { status: 404 }));
    await assert.rejects(downloadSalesImportFile(id));
  } finally {
    globalThis.fetch = original;
  }
});

// SPRINT-4A-T19: vista previa UNRESOLVED con resolución manual. Caso real del
// 05/11: Santa María sin ID Subway asignado y «N.de Créd.» en 0 sin alias
// (desde SPRINT-4A-T21 se omite sola).
const noteLine = {
  lineNumber: 2,
  originalLabel: 'N.de Créd.',
  amount: 0,
  percentage: 0,
  paymentMethod: null,
  skipped: true,
};
const santaMaria = 'a9000000-0000-4000-8000-000000000010';
const transfer = 'a9000000-0000-4000-8000-000000000011';
const unresolved = {
  ...preview,
  outcome: 'UNRESOLVED',
  canConfirm: false,
  store: null,
  import: null,
  subwayStoreId: '72597',
  externalStoreCode: '208 - 72597',
  totalAmount: 873_260,
  lines: [{ ...line, amount: 873_260 }, noteLine],
  // SPRINT-4A-T21: la línea en 0 sin alias no es un problema.
  issues: [{ code: 'STORE_NOT_CONFIGURED', message: 'Elige el local.' }],
  resolutionOptions: {
    stores: [
      {
        id: santaMaria,
        name: 'Santa María',
        subwayStoreId: null,
        activeImport: null,
      },
      {
        id: other,
        name: 'Calera',
        subwayStoreId: '69132',
        activeImport: version,
      },
    ],
    paymentMethods: [
      method,
      { id: transfer, code: 'TRANSFER', name: 'Transferencia' },
    ],
  },
};

test('Proyecta las opciones de la resolución manual', () => {
  const parsed = parseSalesImportPreview(unresolved);
  assert.ok(parsed);
  assert.equal(isResolvable(parsed), true);
  assert.equal(parsed.subwayStoreId, '72597');
  assert.equal(parsed.issues.length, 1);
  assert.equal(parsed.lines[1].skipped, true);
  assert.deepEqual(
    parsed.resolutionOptions?.stores.map((store) => store.name),
    ['Santa María', 'Calera'],
  );
  assert.equal(parsed.resolutionOptions?.stores[1].activeImport?.id, id);
  for (const bad of [
    { ...unresolved, subwayStoreId: 'abc' },
    { ...unresolved, resolutionOptions: { stores: [{ id: 'x' }] } },
    {
      ...unresolved,
      resolutionOptions: { stores: [], paymentMethods: [{ id }] },
    },
  ])
    assert.equal(parseSalesImportPreview(bad), null);
  const created = parseSalesImportPreview(preview);
  assert.ok(created);
  assert.equal(isResolvable(created), false);
});

test('Confirmar se habilita solo con todo resuelto (05/11: Santa María y N.de Créd. omitida sola)', () => {
  const parsed = parseSalesImportPreview(unresolved);
  assert.ok(parsed);
  // SPRINT-4A-T21: la línea en 0 sin alias no es pendiente.
  assert.deepEqual(pendingLines(parsed), []);
  const empty = initialChoices(parsed);
  assert.deepEqual(empty, { storeId: '', rememberStore: true, lines: {} });
  assert.equal(buildResolution(parsed, empty), null);
  const ready = { ...empty, storeId: santaMaria };
  assert.deepEqual(buildResolution(parsed, ready), {
    expectedActiveImportId: null,
    store: { storeId: santaMaria, remember: true },
    lines: [],
  });
  // El total sigue cuadrando: la omitida está en 0 y queda aparte.
  const shown = resolvedPreviewLines(parsed, ready);
  assert.equal(
    shown.lines.reduce((sum, item) => sum + item.amount, 0),
    parsed.totalAmount,
  );
  assert.deepEqual(
    shown.skipped.map((item) => item.originalLabel),
    ['N.de Créd.'],
  );
});

test('Una vista previa confirmable lista aparte la línea omitida sola', () => {
  const parsed = parseSalesImportPreview({
    ...preview,
    lines: [line, { ...noteLine, lineNumber: 2 }],
  });
  assert.ok(parsed);
  const table = previewTableLines(parsed);
  assert.deepEqual(
    table.lines.map((item) => item.originalLabel),
    ['EFECTIVO'],
  );
  assert.deepEqual(
    table.skipped.map((item) => item.originalLabel),
    ['N.de Créd.'],
  );
  // Contratos anteriores sin skipped: nada se omite solo.
  const legacy = parseSalesImportPreview(preview);
  assert.equal(legacy?.lines[0].skipped, false);
  for (const bad of [
    { ...noteLine, skipped: 'sí' },
    { ...noteLine, amount: 500 },
    { ...noteLine, paymentMethod: method },
  ])
    assert.equal(
      parseSalesImportPreview({ ...preview, lines: [line, bad] }),
      null,
    );
});

// Línea con valor sin alias: se elige un medio activo o se crea uno nuevo.
const coupon = {
  lineNumber: 3,
  originalLabel: 'CUPÓN  RAPPI ',
  amount: 50_000,
  percentage: null,
  paymentMethod: null,
  skipped: false,
};
const withCoupon = {
  ...unresolved,
  totalAmount: 923_260,
  lines: [...unresolved.lines, coupon],
  issues: [
    ...unresolved.issues,
    {
      code: 'PAYMENT_METHOD_NOT_CONFIGURED',
      message: 'Elige o crea el medio.',
      lineNumber: 3,
    },
  ],
};

test('Una línea con valor se asigna a un medio activo o crea uno nuevo (SPRINT-4A-T21)', () => {
  const parsed = parseSalesImportPreview(withCoupon);
  assert.ok(parsed);
  const empty = initialChoices(parsed);
  // El nombre sugerido es la etiqueta con los espacios normalizados.
  assert.deepEqual(empty.lines, {
    3: { choice: '', remember: true, name: 'CUPÓN RAPPI' },
  });
  const base = { ...empty, storeId: santaMaria };
  assert.equal(buildResolution(parsed, base), null);

  const assigned = {
    ...base,
    lines: { 3: { choice: transfer, remember: false, name: 'CUPÓN RAPPI' } },
  };
  assert.deepEqual(buildResolution(parsed, assigned)?.lines, [
    {
      lineNumber: 3,
      action: 'ASSIGN',
      paymentMethodId: transfer,
      name: null,
      remember: false,
    },
  ]);
  const shownAssigned = resolvedPreviewLines(parsed, assigned);
  assert.equal(shownAssigned.lines[1].paymentMethod?.name, 'Transferencia');
  assert.equal(shownAssigned.lines[1].resolution, 'MANUAL');

  const creating = {
    ...base,
    lines: {
      3: { choice: CREATE_METHOD, remember: false, name: '  Cupón   Rappi ' },
    },
  };
  // Crear siempre recuerda la etiqueta, aunque el checkbox venga desmarcado.
  assert.deepEqual(buildResolution(parsed, creating)?.lines, [
    {
      lineNumber: 3,
      action: 'CREATE',
      paymentMethodId: null,
      name: 'Cupón Rappi',
      remember: true,
    },
  ]);
  const shown = resolvedPreviewLines(parsed, creating);
  assert.deepEqual(shown.created, [3]);
  assert.deepEqual(shown.lines[1].paymentMethod, {
    id: '',
    code: 'CUPON_RAPPI',
    name: 'Cupón Rappi',
  });
  assert.equal(
    shown.lines.reduce((sum, item) => sum + item.amount, 0),
    parsed.totalAmount,
  );
});

test('El nombre del medio nuevo no repite uno existente ni queda inválido', () => {
  const parsed = parseSalesImportPreview(withCoupon);
  assert.ok(parsed);
  const choose = (name: string) => ({
    storeId: santaMaria,
    rememberStore: true,
    lines: { 3: { choice: CREATE_METHOD, remember: true, name } },
  });
  for (const [name, message] of [
    ['', /Ingresa el nombre/],
    ['12', /al menos una letra/],
    ['ÆØ', /al menos dos letras o números/],
    [' transferencia ', /Ya existe el medio «Transferencia»/],
    ['cash', /Ya existe el medio «Efectivo»/],
  ] as const) {
    assert.match(newMethodNameError(parsed, choose(name), 3) ?? '', message);
    assert.equal(buildResolution(parsed, choose(name)), null);
  }
  assert.equal(newMethodNameError(parsed, choose('Cupón Rappi'), 3), null);
  assert.equal(newMethodCode('N.de Créd.'), 'N_DE_CRED');
  // Dos nombres distintos con el mismo código se rechazan; el mismo nombre
  // crea un solo medio para ambas líneas.
  const two = parseSalesImportPreview({
    ...withCoupon,
    lines: [
      ...withCoupon.lines,
      { ...coupon, lineNumber: 4, originalLabel: 'X' },
    ],
  });
  assert.ok(two);
  const twice = (second: string) => ({
    storeId: santaMaria,
    rememberStore: true,
    lines: {
      3: { choice: CREATE_METHOD, remember: true, name: 'Cupones' },
      4: { choice: CREATE_METHOD, remember: true, name: second },
    },
  });
  assert.match(
    newMethodNameError(two, twice('cupones'), 4) ?? '',
    /mismo nombre/,
  );
  assert.equal(newMethodNameError(two, twice('Cupones'), 4), null);
  assert.equal(buildResolution(two, twice('Cupones'))?.lines.length, 2);
});

test('No ofrece omitir líneas ni recordar lo que no se puede', () => {
  const parsed = parseSalesImportPreview({
    ...unresolved,
    lines: [
      { ...line, amount: 800_000 },
      {
        lineNumber: 2,
        originalLabel: 'N.de Créd.',
        amount: 73_260,
        percentage: null,
        paymentMethod: null,
        skipped: false,
      },
    ],
  });
  assert.ok(parsed);
  // Sin elegir medio para la línea con valor no hay resolución.
  assert.equal(
    buildResolution(parsed, {
      storeId: santaMaria,
      rememberStore: true,
      lines: { 2: { choice: 'SKIP', remember: false, name: '' } },
    }),
    null,
  );
  const calera = parsed.resolutionOptions?.stores[1] ?? null;
  assert.match(storeRememberBlock(parsed, calera) ?? '', /no se sobrescribe/);
  assert.equal(
    storeRememberBlock(parsed, parsed.resolutionOptions?.stores[0] ?? null),
    null,
  );
  // Un local con ID propio se elige sin recordar y reemplaza su vigente.
  const choices = {
    storeId: other,
    rememberStore: true,
    lines: { 2: { choice: transfer, remember: true, name: '' } },
  };
  assert.equal(effectiveActiveImport(parsed, choices)?.id, id);
  assert.deepEqual(buildResolution(parsed, choices), {
    expectedActiveImportId: id,
    store: { storeId: other, remember: false },
    lines: [
      {
        lineNumber: 2,
        action: 'ASSIGN',
        paymentMethodId: transfer,
        name: null,
        remember: true,
      },
    ],
  });
  const noId = parseSalesImportPreview({ ...unresolved, subwayStoreId: null });
  assert.ok(noId);
  assert.match(storeRememberBlock(noId, null) ?? '', /no trae un ID Subway/);
});

test('El BFF solo reenvía una resolución con el contrato exacto', () => {
  const valid = {
    expectedActiveImportId: null,
    store: { storeId: santaMaria, remember: true },
    lines: [
      {
        lineNumber: 2,
        action: 'ASSIGN',
        paymentMethodId: transfer,
        remember: false,
      },
      {
        lineNumber: 3,
        action: 'CREATE',
        name: ' Cupón  Rappi ',
        remember: true,
      },
    ],
  };
  assert.deepEqual(parseResolutionBody(valid), {
    ...valid,
    lines: [
      {
        lineNumber: 2,
        action: 'ASSIGN',
        paymentMethodId: transfer,
        name: null,
        remember: false,
      },
      {
        lineNumber: 3,
        action: 'CREATE',
        paymentMethodId: null,
        name: 'Cupón Rappi',
        remember: true,
      },
    ],
  });
  for (const bad of [
    { ...valid, extra: true },
    { ...valid, expectedActiveImportId: 'x' },
    { ...valid, store: { storeId: santaMaria } },
    // SPRINT-4A-T21: ya no se omiten líneas a mano.
    { ...valid, lines: [{ lineNumber: 2, action: 'SKIP', remember: false }] },
    { ...valid, lines: [{ lineNumber: 2, action: 'ASSIGN', remember: false }] },
    {
      ...valid,
      lines: [
        {
          lineNumber: 2,
          action: 'ASSIGN',
          paymentMethodId: transfer,
          name: 'X',
          remember: false,
        },
      ],
    },
    {
      ...valid,
      lines: [
        { lineNumber: 3, action: 'CREATE', name: 'Cupón', remember: false },
      ],
    },
    {
      ...valid,
      lines: [
        {
          lineNumber: 3,
          action: 'CREATE',
          name: 'Cupón',
          paymentMethodId: transfer,
          remember: true,
        },
      ],
    },
    {
      ...valid,
      lines: [{ lineNumber: 3, action: 'CREATE', name: '123', remember: true }],
    },
    {
      ...valid,
      lines: [
        {
          lineNumber: 0,
          action: 'ASSIGN',
          paymentMethodId: transfer,
          remember: false,
        },
      ],
    },
    { ...valid, lines: 'x' },
  ])
    assert.equal(parseResolutionBody(bad), null);
  assert.match(resolvedConfirmError(400), /datos elegidos/);
  assert.match(resolvedConfirmError(409), /Vuelve a subir/);
  // El nombre repetido de un medio nuevo tiene su propio texto, nunca el del
  // servidor.
  assert.equal(
    resolvedConfirmFailure(409, {
      code: 'PAYMENT_METHOD_NAME_TAKEN',
      message: 'texto interno',
    }),
    NEW_METHOD_NAME_TAKEN,
  );
  assert.match(
    resolvedConfirmFailure(409, { message: 'texto interno' }),
    /Vuelve a subir/,
  );
});

test('El detalle conserva lo resuelto a mano y acepta contratos anteriores', () => {
  const manual = parseSalesImportDetail({
    ...detail,
    storeResolution: 'MANUAL',
    resolvedBy: person,
    lines: [{ ...line, resolution: 'MANUAL' }],
    skippedLines: [
      { lineNumber: 2, originalLabel: 'N.de Créd.', amount: 0, percentage: 0 },
      {
        lineNumber: 3,
        originalLabel: 'NOTA',
        amount: 0,
        percentage: 0,
        resolution: 'AUTOMATIC',
      },
    ],
  });
  assert.ok(manual);
  assert.equal(manual.storeResolution, 'MANUAL');
  assert.deepEqual(manual.resolvedBy, { id, name: 'Admin Prueba' });
  assert.equal(manual.lines[0].resolution, 'MANUAL');
  // Sin resolution (SPRINT-4A-T18) la omisión fue a mano.
  assert.deepEqual(
    manual.skippedLines.map((item) => item.resolution),
    ['MANUAL', 'AUTOMATIC'],
  );
  const legacy = parseSalesImportDetail(detail);
  assert.ok(legacy);
  assert.equal(legacy.storeResolution, 'AUTOMATIC');
  assert.deepEqual(legacy.skippedLines, []);
  assert.equal(
    parseSalesImportDetail({ ...detail, storeResolution: 'OTRO' }),
    null,
  );
  assert.equal(
    parseSalesImportDetail({
      ...detail,
      skippedLines: [
        { lineNumber: 2, originalLabel: 'N', amount: 0, resolution: 'OTRA' },
      ],
    }),
    null,
  );
});
