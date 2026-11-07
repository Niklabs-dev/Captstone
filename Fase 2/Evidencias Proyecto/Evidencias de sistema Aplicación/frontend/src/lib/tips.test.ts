import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isTipDate, tipBusinessDate, isTipMethodCode, formatClp } from './tips';

test('La fecha acepta días reales y mantiene el contrato calendario del backend', () => {
  for (const date of ['2024-02-29', '2026-10-26', '0100-01-01', '9999-12-31'])
    assert.equal(isTipDate(date), true);
  for (const date of [
    '',
    '2026-02-29',
    '2026-02-30',
    '2026-13-01',
    '2026-01-00',
    '2026-1-1',
    '2026-10-26T00:00:00Z',
    '0099-01-01',
  ])
    assert.equal(isTipDate(date), false);
});
test('El día inicial usa Chile incluso cuando UTC ya cambió de fecha', () => {
  assert.equal(tipBusinessDate(new Date('2026-10-27T01:30:00Z')), '2026-10-26');
  assert.equal(tipBusinessDate(new Date('2026-07-27T03:30:00Z')), '2026-07-26');
});
test('El código de medio del catálogo valida forma básica sin caracteres de control', () => {
  assert.equal(isTipMethodCode('CASH'), true);
  assert.equal(isTipMethodCode('  CASH  '), true);
  assert.equal(isTipMethodCode(''), false);
  assert.equal(isTipMethodCode('   '), false);
  assert.equal(isTipMethodCode('CASH\u0000'), false);
  assert.equal(isTipMethodCode(700), false);
});
test('El formato CLP usa pesos completos sin decimales', () => {
  assert.match(formatClp(12500), /12\.500/);
  assert.match(formatClp(0), /\$\s*0/);
  assert.match(formatClp(-1500), /-1\.500/);
});
