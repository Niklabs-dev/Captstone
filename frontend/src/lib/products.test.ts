import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildCatalog,
  canReleaseRow,
  catalogCounts,
  catalogSummary,
  countLabel,
  creationProgress,
  formatExample,
  formatQuantity,
  formatSummary,
  freeRowOptions,
  packageLabel,
  parseDecimalInput,
  parseFieldErrors,
  parseProduct,
  parseProductInput,
  parseSuggestion,
  parseTemplateRow,
  parseTemplateRowTextInput,
  parseTemplateRows,
  productErrorMessage,
  productFormValues,
  productInputFromForm,
  productLoadErrorMessage,
  productUpdate,
  templateRowTextError,
  templateRowTextFromForm,
  type Product,
  type ProductFilters,
  type ProductFormValues,
  type TemplateRow,
} from './products';

const id = (n: number) => `a9000000-0000-4000-8000-00000000000${n}`;
const fajita: Product = {
  id: id(1),
  sku: null,
  name: 'Carne Fajita (Beef Steak Saborizado)',
  alternativeNames: ['Beef Steak'],
  unit: 'KG',
  packageName: 'bolsa',
  packagesPerBox: 2,
  packageContent: '2.500',
  boxContent: '5.000',
  looseOnly: false,
  hasFormat: true,
  isActive: true,
  templateRowId: id(5),
  section: 'COSTO PROTEÍNAS',
  templatePosition: 4,
};
const bebida: Product = {
  ...fajita,
  id: id(2),
  sku: 'SUB-111',
  name: 'Lata Fanta Zero',
  alternativeNames: [],
  hasFormat: false,
  packageContent: null,
  boxContent: null,
  isActive: false,
  templateRowId: id(7),
  section: 'COSTO DE BEBIDAS',
  templatePosition: 99,
};
const row = (
  n: number,
  position: number,
  kind: TemplateRow['kind'],
  printedText: string | null,
  section: string,
  product: Product | null = null,
): TemplateRow => ({
  id: id(n),
  position,
  kind,
  printedText,
  section,
  isEmptyRow: printedText === '<Vacío>',
  product,
});
const rows: TemplateRow[] = [
  row(
    5,
    4,
    'ITEM',
    'Carne Fajita (Beef Steak Saborizado)',
    'COSTO PROTEÍNAS',
    fajita,
  ),
  row(6, 9, 'ITEM', 'Pepperoni', 'COSTO PROTEÍNAS'),
  row(8, 38, 'ITEM', '<Vacío>', 'COSTO PROTEÍNAS'),
  row(9, 45, 'SECTION', 'COSTO PROTEÍNAS', 'COSTO PROTEÍNAS'),
  row(7, 99, 'ITEM', 'Lata Fanta Zero', 'COSTO DE BEBIDAS', bebida),
  row(4, 141, 'SECTION', 'COSTO DE BEBIDAS', 'COSTO DE BEBIDAS'),
];
const filters: ProductFilters = {
  search: '',
  section: '',
  status: 'active',
  missingSku: false,
  missingFormat: false,
};
const form: ProductFormValues = {
  name: 'Pepperoni',
  section: 'COSTO PROTEÍNAS',
  templateRowId: '',
  unit: 'KG',
  sku: '',
  alternativeNames: '',
  packageName: 'paquete',
  packagesPerBox: '8',
  packageContent: '0,93',
  boxContent: '7,3',
  looseOnly: false,
};

test('Muestra el formato en una línea con plurales correctos', () => {
  assert.equal(formatSummary(fajita), 'Caja 5 kg · 2 bolsas de 2,5 kg');
  assert.equal(
    formatSummary({
      ...fajita,
      unit: 'UNIT',
      packageName: 'pack',
      packagesPerBox: 4,
      packageContent: '6.000',
      boxContent: '24.000',
    }),
    'Caja 24 u. · 4 packs de 6 u.',
  );
  assert.equal(
    formatSummary({ ...fajita, looseOnly: true }),
    'Solo cantidad suelta',
  );
  assert.equal(formatSummary(bebida), null);
  assert.equal(packageLabel('pack', 2), 'packs');
  assert.equal(packageLabel('botella', 1), 'botella');
  assert.equal(countLabel(1, 'producto', 'productos'), '1 producto');
  assert.equal(countLabel(3, 'producto', 'productos'), '3 productos');
});

test('Acepta decimales con coma', () => {
  assert.equal(parseDecimalInput('2,5'), '2.5');
  assert.equal(parseDecimalInput(' 0,300 '), '0.300');
  assert.equal(parseDecimalInput(''), null);
  for (const bad of ['0', '-1', '1,2345', 'abc'])
    assert.equal(parseDecimalInput(bad), undefined, bad);
  assert.equal(formatQuantity('1234.500'), '1.234,5');
});

test('Arma el ejemplo calculado del formato ingresado', () => {
  assert.equal(
    formatExample({
      unit: 'KG',
      packageName: 'bolsa',
      packageContent: '2.5',
      boxContent: '5',
      looseOnly: false,
    }),
    '1 caja + 3 bolsas + 2,450 kg = 14,950 kg',
  );
  assert.equal(
    formatExample({
      unit: 'KG',
      packageName: null,
      packageContent: null,
      boxContent: null,
      looseOnly: false,
    }),
    null,
  );
  assert.equal(
    formatExample({
      unit: 'KG',
      packageName: null,
      packageContent: null,
      boxContent: null,
      looseOnly: true,
    }),
    '2,450 kg = 2,450 kg',
  );
});

test('El formulario guarda caja y paquete por separado y valida en el navegador', () => {
  const ok = productInputFromForm(form);
  assert.ok('input' in ok);
  assert.equal(ok.input.boxContent, '7.3');
  assert.equal(ok.input.packageContent, '0.93');
  assert.equal(ok.input.packagesPerBox, 8);
  assert.equal(ok.input.templateRowId, undefined);
  assert.deepEqual(
    Object.keys(productUpdate(ok.input)).includes('section'),
    false,
  );

  const withRow = productInputFromForm({ ...form, templateRowId: id(6) });
  assert.ok('input' in withRow && withRow.input.templateRowId === id(6));

  const bad = productInputFromForm({
    ...form,
    name: ' ',
    section: '',
    packagesPerBox: '0',
    packageContent: '2,5555',
    packageName: 'caja',
    alternativeNames: 'Dup, dup',
  });
  assert.ok('errors' in bad);
  assert.deepEqual(Object.keys(bad.errors).sort(), [
    'alternativeNames',
    'name',
    'packageContent',
    'packageName',
    'packagesPerBox',
    'section',
  ]);

  const loose = productInputFromForm({ ...form, looseOnly: true });
  assert.ok('input' in loose);
  assert.equal(loose.input.boxContent, null);
  assert.equal(loose.input.packageName, null);

  const unit = productInputFromForm({ ...form, unit: 'UNIT' });
  assert.ok('errors' in unit && unit.errors.packageContent);
});

test('Al editar exige una fila: cambiar la sección obliga a elegir una de la nueva', () => {
  const values = productFormValues(fajita);
  const kept = productInputFromForm(values, 'edit');
  assert.ok('input' in kept && kept.input.templateRowId === id(5));

  const otherSection = productInputFromForm(
    { ...values, section: 'COSTO DE BEBIDAS', templateRowId: '' },
    'edit',
  );
  assert.ok('errors' in otherSection);
  assert.equal(
    otherSection.errors.templateRowId,
    'Elige una fila libre de «COSTO DE BEBIDAS».',
  );

  const moved = productInputFromForm(
    { ...values, section: 'COSTO DE BEBIDAS', templateRowId: id(7) },
    'edit',
  );
  assert.ok('input' in moved && moved.input.templateRowId === id(7));

  // Al crear, sin fila se usa la sugerencia de la API.
  const created = productInputFromForm({ ...values, templateRowId: '' });
  assert.ok('input' in created && created.input.templateRowId === undefined);
});

test('El error de carga del listado no promete conservar lo escrito', () => {
  assert.equal(
    productLoadErrorMessage(503),
    'No se pudo conectar con el servicio. Intenta nuevamente.',
  );
  assert.equal(productLoadErrorMessage(403), productErrorMessage(403));
});

test('Precarga al editar y desde una fila pendiente', () => {
  const values = productFormValues(fajita);
  assert.equal(values.packageContent, '2,5');
  assert.equal(values.boxContent, '5');
  assert.equal(values.alternativeNames, 'Beef Steak');
  assert.equal(values.templateRowId, id(5));
  const pending = productFormValues(null, rows[1]);
  assert.equal(pending.name, 'Pepperoni');
  assert.equal(pending.section, 'COSTO PROTEÍNAS');
  assert.equal(pending.templateRowId, id(6));
  assert.equal(productFormValues(null, rows[2]).name, '');
});

test('Valida respuestas de la API y cuerpos que reenvía el BFF', () => {
  assert.ok(parseProduct(fajita));
  for (const bad of [
    { ...fajita, id: 'x' },
    { ...fajita, unit: 'G' },
    { ...fajita, boxContent: '5,0' },
    { ...fajita, templateRowId: 'x' },
  ])
    assert.equal(parseProduct(bad), null);
  assert.equal(parseTemplateRows(rows)?.length, rows.length);
  assert.equal(parseTemplateRows([{ ...rows[0], kind: 'OTRO' }]), null);
  assert.deepEqual(parseSuggestion({ row: null, reason: null }), {
    row: null,
    reason: null,
  });
  assert.equal(parseSuggestion({ row: rows[1], reason: 'OTRA' }), null);

  assert.ok(parseProductInput({ name: 'A', section: 'S', unit: 'KG' }, false));
  assert.ok(
    parseProductInput(
      { name: 'A', section: 'S', unit: 'KG', templateRowId: id(6) },
      false,
    ),
  );
  assert.equal(parseProductInput({ name: 'A' }, false), null);
  assert.ok(parseProductInput({ name: 'A' }, true));
  assert.equal(parseProductInput({ section: 'S' }, true), null);
  assert.equal(parseProductInput({ templateRowId: id(6) }, true), null);
  assert.equal(parseProductInput({ name: 'A', role: 'ADMIN' }, true), null);
  assert.equal(parseProductInput({ packageName: 'caja' }, true), null);
  assert.equal(parseProductInput({ boxContent: '2,5' }, true), null);
});

test('Solo reenvía errores por campo conocidos', () => {
  assert.deepEqual(
    parseFieldErrors({
      errors: { name: 'Repetido', templateRowId: 'Sin filas', password: 'x' },
    }),
    { name: 'Repetido', templateRowId: 'Sin filas' },
  );
  // El texto de una fila de la plantilla (SPRINT-5-T15) también es un campo.
  assert.deepEqual(
    parseFieldErrors({ errors: { printedText: 'La fila tiene un producto' } }),
    { printedText: 'La fila tiene un producto' },
  );
  assert.equal(parseFieldErrors({ message: 'x' }), null);
});

test('Cuenta los productos creados y lista las filas libres de una sección', () => {
  assert.deepEqual(creationProgress(rows), { created: 2, total: 3 });
  assert.deepEqual(
    freeRowOptions(rows, 'COSTO PROTEÍNAS').map((option) => option.label),
    ['Fila 9 · Pepperoni (pendiente)', 'Fila 38 · libre (<Vacío>)'],
  );
  assert.deepEqual(
    freeRowOptions(rows, 'COSTO PROTEÍNAS', id(5)).map((option) => option.id),
    [id(5), id(6), id(8)],
  );
});

test('Arma el listado por sección con pendientes, búsqueda por SKU y filtros', () => {
  const ids = (groups: ReturnType<typeof buildCatalog>) =>
    groups.map((group) => [
      group.id,
      group.entries.map((entry) =>
        entry.kind === 'pending'
          ? `pendiente:${entry.row.position}`
          : entry.product.name,
      ),
    ]);
  const products = [fajita, bebida];
  assert.deepEqual(ids(buildCatalog(rows, products, filters)), [
    ['section-45', [fajita.name, 'pendiente:9']],
  ]);
  assert.deepEqual(
    ids(
      buildCatalog(rows, products, {
        ...filters,
        status: 'all',
        search: 'sub-111',
      }),
    ),
    [['section-141', ['Lata Fanta Zero']]],
  );
  assert.deepEqual(
    ids(buildCatalog(rows, products, { ...filters, status: 'pending' })),
    [['section-45', ['pendiente:9']]],
  );
  assert.deepEqual(
    ids(
      buildCatalog(rows, products, {
        ...filters,
        status: 'all',
        missingSku: true,
      }),
    ),
    [['section-45', [fajita.name]]],
  );
  assert.deepEqual(
    ids(
      buildCatalog(rows, products, {
        ...filters,
        status: 'all',
        missingFormat: true,
      }),
    ),
    [['section-141', ['Lata Fanta Zero']]],
  );
  assert.deepEqual(
    ids(buildCatalog(rows, products, { ...filters, search: 'beef' })),
    [['section-45', [fajita.name]]],
  );
  // Un producto sin fila (liberada) va al final.
  const orphan: Product = {
    ...bebida,
    id: id(3),
    name: 'Sin fila',
    isActive: true,
    templateRowId: null,
    section: null,
    templatePosition: null,
  };
  assert.deepEqual(
    ids(buildCatalog(rows, [...products, orphan], filters)).at(-1),
    ['section-none', ['Sin fila']],
  );
});

// SPRINT-5-T15: corregir el texto de una fila y liberar la fila de un
// producto desactivado.
test('Lista las filas <Vacío> libres solo en su propio estado', () => {
  const ids = (groups: ReturnType<typeof buildCatalog>) =>
    groups.map((group) =>
      group.entries.map((entry) =>
        entry.kind === 'pending'
          ? `${entry.row.isEmptyRow ? 'libre' : 'pendiente'}:${entry.row.position}`
          : entry.product.name,
      ),
    );
  const products = [fajita, bebida];
  for (const status of ['active', 'pending', 'all', 'inactive'] as const)
    assert.ok(
      !ids(buildCatalog(rows, products, { ...filters, status }))
        .flat()
        .includes('libre:38'),
      status,
    );
  const empty = buildCatalog(rows, products, { ...filters, status: 'empty' });
  assert.deepEqual(ids(empty), [['libre:38']]);
  assert.deepEqual(catalogCounts(empty[0].entries), {
    products: 0,
    pending: 0,
    free: 1,
  });
  assert.deepEqual(
    catalogCounts(buildCatalog(rows, products, filters)[0].entries),
    { products: 1, pending: 1, free: 0 },
  );
  assert.equal(catalogSummary(empty[0].entries), '1 fila libre');
  assert.equal(
    catalogSummary(buildCatalog(rows, products, filters)[0].entries),
    '1 producto · 1 pendiente',
  );
  assert.equal(
    catalogSummary(
      buildCatalog(rows, products, { ...filters, status: 'pending' })[0]
        .entries,
    ),
    '1 pendiente',
  );
  assert.equal(catalogSummary([]), '0 productos');
  assert.deepEqual(
    buildCatalog(rows, products, {
      ...filters,
      status: 'empty',
      missingSku: true,
    }),
    [],
  );
});

test('Valida el texto corregido de una fila en el navegador', () => {
  assert.deepEqual(templateRowTextFromForm('  Lata   Pepsi ', 'Pepperoni'), {
    printedText: 'Lata Pepsi',
  });
  for (const empty of ['<vacio>', 'Vacío', ' <VACÍO> '])
    assert.deepEqual(
      templateRowTextFromForm(empty, 'Pepperoni'),
      { printedText: '<Vacío>' },
      empty,
    );
  assert.deepEqual(templateRowTextFromForm('   ', 'Pepperoni'), {
    error: 'Ingresa el texto de la fila o <Vacío> para dejarla libre.',
  });
  assert.deepEqual(templateRowTextFromForm('x'.repeat(121), null), {
    error: 'Máximo 120 caracteres.',
  });
  assert.deepEqual(templateRowTextFromForm('Pepperoni ', 'Pepperoni'), {
    error: 'Escribe un texto distinto al actual.',
  });
  assert.deepEqual(templateRowTextFromForm('vacio', '<Vacío>'), {
    error: 'Escribe un texto distinto al actual.',
  });
});

test('El BFF solo reenvía el texto de la fila y valida su respuesta', () => {
  assert.deepEqual(parseTemplateRowTextInput({ printedText: ' Lata ' }), {
    printedText: 'Lata',
  });
  for (const bad of [
    null,
    {},
    { printedText: '' },
    { printedText: '   ' },
    { printedText: 'x'.repeat(121) },
    { printedText: 5 },
    { printedText: 'Lata', position: 1 },
    { printedText: 'Lata', productId: id(1) },
  ])
    assert.equal(parseTemplateRowTextInput(bad), null, JSON.stringify(bad));
  assert.deepEqual(parseTemplateRow(rows[1]), rows[1]);
  assert.deepEqual(parseTemplateRow(rows[0])?.product, fajita);
  assert.equal(parseTemplateRow({ ...rows[1], position: '9' }), null);
  assert.equal(parseTemplateRow({ ...rows[0], product: { id: 'x' } }), null);
});

test('El error del texto va junto al campo y solo se libera la fila de un desactivado', () => {
  assert.equal(
    templateRowTextError(409, { printedText: 'La fila tiene un producto' }),
    'La fila tiene un producto',
  );
  assert.equal(
    templateRowTextError(400, null),
    'Usa entre 1 y 120 caracteres.',
  );
  assert.equal(templateRowTextError(404, null), null);
  assert.equal(templateRowTextError(503, null), null);

  assert.equal(canReleaseRow(bebida), true);
  assert.equal(canReleaseRow(fajita), false);
  assert.equal(canReleaseRow({ ...bebida, templateRowId: null }), false);
});
