import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_SALES_FILE_BYTES,
  fileDateDiffers,
  fileNameDate,
  parseConfirmBody,
  parseSalesImportDetail,
  parseSalesImportPreview,
  reportErrorMessage,
  salesFileError,
  salesImportDifferences,
  salesImportError,
  type SalesImportLine,
} from './sales-imports';

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
