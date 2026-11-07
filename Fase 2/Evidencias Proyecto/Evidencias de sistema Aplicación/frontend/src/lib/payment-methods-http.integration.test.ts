import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { paymentMethodErrorMessage } from './payment-methods';

test(
  'HTTP medios de pago: sesión, rol, origen, filtros, límites y respuestas no confiables',
  { timeout: 120000 },
  async () => {
    const adminId = '65000000-0000-4000-8000-000000000411';
    const methodId = '7a000000-0000-4000-8000-000000000011';
    const method = {
      id: methodId,
      code: 'JUNEB',
      name: 'Junaeb',
      sortOrder: 10,
      isActive: true,
      behavior: 'EXTERNAL_OTHER',
      availableForTips: false,
      createdAt: '2026-11-01T12:00:00Z',
      updatedAt: '2026-11-01T12:00:00Z',
    };
    const adminUser = {
      id: adminId,
      email: 'admin@moi-food.cl',
      firstName: 'Ada',
      lastName: 'Admin',
      isActive: true,
      role: { code: 'ADMINISTRADOR', name: 'Administrador' },
      store: null,
    };
    const createInput = {
      code: 'juneb',
      name: 'Junaeb',
      sortOrder: 10,
      behavior: 'EXTERNAL_OTHER',
      availableForTips: false,
    };
    let mode = '';
    const calls: { path: string; method: string; body: unknown }[] = [];
    const backend = createServer(async (request, response) => {
      response.setHeader('Content-Type', 'application/json');
      const token = request.headers.authorization?.replace('Bearer ', '');
      if (!token || token === 'invalid') {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      if (request.url === '/auth/me') {
        if (token === 'down') {
          response.writeHead(503);
          response.end('{}');
          return;
        }
        response.end(
          JSON.stringify({
            id: adminId,
            email: 'medios@example.test',
            role:
              token === 'admin'
                ? 'ADMINISTRADOR'
                : token === 'worker'
                  ? 'TRABAJADOR'
                  : token === 'accountant'
                    ? 'CONTADOR'
                    : 'SUPERVISOR',
            storeId: null,
          }),
        );
        return;
      }
      if (request.url?.startsWith('/users?isActive=true')) {
        response.end(JSON.stringify([adminUser]));
        return;
      }
      if (!request.url?.startsWith('/payment-methods')) {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      if (mode === 'private-error' || mode === 'conflict') {
        response.writeHead(mode === 'conflict' ? 409 : 500);
        response.end(
          JSON.stringify({ message: 'SQL passwordHash /private/secret' }),
        );
        return;
      }
      if (mode === 'bad-json') {
        response.end('not JSON');
        return;
      }
      if (mode === 'invalid') {
        response.end(JSON.stringify([{ id: 'otro' }]));
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      calls.push({
        path: request.url ?? '',
        method: request.method ?? '',
        body: raw ? (JSON.parse(raw) as unknown) : null,
      });
      const pathname = (request.url ?? '').split('?')[0];
      if (request.method === 'GET') {
        response.end(JSON.stringify([method]));
        return;
      }
      if (request.method === 'PATCH' && pathname.endsWith('/deactivate'))
        response.end(JSON.stringify({ ...method, isActive: false }));
      else if (request.method === 'PATCH')
        response.end(JSON.stringify({ ...method, name: 'Junaeb Empresa' }));
      else response.writeHead(201).end(JSON.stringify(method));
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://localhost:3375';
    const frontend = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '--port', '3375'],
      {
        env: {
          ...process.env,
          BACKEND_INTERNAL_URL: 'http://127.0.0.1:' + address.port,
        },
        stdio: 'pipe',
      },
    );
    let logs = '';
    frontend.stdout.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });
    frontend.stderr.on('data', (chunk: Buffer) => {
      logs += chunk.toString();
    });
    async function send(
      options: {
        token?: string;
        method?: string;
        path?: string;
        query?: string;
        body?: unknown;
        origin?: string;
        raw?: string;
        contentType?: string;
      } = {},
    ): Promise<Response> {
      const method = options.method ?? 'GET';
      return fetch(
        origin +
          '/api/payment-methods' +
          (options.path ?? '') +
          (options.query ?? ''),
        {
          method,
          headers: {
            ...(options.token === ''
              ? {}
              : { Cookie: 'mf_access=' + (options.token ?? 'supervisor') }),
            ...(method !== 'GET'
              ? {
                  Origin: options.origin ?? origin,
                  'Content-Type': options.contentType ?? 'application/json',
                }
              : {}),
          },
          ...(method !== 'GET'
            ? {
                body:
                  options.raw ??
                  JSON.stringify(
                    options.body !== undefined ? options.body : createInput,
                  ),
              }
            : {}),
        },
      );
    }
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (frontend.exitCode !== null) throw new Error(logs);
        try {
          if ((await fetch(origin + '/login')).ok) {
            ready = true;
            break;
          }
        } catch {
          /* El servidor sigue iniciando. */
        }
        await setTimeout(200);
      }
      assert.ok(ready, logs);
      // Consulta: exige sesión y solo administración lista inactivos.
      for (const token of ['', 'invalid'])
        assert.equal((await send({ token })).status, 401);
      assert.equal((await send({ token: 'down' })).status, 503);
      for (const token of ['supervisor', 'worker', 'accountant']) {
        assert.equal((await send({ token })).status, 403, token);
        assert.equal(
          (await send({ token, query: '?isActive=false' })).status,
          403,
          token,
        );
        assert.equal(
          (await send({ token, query: '?isActive=true' })).status,
          200,
          token,
        );
        assert.equal(
          (
            await send({
              token,
              query: '?isActive=true&availableForTips=true',
            })
          ).status,
          200,
          token,
        );
      }
      for (const query of [
        '?otro=x',
        '?isActive=si',
        '?availableForTips=1',
        '?isActive=true&isActive=false',
        '?isActive=true&otro=x',
      ])
        assert.equal((await send({ query })).status, 400, query);
      let result = await send({ token: 'admin' });
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await result.json(), [method]);
      result = await send({ token: 'admin', query: '?isActive=false' });
      assert.equal(result.status, 200);
      assert.equal(
        calls.filter((call) => call.method === 'GET').at(-1)?.path,
        '/payment-methods?isActive=false',
      );
      // Respuestas no confiables nunca se publican.
      for (const value of ['private-error', 'bad-json', 'invalid']) {
        mode = value;
        result = await send({ token: 'admin' });
        assert.equal(result.status, 502, value);
        assert.equal((await result.text()).includes('private'), false);
      }
      mode = '';
      // Mutaciones: origen propio y rol de administración.
      calls.length = 0;
      // Sin cabecera Origin el BFF rechaza antes de tocar el backend.
      result = await fetch(origin + '/api/payment-methods', {
        method: 'POST',
        headers: {
          Cookie: 'mf_access=admin',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createInput),
      });
      assert.equal(result.status, 403);
      for (const token of ['supervisor', 'worker', 'accountant'])
        assert.equal(
          (await send({ token, method: 'POST' })).status,
          403,
          token,
        );
      assert.equal(calls.length, 0);
      result = await send({
        token: 'admin',
        method: 'POST',
        origin: 'https://other.example.test',
      });
      assert.equal(result.status, 403);
      for (const body of [
        null,
        {},
        { ...createInput, id: methodId },
        { ...createInput, isActive: false },
        { ...createInput, extra: true },
        { ...createInput, code: '' },
        { ...createInput, behavior: 'OTRO' },
        { ...createInput, availableForTips: 'true' },
        { ...createInput, sortOrder: -1 },
      ])
        assert.equal(
          (await send({ token: 'admin', method: 'POST', body })).status,
          400,
        );
      assert.equal(
        (await send({ token: 'admin', method: 'POST', raw: '{' })).status,
        400,
      );
      assert.equal(
        (await send({ token: 'admin', method: 'POST', raw: 'x'.repeat(5000) }))
          .status,
        400,
      );
      assert.equal(
        (
          await send({
            token: 'admin',
            method: 'POST',
            contentType: 'text/plain',
          })
        ).status,
        400,
      );
      assert.equal(calls.length, 0);
      result = await send({ token: 'admin', method: 'POST' });
      assert.equal(result.status, 201);
      assert.deepEqual(await result.json(), method);
      // El alta normaliza el código hacia el contrato estable.
      assert.deepEqual(calls.at(-1)?.body, {
        code: 'JUNEB',
        name: 'Junaeb',
        sortOrder: 10,
        behavior: 'EXTERNAL_OTHER',
        availableForTips: false,
      });
      mode = 'conflict';
      result = await send({ token: 'admin', method: 'POST' });
      assert.equal(result.status, 409);
      assert.deepEqual(await result.json(), {
        message: paymentMethodErrorMessage(409),
      });
      mode = '';
      // Edición y cambio de estado: solo administración, con rutas cerradas.
      calls.length = 0;
      for (const token of ['supervisor', 'worker'])
        assert.equal(
          (
            await send({
              token,
              method: 'PATCH',
              path: '/' + methodId,
              body: { name: 'Otro' },
            })
          ).status,
          403,
          token,
        );
      result = await send({
        token: 'admin',
        method: 'PATCH',
        path: '/' + methodId,
        body: { name: 'Junaeb Empresa' },
      });
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), {
        ...method,
        name: 'Junaeb Empresa',
      });
      assert.deepEqual(calls.at(-1)?.path, '/payment-methods/' + methodId);
      assert.deepEqual(calls.at(-1)?.body, { name: 'Junaeb Empresa' });
      result = await send({
        token: 'admin',
        method: 'PATCH',
        path: '/' + methodId,
        body: { code: 'OTRO' },
      });
      assert.equal(result.status, 400);
      result = await send({
        token: 'admin',
        method: 'PATCH',
        path: '/no-es-uuid',
        body: { name: 'x' },
      });
      assert.equal(result.status, 404);
      result = await fetch(
        origin + '/api/payment-methods/' + methodId + '/deactivate',
        {
          method: 'PATCH',
          headers: { Cookie: 'mf_access=admin', Origin: origin },
        },
      );
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { ...method, isActive: false });
      assert.equal(
        calls.at(-1)?.path,
        '/payment-methods/' + methodId + '/deactivate',
      );
      result = await fetch(
        origin + '/api/payment-methods/no-es-uuid/deactivate',
        {
          method: 'PATCH',
          headers: { Cookie: 'mf_access=admin', Origin: origin },
        },
      );
      assert.equal(result.status, 404);
      assert.equal(
        (await send({ method: 'DELETE', token: 'admin' })).status,
        405,
      );
    } finally {
      frontend.kill();
      backend.closeAllConnections();
      await new Promise<undefined>((resolve) =>
        backend.close(() => resolve(undefined)),
      );
    }
  },
);
