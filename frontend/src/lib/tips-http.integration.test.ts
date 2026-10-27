import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { tipErrorMessage } from './tips';

test(
  'HTTP propinas: permisos, origen, identidad de sesión, reintentos, respuestas no confiables y errores privados',
  { timeout: 120000 },
  async () => {
    const storeId = '61000000-0000-4000-8000-000000000311';
    const responsibleId = '63000000-0000-4000-8000-000000000311';
    const input = {
      businessDate: '2026-10-26',
      paymentMethod: 'CASH',
      amount: 12500,
    };
    const entry = {
      ...input,
      id: '62000000-0000-4000-8000-000000000311',
      store: { id: storeId, name: 'Centro' },
      responsible: { id: responsibleId, name: 'Camila Supervisora' },
      createdAt: '2026-10-26T12:00:00Z',
      updatedAt: '2026-10-26T12:00:00Z',
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
            id: responsibleId,
            email: 'tips@example.test',
            role:
              token === 'admin'
                ? 'ADMINISTRADOR'
                : token === 'worker'
                  ? 'TRABAJADOR'
                  : token === 'accountant'
                    ? 'CONTADOR'
                    : 'SUPERVISOR',
            storeId: token === 'nostore' ? null : storeId,
          }),
        );
        return;
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      calls.push({
        path: request.url ?? '',
        method: request.method ?? '',
        body: raw ? (JSON.parse(raw) as unknown) : null,
      });
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
      const record = {
        ...entry,
        token: 'private',
        store: { ...entry.store, id: mode === 'foreign' ? entry.id : storeId },
        responsible: {
          ...entry.responsible,
          id: mode === 'responsible' ? entry.id : responsibleId,
        },
        businessDate: mode === 'date' ? '2026-10-25' : input.businessDate,
        amount: mode === 'amount' ? 1 : input.amount,
      };
      if (request.method === 'POST') {
        response.writeHead(mode === 'replay' ? 200 : 201);
        response.end(JSON.stringify(record));
      } else
        response.end(
          JSON.stringify(mode === 'duplicate' ? [record, record] : [record]),
        );
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://localhost:3374';
    const frontend = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '--port', '3374'],
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
          '/api/tips' +
          (options.query ??
            (method === 'GET' ? '?businessDate=2026-10-26' : '')),
        {
          method,
          headers: {
            ...(options.token === ''
              ? {}
              : { Cookie: 'mf_access=' + (options.token ?? 'supervisor') }),
            ...(method === 'POST'
              ? {
                  Origin: options.origin ?? origin,
                  'Content-Type': options.contentType ?? 'application/json',
                }
              : {}),
          },
          ...(method === 'POST'
            ? { body: options.raw ?? JSON.stringify(options.body ?? input) }
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
      for (const token of ['', 'invalid'])
        assert.equal((await send({ token })).status, 401);
      for (const token of ['admin', 'worker', 'accountant', 'nostore']) {
        assert.equal((await send({ token })).status, 403);
        assert.equal((await send({ token, method: 'POST' })).status, 403);
      }
      assert.equal((await send({ token: 'down' })).status, 503);
      assert.equal(calls.length, 0);
      for (const query of [
        '?storeId=' + storeId + '&businessDate=2026-10-26',
        '?businessDate=2026-10-26&businessDate=2026-10-25',
        '?businessDate=2026-02-30',
        '?businessDate=',
        '',
      ])
        assert.equal((await send({ query })).status, 400);
      for (const body of [
        { ...input, storeId },
        { ...input, responsibleId },
        { ...input, amount: -1 },
        { ...input, amount: '12' },
        { ...input, amount: 1.5 },
        {},
      ])
        assert.equal((await send({ method: 'POST', body })).status, 400);
      assert.equal(
        (await send({ method: 'POST', origin: 'https://other.example.test' }))
          .status,
        403,
      );
      assert.equal((await send({ method: 'POST', raw: '{' })).status, 400);
      assert.equal(
        (await send({ method: 'POST', raw: 'x'.repeat(5000) })).status,
        400,
      );
      assert.equal(
        (await send({ method: 'POST', contentType: 'text/plain' })).status,
        400,
      );
      assert.equal(
        (await send({ method: 'POST', query: '?storeId=' + storeId })).status,
        400,
      );
      assert.equal(calls.length, 0);
      let result = await send();
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
      assert.deepEqual(await result.json(), [entry]);
      assert.equal(
        calls[0].path,
        '/tips?storeId=' + storeId + '&businessDate=2026-10-26',
      );
      result = await send({ method: 'POST' });
      assert.equal(result.status, 201);
      assert.deepEqual(await result.json(), entry);
      assert.deepEqual(calls.at(-1)?.body, { ...input, storeId });
      mode = 'replay';
      assert.equal((await send({ method: 'POST' })).status, 200);
      mode = 'conflict';
      result = await send({ method: 'POST' });
      assert.equal(result.status, 409);
      assert.deepEqual(await result.json(), { message: tipErrorMessage(409) });
      for (const value of [
        'foreign',
        'date',
        'duplicate',
        'private-error',
        'bad-json',
      ]) {
        mode = value;
        result = await send();
        assert.equal(result.status, 502, value);
        assert.equal((await result.text()).includes('private'), false);
      }
      for (const value of [
        'foreign',
        'date',
        'amount',
        'responsible',
        'bad-json',
      ]) {
        mode = value;
        assert.equal((await send({ method: 'POST' })).status, 502, value);
      }
      assert.equal((await send({ method: 'PATCH' })).status, 405);
    } finally {
      frontend.kill();
      backend.closeAllConnections();
      await new Promise<undefined>((resolve) =>
        backend.close(() => resolve(undefined)),
      );
    }
  },
);
