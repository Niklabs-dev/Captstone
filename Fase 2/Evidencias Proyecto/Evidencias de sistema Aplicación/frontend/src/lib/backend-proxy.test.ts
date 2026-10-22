import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isProxyUuid, proxyBackend, readProxyForm } from './backend-proxy';

test('Lee multipart sin Content-Length y rechaza el cuerpo antes de superar el límite', async () => {
  const form = new FormData();
  form.set('period', '2026-09');
  const request = new Request('http://example.test/api/payroll', {
    method: 'POST',
    body: form,
  });
  assert.equal(request.headers.has('Content-Length'), false);
  assert.equal((await readProxyForm(request, 1))?.get('period'), '2026-09');
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024 + 10));
    },
    cancel() {
      cancelled = true;
    },
  });
  const init: RequestInit & { duplex: 'half' } = {
    method: 'POST',
    body: oversized,
    duplex: 'half',
  };
  assert.equal(
    await readProxyForm(
      new Request('http://example.test/api/payroll', init),
      1,
    ),
    null,
  );
  assert.equal(cancelled, true);
});

test('El proxy conserva bearer en servidor, no usa caché y reenvía JSON sin seguir redirecciones', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string, init: RequestInit) => {
      assert.ok(url.endsWith('/dt-alerts'));
      assert.equal(
        new Headers(init.headers).get('Authorization'),
        'Bearer test-only',
      );
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      return Response.json({ items: [] });
    },
  );
  const response = await proxyBackend('/dt-alerts', 'test-only');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { items: [] });
});

test('Preserva conflictos y errores públicos sin filtrar mensajes internos', async (context) => {
  context.mock.method(globalThis, 'fetch', async () =>
    Response.json({ message: 'SQL secreto' }, { status: 409 }),
  );
  const response = await proxyBackend('/payroll/id/publish', 'test-only');
  assert.equal(response.status, 409);
  assert.ok(!(await response.text()).includes('SQL'));
});

test('Reenvía multipart y stream PDF con sus cabeceras de integridad', async (context) => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nPrueba');
  const multipart = new FormData();
  multipart.set(
    'file',
    new File([pdf], 'liquidación septiembre.pdf', { type: 'application/pdf' }),
  );
  context.mock.method(
    globalThis,
    'fetch',
    async (_url: string, init: RequestInit) => {
      assert.equal(init.body, multipart);
      assert.equal(new Headers(init.headers).has('Content-Type'), false);
      return new Response(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(pdf.length),
          'X-Document-Integrity': 'VALID',
        },
      });
    },
  );
  const response = await proxyBackend(
    '/payroll/mine/id/download',
    'test-only',
    { method: 'POST', body: multipart },
    true,
  );
  assert.equal(response.headers.get('X-Document-Integrity'), 'VALID');
  assert.equal(response.headers.get('Content-Length'), String(pdf.length));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), pdf);
});

test('Falla de forma controlada ante red caída, JSON inválido y UUID malformado', async (context) => {
  const mocked = context.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> => {
      throw new Error('red privada');
    },
  );
  assert.equal((await proxyBackend('/dt-alerts', 'test-only')).status, 503);
  mocked.mock.mockImplementation(async () => new Response('invalid'));
  assert.equal((await proxyBackend('/dt-alerts', 'test-only')).status, 502);
  assert.equal(isProxyUuid('../auth'), false);
});
