import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COUNT_STATUS_LABELS,
  OUTSIDE_TEMPLATE_SECTION,
  formatCountNumber,
  formatCountQuantity,
  groupCountItems,
  isCountDate,
  parseCountDetail,
  parseCountFieldErrors,
  parseCountFinalization,
  parseCountItem,
  parseCountLineInput,
  parseCountSummaries,
  parseCountSummary,
  parseStartConflict,
  parseStartInput,
  personName,
  unitSymbol,
  type CountItem,
  type CountLine,
} from './inventory-count-contract';
import type { Product } from './products';

// Contrato único de /inventory-counts (SPRINT-5-T17), usado por la toma del
// supervisor (SPRINT-5-T07) y la revisión del administrador (SPRINT-5-T09).
const id = (n: number) =>
  `b9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = { id: id(90), firstName: 'Sofía', lastName: 'Rojas' };
const finalizer = { ...person, id: id(91), firstName: 'Bruno' };
const store = { id: id(80), name: 'Melipilla Centro' };

// Carne Fajita: caja de 5 kg con bolsas de 2,5 kg (ejemplo de la tarjeta).
const fajita: Product = {
  id: id(1),
  sku: 'SUB-123456',
  name: 'Carne Fajita (Beef Steak Saborizado)',
  alternativeNames: ['Beef Steak', 'Carne Queso'],
  unit: 'KG',
  packageName: 'bolsa',
  packagesPerBox: 2,
  packageContent: '2.500',
  boxContent: '5.000',
  looseOnly: false,
  hasFormat: true,
  isActive: true,
  templateRowId: id(11),
  section: 'COSTO PROTEÍNAS',
  templatePosition: 4,
};
const atun: Product = {
  ...fajita,
  id: id(2),
  sku: null,
  name: 'Atún',
  alternativeNames: [],
  packageName: null,
  packagesPerBox: null,
  packageContent: null,
  boxContent: '1.250',
  templateRowId: id(12),
  templatePosition: 5,
};
const lechuga: Product = {
  ...atun,
  id: id(3),
  name: 'Lechuga',
  boxContent: null,
  looseOnly: true,
  templateRowId: id(13),
  section: 'COSTO VERDURAS',
  templatePosition: 20,
};
const fanta: Product = {
  ...fajita,
  id: id(4),
  sku: 'SUB-999',
  name: 'Lata Fanta Zero',
  alternativeNames: [],
  unit: 'UNIT',
  packageName: 'pack',
  packagesPerBox: 4,
  packageContent: '6.000',
  boxContent: '24.000',
  templateRowId: id(14),
  section: 'COSTO DE BEBIDAS',
  templatePosition: 40,
};
const salsa: Product = {
  ...atun,
  id: id(5),
  name: 'Salsa Chipotle',
  unit: 'L',
  packageName: 'botella',
  packageContent: '0.946',
  boxContent: null,
  templateRowId: null,
  section: null,
  templatePosition: null,
};

// 1 caja + 3 bolsas + 2,450 kg = 14,950 kg.
const fajitaLine: CountLine = {
  id: id(21),
  productId: fajita.id,
  boxes: 1,
  packages: 3,
  looseQuantity: '2.450',
  countedQuantity: '14.950',
  productSku: fajita.sku,
  productName: fajita.name,
  unit: 'KG',
  packageName: 'bolsa',
  boxContent: '5.000',
  packagesPerBox: 2,
  packageContent: '2.500',
  looseOnly: false,
  savedAt: '2026-11-11T00:20:00.000Z',
  savedBy: person,
};
// Línea vacía que agrega la finalización a un producto sin contar.
const emptyLine = (product: Product): CountLine => ({
  ...fajitaLine,
  id: id(22),
  productId: product.id,
  boxes: null,
  packages: null,
  looseQuantity: null,
  countedQuantity: null,
});
const item = (product: Product, line: CountLine | null = null): CountItem => ({
  product,
  counted: line !== null && line.countedQuantity !== null,
  line,
});
const summary = {
  id: id(30),
  status: 'OPEN',
  countDate: '2026-11-10',
  startedAt: '2026-11-11T00:15:00.000Z',
  storeId: store.id,
  store,
  startedBy: person,
  finalizedAt: null,
  finalizedBy: null,
  countedProducts: 1,
};
const finalized = {
  ...summary,
  status: 'CONFIRMED',
  finalizedAt: '2026-11-11T01:00:00.000Z',
  finalizedBy: finalizer,
};

test('Etiquetas de estado iguales a las de la API', () => {
  assert.deepEqual(COUNT_STATUS_LABELS, {
    OPEN: 'En curso',
    CONFIRMED: 'Finalizado',
  });
});

test('Resumen: en curso o finalizado, del mismo local, y rechaza lo que no calza', () => {
  assert.deepEqual(parseCountSummary(summary), summary);
  const parsed = parseCountSummary(finalized);
  assert.equal(parsed?.status, 'CONFIRMED');
  assert.equal(parsed?.storeId, store.id);
  assert.equal(parsed?.finalizedBy?.firstName, 'Bruno');
  // Solo los campos del contrato.
  assert.deepEqual(parseCountSummary({ ...summary, extra: 'x' }), summary);
  for (const bad of [
    { ...summary, status: 'DRAFT' },
    { ...summary, countDate: '2026-02-30' },
    { ...summary, startedAt: 'ayer' },
    { ...summary, store: { ...store, id: id(81) } },
    { ...summary, store: { id: store.id } },
    { ...summary, storeId: 'x' },
    { ...summary, countedProducts: -1 },
    { ...finalized, finalizedBy: { id: 'x' } },
    { ...finalized, finalizedAt: 'mañana' },
    null,
  ])
    assert.equal(parseCountSummary(bad), null, JSON.stringify(bad));
  assert.deepEqual(parseCountSummaries([summary, finalized])?.length, 2);
  assert.equal(parseCountSummaries([summary, { id: 1 }]), null);
  assert.equal(parseCountSummaries({}), null);
});

test('Detalle: líneas contadas, vacías y pendientes con la copia del producto', () => {
  const detail = parseCountDetail({
    ...finalized,
    totalProducts: 3,
    pendingProducts: 0,
    items: [
      { product: fajita, counted: true, line: fajitaLine },
      { product: atun, counted: false, line: emptyLine(atun) },
      { product: lechuga, counted: false, line: null },
    ],
  });
  assert.equal(detail?.items.length, 3);
  assert.equal(detail?.items[0].line?.countedQuantity, '14.950');
  assert.equal(detail?.items[0].line?.savedBy.firstName, 'Sofía');
  assert.equal(detail?.items[1].line?.countedQuantity, null);
  assert.equal(detail?.items[2].line, null);
  assert.equal(detail?.totalProducts, 3);
  // Sin totales o sin productos no es un detalle.
  assert.equal(parseCountDetail({ ...summary, items: [] }), null);
  // Cualquier producto inválido invalida el detalle completo.
  assert.equal(
    parseCountDetail({
      ...summary,
      totalProducts: 1,
      pendingProducts: 0,
      items: [{ product: fajita, counted: true, line: { boxes: 1.5 } }],
    }),
    null,
  );
});

test('Línea: enteros, cantidades con punto y la línea de su propio producto', () => {
  assert.ok(parseCountItem(item(fajita, fajitaLine)));
  // Una línea de otro producto, o contado sin línea, no se acepta.
  assert.equal(
    parseCountItem({ product: atun, counted: true, line: fajitaLine }),
    null,
  );
  assert.equal(
    parseCountItem({ product: atun, counted: true, line: null }),
    null,
  );
  for (const bad of [
    { boxes: 1.5 },
    { boxes: -1 },
    { packages: 100001 },
    { countedQuantity: 14.95 },
    { countedQuantity: '1,5' },
    { looseQuantity: '2.4567' },
    { looseQuantity: '1234567890.000' },
    { unit: 'TON' },
    { productName: '' },
    { looseOnly: 'no' },
    { savedBy: { id: 'x' } },
  ])
    assert.equal(
      parseCountItem({
        product: fajita,
        counted: true,
        line: { ...fajitaLine, ...bad },
      }),
      null,
      JSON.stringify(bad),
    );
  // Unidades enteras: «54» es válido.
  assert.ok(
    parseCountItem(
      item(fanta, {
        ...fajitaLine,
        productId: fanta.id,
        unit: 'UNIT',
        boxes: 2,
        packages: 1,
        looseQuantity: '0',
        countedQuantity: '54',
      }),
    ),
  );
});

test('Finalización, conflicto al iniciar y errores por campo', () => {
  const result = {
    ...finalized,
    totalProducts: 140,
    uncountedProducts: 105,
    countedProducts: 35,
  };
  assert.equal(parseCountFinalization(result)?.uncountedProducts, 105);
  assert.equal(parseCountFinalization({ ...result, status: 'OPEN' }), null);
  assert.deepEqual(
    parseStartConflict({
      statusCode: 409,
      existingCountId: id(30),
      existingCountDate: '2026-11-10',
    }),
    { existingCountId: id(30), existingCountDate: '2026-11-10' },
  );
  assert.equal(parseStartConflict({ existingCountId: 'x' }), null);
  assert.deepEqual(
    parseCountFieldErrors({
      errors: { countId: 'La toma está finalizada', other: 'x', boxes: 1 },
    }),
    { countId: 'La toma está finalizada' },
  );
  assert.equal(parseCountFieldErrors({ message: 'x' }), null);
});

test('El BFF solo reenvía los campos del contrato', () => {
  assert.deepEqual(parseStartInput({}), {});
  assert.deepEqual(parseStartInput({ countDate: '2026-11-10' }), {
    countDate: '2026-11-10',
  });
  assert.equal(parseStartInput({ countDate: '10-11-2026' }), null);
  assert.equal(
    parseStartInput({ countDate: '2026-11-10', storeId: id(80) }),
    null,
  );
  assert.equal(parseStartInput(undefined), null);
  assert.deepEqual(
    parseCountLineInput({ boxes: 1, packages: null, looseQuantity: '2.450' }),
    { boxes: 1, packages: null, looseQuantity: '2.450' },
  );
  assert.deepEqual(parseCountLineInput({}), {});
  for (const invalid of [
    { boxes: -1 },
    { boxes: 1.5 },
    { boxes: 100001 },
    { packages: '3' },
    { looseQuantity: 2.45 },
    { looseQuantity: '2,450' },
    { looseQuantity: '2.4567' },
    { countedQuantity: '14.950' },
    null,
    [],
  ])
    assert.equal(parseCountLineInput(invalid), null, JSON.stringify(invalid));
});

test('Fecha de la toma: fecha calendario real AAAA-MM-DD', () => {
  assert.equal(isCountDate('2026-02-28'), true);
  assert.equal(isCountDate('2028-02-29'), true);
  for (const bad of ['2026-02-29', '2026-02-30', '2026-13-01', '11-11-2026', 7])
    assert.equal(isCountDate(bad), false, String(bad));
});

test('Cantidades: kg y L con coma y 3 decimales; unidades enteras', () => {
  assert.equal(formatCountNumber('14.950', 'KG'), '14,950');
  assert.equal(formatCountNumber('2', 'KG'), '2,000');
  assert.equal(formatCountNumber('2.45', 'L'), '2,450');
  assert.equal(formatCountNumber('1234.500', 'KG'), '1.234,500');
  assert.equal(formatCountNumber('123456789.000', 'KG'), '123.456.789,000');
  assert.equal(formatCountNumber('54', 'UNIT'), '54');
  assert.equal(formatCountNumber('1200', 'UNIT'), '1.200');
  assert.equal(formatCountQuantity('14.950', 'KG'), '14,950 kg');
  assert.equal(formatCountQuantity('10.300', 'KG'), '10,300 kg');
  assert.equal(formatCountQuantity('0.930', 'KG'), '0,930 kg');
  assert.equal(formatCountQuantity('7', 'KG'), '7,000 kg');
  assert.equal(formatCountQuantity('2.5', 'L'), '2,500 L');
  assert.equal(formatCountQuantity('0.946', 'L'), '0,946 L');
  assert.equal(formatCountQuantity('6', 'UNIT'), '6 u.');
  assert.equal(formatCountQuantity('1500', 'UNIT'), '1.500 u.');
  assert.deepEqual((['KG', 'L', 'UNIT'] as const).map(unitSymbol), [
    'kg',
    'L',
    'u.',
  ]);
});

test('Secciones consecutivas en el orden de la plantilla, con lo contado', () => {
  const sections = groupCountItems([
    item(fajita, fajitaLine),
    item(atun),
    item(lechuga),
    item(fanta),
    item(salsa),
  ]);
  assert.deepEqual(
    sections.map((section) => [
      section.name,
      section.items.map((entry) => entry.product.name),
      section.counted,
    ]),
    [
      ['COSTO PROTEÍNAS', ['Carne Fajita (Beef Steak Saborizado)', 'Atún'], 1],
      ['COSTO VERDURAS', ['Lechuga'], 0],
      ['COSTO DE BEBIDAS', ['Lata Fanta Zero'], 0],
      [OUTSIDE_TEMPLATE_SECTION, ['Salsa Chipotle'], 0],
    ],
  );
  assert.equal(OUTSIDE_TEMPLATE_SECTION, 'Sin fila en la plantilla');
  assert.equal(new Set(sections.map((section) => section.id)).size, 4);
  // Una sección que reaparece más abajo es otro grupo: se respeta el orden.
  assert.deepEqual(
    groupCountItems([item(fajita), item(lechuga), item(atun)]).map(
      (section) => section.name,
    ),
    ['COSTO PROTEÍNAS', 'COSTO VERDURAS', 'COSTO PROTEÍNAS'],
  );
  assert.deepEqual(groupCountItems([]), []);
});

test('Nombre de la persona sin datos de contacto', () => {
  assert.equal(personName(person), 'Sofía Rojas');
});
