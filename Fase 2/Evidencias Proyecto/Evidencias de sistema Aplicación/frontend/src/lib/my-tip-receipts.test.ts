import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  canReadOwnTipReceipts,
  ownReceiptPath,
  parseOwnReceipts,
  verifyReceiptBytes,
  MAX_RECEIPT_BYTES,
} from './my-tip-receipts';
import {
  loadOwnReceipts,
  OwnReceiptError,
  downloadOwnReceipt,
} from './my-tip-receipts-client';
import { ROLES } from './auth';
const id = 'a9000000-0000-4000-8000-000000000001';
const other = 'a9000000-0000-4000-8000-000000000002';
const receipt = {
  id,
  userId: id,
  status: 'PAID' as const,
  storeName: 'Santa María',
  periodStart: '2026-01-05',
  periodEnd: '2026-01-11',
  hoursWorked: '40.00',
  amount: 15000,
  paymentDate: '2026-01-12',
  paidByName: 'Contador',
  createdAt: '2026-01-12T12:00:00Z',
};
test('El portal de propinas es exclusivo del trabajador', () => {
  for (const role of ROLES)
    assert.equal(canReadOwnTipReceipts(role), role === 'TRABAJADOR');
});
test('La URL no admite identidad ni local elegidos por el cliente', () => {
  assert.equal(ownReceiptPath([], new URLSearchParams()), '/my-tip-receipts');
  assert.equal(
    ownReceiptPath([id, 'download'], new URLSearchParams()),
    '/my-tip-receipts/' + id + '/download',
  );
  for (const q of ['userId=' + other, 'storeId=' + id, 'offset=1'])
    assert.equal(ownReceiptPath([], new URLSearchParams(q)), null);
  assert.equal(ownReceiptPath(['x', 'download'], new URLSearchParams()), null);
  assert.equal(ownReceiptPath([id, 'edit'], new URLSearchParams()), null);
});
test('Se rechaza todo el listado si contiene una constancia ajena o no pagada', () => {
  assert.deepEqual(parseOwnReceipts([receipt], id), [receipt]);
  assert.deepEqual(parseOwnReceipts([], id), []);
  for (const bad of [
    { ...receipt, userId: other },
    { ...receipt, status: 'DRAFT' },
    { ...receipt, status: 'CONFIRMED' },
    { ...receipt, paymentDate: '2026-02-30' },
    { ...receipt, amount: -1 },
    { ...receipt, amount: 1.5 },
    { ...receipt, hoursWorked: 'NaN' },
  ])
    assert.equal(parseOwnReceipts([receipt, bad], id), null);
  assert.equal(parseOwnReceipts([receipt, receipt], id), null);
});
test('La proyección descarta líneas de compañeros y datos internos', () => {
  assert.deepEqual(
    parseOwnReceipts(
      [
        {
          ...receipt,
          detail: { lines: [{ workerName: 'Otra persona' }] },
          passwordHash: 'secret',
        },
      ],
      id,
    ),
    [receipt],
  );
});
test('El hash detecta archivos alterados, contenido ajeno y tamaños inválidos', async () => {
  const bytes = new TextEncoder().encode('%PDF- prueba');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(await verifyReceiptBytes(bytes.buffer, hash), true);
  assert.equal(
    await verifyReceiptBytes(
      new TextEncoder().encode('%PDF- cambio').buffer,
      hash,
    ),
    false,
  );
  assert.equal(await verifyReceiptBytes(bytes.buffer, 'x'), false);
  assert.equal(
    await verifyReceiptBytes(new TextEncoder().encode('<html>').buffer, hash),
    false,
  );
  assert.equal(
    await verifyReceiptBytes(new ArrayBuffer(MAX_RECEIPT_BYTES + 1), hash),
    false,
  );
});
test('El cliente usa una URL sin userId y verifica otra vez el propietario', async (ctx) => {
  const calls: string[] = [];
  ctx.mock.method(globalThis, 'fetch', async (input: unknown) => {
    calls.push(String(input));
    return Response.json([{ ...receipt, userId: other }]);
  });
  await assert.rejects(
    loadOwnReceipts(id, new AbortController().signal),
    (e: unknown) => e instanceof OwnReceiptError && e.status === 502,
  );
  assert.deepEqual(calls, ['/api/my-tip-receipts']);
});
test('La descarga no entrega un blob si el servidor responde un PDF alterado', async (ctx) => {
  ctx.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response('%PDF- corrupto', {
        headers: {
          'Content-Type': 'application/pdf',
          'X-Content-SHA256': '0'.repeat(64),
        },
      }),
  );
  await assert.rejects(
    downloadOwnReceipt(receipt, new AbortController().signal),
    (e: unknown) => e instanceof OwnReceiptError && e.status === 502,
  );
});
test('Los fallos de permiso y servicio no exponen mensajes internos', async (ctx) => {
  ctx.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'SQL secret' }, { status: 403 }),
  );
  await assert.rejects(
    loadOwnReceipts(id, new AbortController().signal),
    (e: unknown) =>
      e instanceof OwnReceiptError &&
      e.status === 403 &&
      !e.message.includes('secret'),
  );
});
