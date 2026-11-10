import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aliasErrorMessage,
  aliasLabelError,
  aliasesByMethod,
  normalizeAliasLabel,
  parseAliasInput,
  parsePaymentMethodAlias,
  parsePaymentMethodAliases,
  type PaymentMethodAlias,
} from './payment-method-aliases';
import {
  createPaymentMethodAlias,
  loadPaymentMethodAliases,
  PaymentMethodAliasError,
} from './payment-method-aliases-client';

// SPRINT-4A-T20: alias de medios de pago de los informes de MrComanda.
const id = 'a9000000-0000-4000-8000-000000000021';
const cash = 'a9000000-0000-4000-8000-000000000022';
const transfer = 'a9000000-0000-4000-8000-000000000023';
const alias = {
  id,
  system: 'MRCOMANDA',
  label: 'EFECTIVO',
  normalizedLabel: 'EFECTIVO',
  createdAt: '2026-11-10T22:00:00.000Z',
  paymentMethod: { id: cash, code: 'CASH', name: 'Efectivo', isActive: true },
  extra: 'no se reenvía',
};

test('Proyecta el alias sin campos ajenos y rechaza contratos inválidos', () => {
  const parsed = parsePaymentMethodAlias(alias);
  assert.ok(parsed);
  assert.equal('extra' in parsed, false);
  assert.equal(parsed.paymentMethod.name, 'Efectivo');
  assert.equal(parsePaymentMethodAliases([alias])?.length, 1);
  for (const bad of [
    { ...alias, id: 'x' },
    { ...alias, label: '' },
    { ...alias, paymentMethod: { ...alias.paymentMethod, isActive: 'sí' } },
    { ...alias, createdAt: 'ayer' },
  ])
    assert.equal(parsePaymentMethodAlias(bad), null);
  assert.equal(parsePaymentMethodAliases({}), null);
});

test('Normaliza como el backend: sin tildes, mayúsculas y espacios colapsados', () => {
  assert.equal(normalizeAliasLabel('  N.de   Créd.  '), 'N.DE CRED.');
  assert.equal(normalizeAliasLabel('T. débito'), 'T. DEBITO');
  assert.notEqual(normalizeAliasLabel('T DEBITO'), 'T. DEBITO');
});

test('Valida la etiqueta y avisa si ya está asociada a otro medio', () => {
  const existing = parsePaymentMethodAliases([alias]) ?? [];
  assert.match(aliasLabelError('   ', existing) ?? '', /Escribe/);
  assert.match(aliasLabelError('x'.repeat(101), existing) ?? '', /100/);
  assert.match(aliasLabelError(' efectivo ', existing) ?? '', /Efectivo/);
  assert.equal(aliasLabelError('N.de Créd.', existing), null);
});

test('El BFF solo reenvía etiqueta recortada y medio', () => {
  assert.deepEqual(
    parseAliasInput({ label: '  N.de  Créd. ', paymentMethodId: transfer }),
    { label: 'N.de Créd.', paymentMethodId: transfer },
  );
  for (const bad of [
    { label: 'X', paymentMethodId: 'x' },
    { label: '   ', paymentMethodId: transfer },
    { label: 'X'.repeat(101), paymentMethodId: transfer },
    { label: 'X', paymentMethodId: transfer, system: 'OTRO' },
    null,
  ])
    assert.equal(parseAliasInput(bad), null);
});

test('Agrupa los alias por medio', () => {
  const second: PaymentMethodAlias = {
    ...(parsePaymentMethodAlias(alias) as PaymentMethodAlias),
    id: transfer,
    label: 'CONTADO',
  };
  const groups = aliasesByMethod([
    parsePaymentMethodAlias(alias) as PaymentMethodAlias,
    second,
  ]);
  assert.deepEqual(
    groups.get(cash)?.map((item) => item.label),
    ['EFECTIVO', 'CONTADO'],
  );
  assert.equal(groups.get(transfer), undefined);
});

test('El cliente usa mensajes propios y valida la respuesta', async () => {
  const ok = (body: unknown, status = 200): typeof fetch =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status }),
      )) as typeof fetch;
  assert.equal(
    (await loadPaymentMethodAliases(undefined, ok([alias]))).length,
    1,
  );
  await assert.rejects(
    createPaymentMethodAlias(
      { label: 'EFECTIVO', paymentMethodId: transfer },
      ok({ message: 'detalle interno' }, 409),
    ),
    (error: unknown) =>
      error instanceof PaymentMethodAliasError &&
      error.message === aliasErrorMessage(409) &&
      !error.message.includes('interno'),
  );
  await assert.rejects(
    loadPaymentMethodAliases(undefined, ok({ no: 'lista' })),
    (error: unknown) =>
      error instanceof PaymentMethodAliasError && error.status === 502,
  );
  assert.match(aliasErrorMessage(404, 'delete'), /ya no existe/);
});
