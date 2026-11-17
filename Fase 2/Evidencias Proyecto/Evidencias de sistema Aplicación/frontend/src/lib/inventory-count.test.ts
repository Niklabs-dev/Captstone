import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeCountTotal,
  comparableText,
  countDateError,
  countDateRange,
  countFields,
  countFormatLabel,
  countProgress,
  draftFromLine,
  filterCountItems,
  formatCountNumber,
  formatCountQuantity,
  fromThousandths,
  groupCountItems,
  inventoryCountErrorMessage,
  isCountDate,
  isDraftDirty,
  lineInputFromDraft,
  lineSummary,
  liveCountTotal,
  parseCountDetail,
  parseCountFieldErrors,
  parseCountFinalization,
  parseCountItem,
  parseCountLineInput,
  parseCountSummaries,
  parseLooseInput,
  parsePiecesInput,
  parseStartConflict,
  parseStartInput,
  replaceCountItem,
  toThousandths,
  type CountItem,
  type CountLine,
} from './inventory-count';
import type { Product } from './products';

const id = (n: number) =>
  `b9000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const person = { id: id(90), firstName: 'Sofía', lastName: 'Rojas' };
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
  ...fajita,
  id: id(3),
  sku: null,
  name: 'Lechuga',
  alternativeNames: [],
  packageName: null,
  packagesPerBox: null,
  packageContent: null,
  boxContent: null,
  looseOnly: true,
  hasFormat: true,
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
  ...fajita,
  id: id(5),
  sku: null,
  name: 'Salsa Chipotle',
  alternativeNames: [],
  unit: 'L',
  packageName: 'botella',
  packagesPerBox: null,
  packageContent: '0.946',
  boxContent: null,
  templateRowId: null,
  section: null,
  templatePosition: null,
};

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
const item = (product: Product, line: CountLine | null = null): CountItem => ({
  product,
  counted: line !== null && line.countedQuantity !== null,
  line,
});
const items: CountItem[] = [
  item(fajita, fajitaLine),
  item(atun),
  item(lechuga),
  item(fanta),
  item(salsa),
];
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

test('Cajas y paquetes: enteros desde 0 hasta 100.000', () => {
  assert.equal(parsePiecesInput(''), null);
  assert.equal(parsePiecesInput('  '), null);
  assert.equal(parsePiecesInput('0'), 0);
  assert.equal(parsePiecesInput(' 3 '), 3);
  assert.equal(parsePiecesInput('100000'), 100000);
  for (const invalid of ['100001', '1,5', '1.5', '-1', 'dos', '1e3'])
    assert.equal(parsePiecesInput(invalid), undefined, invalid);
});

test('Cantidad suelta: acepta coma o punto decimal y la envía con punto', () => {
  assert.equal(parseLooseInput('2,450', 'KG'), '2.450');
  assert.equal(parseLooseInput('2.450', 'KG'), '2.450');
  assert.equal(parseLooseInput(' 2,45 ', 'L'), '2.45');
  assert.equal(parseLooseInput('0', 'KG'), '0');
  assert.equal(parseLooseInput('', 'KG'), null);
  for (const invalid of ['2,4501', '2,', ',5', '-1', '1.234,5', 'abc'])
    assert.equal(parseLooseInput(invalid, 'KG'), undefined, invalid);
  // En unidades, solo enteros: «6.000» sería ambiguo.
  assert.equal(parseLooseInput('6', 'UNIT'), '6');
  assert.equal(parseLooseInput('007', 'UNIT'), '7');
  for (const invalid of ['6,5', '6.000', '6,0'])
    assert.equal(parseLooseInput(invalid, 'UNIT'), undefined, invalid);
});

test('Formato de números: kg y L con coma y 3 decimales; unidades enteras', () => {
  assert.equal(formatCountNumber('14.950', 'KG'), '14,950');
  assert.equal(formatCountNumber('2', 'KG'), '2,000');
  assert.equal(formatCountNumber('2.45', 'L'), '2,450');
  assert.equal(formatCountNumber('1234.500', 'KG'), '1.234,500');
  assert.equal(formatCountNumber('54', 'UNIT'), '54');
  assert.equal(formatCountNumber('1200', 'UNIT'), '1.200');
  assert.equal(formatCountQuantity('14.950', 'KG'), '14,950 kg');
  assert.equal(formatCountQuantity('0.946', 'L'), '0,946 L');
  assert.equal(formatCountQuantity('54', 'UNIT'), '54 u.');
});

test('Total exacto, sin punto flotante, como count-line.util.ts', () => {
  const format = { ...fajita };
  // Ejemplo de la tarjeta: 1 caja + 3 bolsas + 2,450 kg = 14,950 kg.
  assert.equal(
    computeCountTotal(format, {
      boxes: 1,
      packages: 3,
      looseQuantity: '2.450',
    }),
    '14.950',
  );
  // Ejemplo de la API: 1 caja + 2 bolsas + 0,300 kg = 10,300 kg.
  assert.equal(
    computeCountTotal(format, { boxes: 1, packages: 2, looseQuantity: '0.3' }),
    '10.300',
  );
  // 0,1 + 0,2 en float daría 0,30000000000000004.
  assert.equal(
    computeCountTotal(
      { ...lechuga, boxContent: '0.100', looseOnly: false },
      { boxes: 1, packages: null, looseQuantity: '0.2' },
    ),
    '0.300',
  );
  assert.equal(
    computeCountTotal(fanta, { boxes: 2, packages: 1, looseQuantity: '3' }),
    '57',
  );
  assert.equal(
    computeCountTotal(fajita, {
      boxes: null,
      packages: null,
      looseQuantity: '0',
    }),
    '0.000',
  );
  // 100.000 cajas de 999.999.999,999 kg no pierden precisión.
  assert.equal(
    computeCountTotal(
      { ...fajita, boxContent: '999999999.999', packageContent: null },
      { boxes: 100000, packages: null, looseQuantity: '0.001' },
    ),
    '99999999999900.001',
  );
  assert.equal(toThousandths('2.45'), BigInt(2450));
  assert.equal(fromThousandths(BigInt(14950), 'KG'), '14.950');
  assert.equal(fromThousandths(BigInt(54000), 'UNIT'), '54');
});

test('Total en vivo desde lo escrito, con coma o punto', () => {
  const draft = { boxes: '1', packages: '3', looseQuantity: '2,450' };
  assert.equal(liveCountTotal(fajita, draft), '14.950');
  assert.equal(
    formatCountQuantity(liveCountTotal(fajita, draft)!, 'KG'),
    '14,950 kg',
  );
  assert.equal(
    liveCountTotal(fajita, { ...draft, looseQuantity: '2.450' }),
    '14.950',
  );
  // Vacío o inválido: sin total.
  assert.equal(
    liveCountTotal(fajita, { boxes: '', packages: '', looseQuantity: '' }),
    null,
  );
  assert.equal(liveCountTotal(fajita, { ...draft, boxes: '1,5' }), null);
  // Lo que no aplica al formato no suma.
  assert.equal(
    liveCountTotal(lechuga, {
      boxes: '9',
      packages: '9',
      looseQuantity: '1,2',
    }),
    '1.200',
  );
});

test('Cuerpo de la API: solo los campos que aplican y la cantidad suelta como texto', () => {
  assert.deepEqual(
    lineInputFromDraft(fajita, {
      boxes: '1',
      packages: '3',
      looseQuantity: '2,450',
    }),
    {
      input: { boxes: 1, packages: 3, looseQuantity: '2.450' },
      quantities: { boxes: 1, packages: 3, looseQuantity: '2.450' },
    },
  );
  const atunResult = lineInputFromDraft(atun, {
    boxes: '2',
    packages: '7',
    looseQuantity: '',
  });
  assert.ok('input' in atunResult);
  assert.deepEqual(atunResult.input, { boxes: 2, looseQuantity: null });
  const lechugaResult = lineInputFromDraft(lechuga, {
    boxes: '2',
    packages: '',
    looseQuantity: '0',
  });
  assert.ok('input' in lechugaResult);
  assert.deepEqual(lechugaResult.input, { looseQuantity: '0' });
  // Errores junto a cada campo.
  const invalid = lineInputFromDraft(fajita, {
    boxes: '1,5',
    packages: '-2',
    looseQuantity: '2,4567',
  });
  assert.ok('errors' in invalid);
  assert.deepEqual(Object.keys(invalid.errors).sort(), [
    'boxes',
    'looseQuantity',
    'packages',
  ]);
  const unit = lineInputFromDraft(fanta, {
    boxes: '',
    packages: '',
    looseQuantity: '2,5',
  });
  assert.ok('errors' in unit);
  assert.match(unit.errors.looseQuantity ?? '', /entero/);
  const empty = lineInputFromDraft(fajita, {
    boxes: '',
    packages: '',
    looseQuantity: '',
  });
  assert.ok('errors' in empty);
  assert.match(empty.errors.looseQuantity ?? '', /0 si no queda/);
});

test('Campos y formato de cada producto', () => {
  assert.deepEqual(countFields(fajita), {
    boxes: true,
    packages: true,
    packagesLabel: 'Bolsas',
    looseLabel: 'Suelto (kg)',
    looseInputMode: 'decimal',
  });
  assert.equal(countFields(atun).packages, false);
  assert.equal(countFields(atun).boxes, true);
  assert.deepEqual(
    [countFields(lechuga).boxes, countFields(lechuga).packages],
    [false, false],
  );
  assert.equal(countFields(fanta).packagesLabel, 'Packs');
  assert.equal(countFields(fanta).looseInputMode, 'numeric');
  assert.equal(countFields(fanta).looseLabel, 'Suelto (u.)');
  assert.equal(countFields(salsa).packagesLabel, 'Botellas');
  assert.equal(countFormatLabel(fajita), 'Caja 5 kg · bolsa 2,5 kg');
  assert.equal(countFormatLabel(atun), 'Caja 1,25 kg');
  assert.equal(countFormatLabel(lechuga), 'Solo cantidad suelta (kg)');
  assert.equal(countFormatLabel(fanta), 'Caja 24 u. · pack 6 u.');
  assert.equal(countFormatLabel(salsa), 'Botella 0,946 L');
  assert.equal(
    countFormatLabel({ ...atun, boxContent: null }),
    'Cantidad suelta (kg)',
  );
});

test('Lo guardado vuelve como texto editable y se compara por valor', () => {
  const draft = draftFromLine(fajitaLine);
  assert.deepEqual(draft, {
    boxes: '1',
    packages: '3',
    looseQuantity: '2,450',
  });
  assert.deepEqual(draftFromLine(null), {
    boxes: '',
    packages: '',
    looseQuantity: '',
  });
  assert.equal(isDraftDirty(fajita, draft, fajitaLine), false);
  assert.equal(
    isDraftDirty(fajita, { ...draft, looseQuantity: '2.45' }, fajitaLine),
    false,
  );
  assert.equal(
    isDraftDirty(fajita, { ...draft, looseQuantity: '2,451' }, fajitaLine),
    true,
  );
  assert.equal(isDraftDirty(fajita, { ...draft, boxes: '' }, fajitaLine), true);
  assert.equal(
    isDraftDirty(fajita, { ...draft, boxes: 'x' }, fajitaLine),
    true,
  );
  assert.equal(isDraftDirty(atun, draftFromLine(null), null), false);
  assert.equal(
    isDraftDirty(atun, { boxes: '', packages: '', looseQuantity: '0' }, null),
    true,
  );
  assert.equal(lineSummary(fajitaLine), '1 caja + 3 bolsas + 2,450 kg');
  assert.equal(
    lineSummary({ ...fajitaLine, boxes: 2, packages: 1, looseQuantity: null }),
    '2 cajas + 1 bolsa',
  );
});

test('Secciones en el orden de la plantilla y avance «contados X de Y»', () => {
  const sections = groupCountItems(items);
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
      ['Sin fila en la plantilla', ['Salsa Chipotle'], 0],
    ],
  );
  assert.equal(new Set(sections.map((section) => section.id)).size, 4);
  assert.deepEqual(countProgress(items), { counted: 1, total: 5, percent: 20 });
  assert.deepEqual(countProgress([]), { counted: 0, total: 0, percent: 0 });
  assert.equal(groupCountItems([]).length, 0);
});

test('Búsqueda por nombre, nombre alternativo o SKU, sin mayúsculas ni tildes', () => {
  const names = (search: string, filter?: 'all' | 'pending' | 'counted') =>
    filterCountItems(items, search, filter).map((entry) => entry.product.name);
  assert.deepEqual(names('beef steak'), [fajita.name]);
  assert.deepEqual(names('carne queso'), [fajita.name]);
  assert.deepEqual(names('  CARNE   queso '), [fajita.name]);
  assert.deepEqual(names('sub-123'), [fajita.name]);
  assert.deepEqual(names('atun'), ['Atún']);
  assert.deepEqual(names('ATÚN'), ['Atún']);
  assert.equal(names('').length, items.length);
  assert.deepEqual(names('', 'counted'), [fajita.name]);
  assert.equal(names('', 'pending').length, 4);
  assert.deepEqual(names('fajita', 'pending'), []);
  // También por la copia del nombre en la línea (si el producto cambió).
  const renamed = item({ ...fajita, name: 'Carne nueva' }, fajitaLine);
  assert.equal(filterCountItems([renamed], 'beef steak saborizado').length, 1);
  assert.equal(comparableText(' Ñandú  Á '), 'nandu a');
});

test('Guardar reemplaza el producto sin cambiar el orden', () => {
  const saved = item(atun, {
    ...fajitaLine,
    id: id(22),
    productId: atun.id,
    productName: atun.name,
    boxes: 2,
    packages: null,
    looseQuantity: null,
    countedQuantity: '2.500',
  });
  const next = replaceCountItem(items, saved);
  assert.equal(next[1], saved);
  assert.equal(next.length, items.length);
  assert.deepEqual(countProgress(next), { counted: 2, total: 5, percent: 40 });
});

test('Fecha de la toma: hoy o hasta 7 días atrás', () => {
  assert.deepEqual(countDateRange('2026-11-10'), {
    min: '2026-11-03',
    max: '2026-11-10',
  });
  assert.deepEqual(countDateRange('2026-03-02'), {
    min: '2026-02-23',
    max: '2026-03-02',
  });
  assert.equal(countDateError('2026-11-10', '2026-11-10'), null);
  assert.equal(countDateError('2026-11-03', '2026-11-10'), null);
  assert.match(countDateError('2026-11-11', '2026-11-10') ?? '', /posterior/);
  assert.match(countDateError('2026-11-02', '2026-11-10') ?? '', /7 días/);
  assert.match(countDateError('', '2026-11-10') ?? '', /Ingresa/);
  assert.equal(isCountDate('2026-02-30'), false);
  assert.equal(isCountDate('2026-02-28'), true);
});

test('Contrato: listado, detalle, línea y finalización', () => {
  assert.deepEqual(parseCountSummaries([summary]), [summary]);
  assert.equal(parseCountSummaries([{ ...summary, status: 'DRAFT' }]), null);
  assert.equal(
    parseCountSummaries([{ ...summary, store: { ...store, id: id(81) } }]),
    null,
  );
  const detail = parseCountDetail({
    ...summary,
    totalProducts: 2,
    pendingProducts: 1,
    items: [
      { product: fajita, counted: true, line: fajitaLine },
      { product: atun, counted: false, line: null },
    ],
  });
  assert.equal(detail?.items.length, 2);
  assert.equal(detail?.items[0].line?.countedQuantity, '14.950');
  // Una línea de otro producto, o contado sin línea, no se acepta.
  assert.equal(
    parseCountItem({ product: atun, counted: true, line: fajitaLine }),
    null,
  );
  assert.equal(
    parseCountItem({ product: atun, counted: true, line: null }),
    null,
  );
  assert.equal(
    parseCountItem({
      product: fajita,
      counted: true,
      line: { ...fajitaLine, countedQuantity: 14.95 },
    }),
    null,
  );
  // Línea vacía de una toma finalizada.
  assert.ok(
    parseCountItem({
      product: atun,
      counted: false,
      line: {
        ...fajitaLine,
        productId: atun.id,
        boxes: null,
        packages: null,
        looseQuantity: null,
        countedQuantity: null,
      },
    }),
  );
  const finalized = {
    ...summary,
    status: 'CONFIRMED',
    finalizedAt: '2026-11-11T01:00:00.000Z',
    finalizedBy: person,
    totalProducts: 140,
    uncountedProducts: 105,
    countedProducts: 35,
  };
  assert.equal(parseCountFinalization(finalized)?.uncountedProducts, 105);
  assert.equal(parseCountFinalization({ ...finalized, status: 'OPEN' }), null);
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

test('Mensajes claros para iniciar, guardar y finalizar', () => {
  assert.match(
    inventoryCountErrorMessage(400, 'finalize'),
    /productos contados/,
  );
  assert.match(
    inventoryCountErrorMessage(409, 'finalize'),
    /ya estaba finalizada/,
  );
  assert.match(inventoryCountErrorMessage(503, 'save'), /se conserva/);
  assert.match(inventoryCountErrorMessage(403), /supervisor/);
  assert.equal(
    inventoryCountErrorMessage(500, 'load'),
    inventoryCountErrorMessage(502, 'load'),
  );
});
