import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeBoxContent,
  filterProducts,
  formatExample,
  formatQuantity,
  formatSummary,
  groupBySection,
  parseDecimalInput,
  parseFieldErrors,
  parseProduct,
  parseProductInput,
  productFormValues,
  productInputFromForm,
  type Product,
  type ProductFormValues,
} from './products';

const id = 'a9000000-0000-4000-8000-000000000001';
const other = 'a9000000-0000-4000-8000-000000000002';
const fajita: Product = {
  id,
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
  section: 'COSTO PROTEÍNAS',
  templatePosition: 4,
};
const form: ProductFormValues = {
  name: 'Carne Fajita',
  section: 'COSTO PROTEÍNAS',
  unit: 'KG',
  sku: '',
  alternativeNames: '',
  packageName: 'bolsa',
  packagesPerBox: '2',
  packageContent: '2,5',
  boxContent: '',
  looseOnly: false,
};

test('Muestra el formato en una línea o indica que falta', () => {
  assert.equal(formatSummary(fajita), 'Caja 5 kg · 2 bolsas de 2,5 kg');
  assert.equal(
    formatSummary({ ...fajita, packageContent: null, packagesPerBox: null }),
    'Caja 5 kg',
  );
  assert.equal(
    formatSummary({ ...fajita, looseOnly: true }),
    'Solo cantidad suelta',
  );
  assert.equal(
    formatSummary({
      ...fajita,
      boxContent: null,
      packageContent: null,
      packagesPerBox: null,
    }),
    null,
  );
});

test('Acepta decimales con coma y calcula la caja sin errores de redondeo', () => {
  assert.equal(parseDecimalInput('2,5'), '2.5');
  assert.equal(parseDecimalInput(' 0,300 '), '0.300');
  assert.equal(parseDecimalInput(''), null);
  for (const bad of ['0', '-1', '1,2345', 'abc'])
    assert.equal(parseDecimalInput(bad), undefined, bad);
  assert.equal(computeBoxContent(2, '2.5'), '5.000');
  assert.equal(computeBoxContent(3, '0.1'), '0.300');
  assert.equal(computeBoxContent(null, '2.5'), null);
  assert.equal(formatQuantity('1234.500'), '1.234,5');
});

test('Arma el ejemplo calculado del formato', () => {
  assert.equal(
    formatExample({
      unit: 'KG',
      packageName: 'bolsa',
      packageContent: '2.5',
      boxContent: '5.000',
      looseOnly: false,
    }),
    '1 caja + 2 bolsas + 0,300 kg = 10,300 kg',
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
    '0,300 kg = 0,300 kg',
  );
});

test('El formulario calcula el contenido por caja y valida en el navegador', () => {
  const ok = productInputFromForm(form);
  assert.ok('input' in ok);
  assert.equal(ok.input.boxContent, '5.000');
  assert.equal(ok.input.packageContent, '2.5');
  assert.equal(ok.input.sku, null);

  const bad = productInputFromForm({
    ...form,
    name: ' ',
    section: '',
    packagesPerBox: '0',
    packageContent: '2,5555',
  });
  assert.ok('errors' in bad);
  assert.deepEqual(Object.keys(bad.errors).sort(), [
    'name',
    'packageContent',
    'packagesPerBox',
    'section',
  ]);

  const loose = productInputFromForm({ ...form, looseOnly: true });
  assert.ok('input' in loose);
  assert.equal(loose.input.boxContent, null);
  assert.equal(loose.input.packageName, null);

  const unit = productInputFromForm({
    ...form,
    unit: 'UNIT',
    packagesPerBox: '',
    packageContent: '1,5',
  });
  assert.ok('errors' in unit && unit.errors.packageContent);
});

test('Al editar precarga el formulario con coma decimal', () => {
  const values = productFormValues(fajita);
  assert.equal(values.packageContent, '2,5');
  assert.equal(values.boxContent, '5');
  assert.equal(values.alternativeNames, 'Beef Steak');
});

test('Valida respuestas de la API y cuerpos que reenvía el BFF', () => {
  assert.ok(parseProduct(fajita));
  for (const bad of [
    { ...fajita, id: 'x' },
    { ...fajita, unit: 'G' },
    { ...fajita, boxContent: '5,0' },
    { ...fajita, packagesPerBox: 0 },
  ])
    assert.equal(parseProduct(bad), null);
  assert.ok(parseProductInput({ name: 'A', section: 'S', unit: 'KG' }, false));
  assert.equal(parseProductInput({ name: 'A' }, false), null);
  assert.ok(parseProductInput({ name: 'A' }, true));
  assert.equal(parseProductInput({ name: 'A', role: 'ADMIN' }, true), null);
  assert.equal(parseProductInput({ boxContent: '2,5' }, true), null);
});

test('Solo reenvía errores por campo conocidos', () => {
  assert.deepEqual(
    parseFieldErrors({ errors: { name: 'Repetido', password: 'x', sku: 1 } }),
    { name: 'Repetido' },
  );
  assert.equal(parseFieldErrors({ message: 'x' }), null);
});

test('Filtra y agrupa por sección en el orden de la plantilla', () => {
  const bebida: Product = {
    ...fajita,
    id: other,
    name: 'Lata Fanta Zero',
    alternativeNames: [],
    section: 'COSTO DE BEBIDAS',
    hasFormat: false,
    isActive: false,
  };
  const all = [bebida, fajita];
  const sections = [
    { name: 'COSTO PROTEÍNAS', position: 45, freeRows: 2 },
    { name: 'COSTO DE BEBIDAS', position: 141, freeRows: 0 },
  ];
  assert.deepEqual(
    groupBySection(all, sections).map((group) => group.section),
    ['COSTO PROTEÍNAS', 'COSTO DE BEBIDAS'],
  );
  const base = {
    search: '',
    section: '',
    status: 'all' as const,
    missingFormat: false,
  };
  assert.deepEqual(
    filterProducts(all, { ...base, search: 'beef' }).map((p) => p.id),
    [id],
  );
  assert.deepEqual(
    filterProducts(all, { ...base, search: 'FANTA' }).map((p) => p.id),
    [other],
  );
  assert.deepEqual(
    filterProducts(all, { ...base, missingFormat: true }).map((p) => p.id),
    [other],
  );
  assert.deepEqual(
    filterProducts(all, { ...base, status: 'active' }).map((p) => p.id),
    [id],
  );
});
