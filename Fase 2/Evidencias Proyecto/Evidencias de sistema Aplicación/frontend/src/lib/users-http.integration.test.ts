import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
test(
  'HTTP: RBAC, CSRF, creación, listado, desactivación y errores del backend',
  { timeout: 60000 },
  async () => {
    const adminId = '10000000-0000-4000-8000-000000000001';
    const userId = '10000000-0000-4000-8000-000000000002';
    const managed = {
      id: userId,
      firstName: 'Ana',
      lastName: 'Prueba',
      email: 'ana@example.test',
      role: { code: 'CONTADOR', name: 'Contador' },
      store: null,
      isActive: true,
    };
    const administrator = {
      ...managed,
      id: adminId,
      role: { code: 'ADMINISTRADOR', name: 'Administrador' },
      email: 'admin@example.test',
    };
    let unavailable = false;
    let malformed = false;
    let conflict = false;
    let mutations = 0;
    const backend = createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (unavailable) {
        res.writeHead(500);
        res.end('{"message":"private error"}');
        return;
      }
      const token = req.headers.authorization;
      if (token !== 'Bearer admin-token' && token !== 'Bearer worker-token') {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      if (req.url === '/auth/me') {
        res.end(
          JSON.stringify({
            id: adminId,
            email: 'admin@example.test',
            role:
              token === 'Bearer admin-token' ? 'ADMINISTRADOR' : 'TRABAJADOR',
          }),
        );
        return;
      }
      if (req.method === 'GET') {
        res.end(
          JSON.stringify(
            malformed
              ? { unexpected: true }
              : [administrator, { ...managed, passwordHash: 'not-public' }],
          ),
        );
        return;
      }
      mutations++;
      if (conflict) {
        res.writeHead(409);
        res.end('{}');
        return;
      }
      if (req.method === 'PATCH') managed.isActive = false;
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += String(chunk);
        const data: unknown = JSON.parse(body);
        assert.ok(data && typeof data === 'object' && 'password' in data);
        res.writeHead(201);
      }
      res.end(JSON.stringify(managed));
    });
    backend.listen(0, '127.0.0.1');
    await once(backend, 'listening');
    const address = backend.address();
    assert.ok(address && typeof address !== 'string');
    const origin = 'http://localhost:3129';
    const frontend = spawn(
      process.execPath,
      ['node_modules/next/dist/bin/next', 'start', '--port', '3129'],
      {
        env: {
          ...process.env,
          BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
          USER_MANAGEMENT_STORES: '[]',
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
      path: string,
      method = 'GET',
      token = 'admin-token',
      body?: unknown,
      requestOrigin = origin,
    ): Promise<Response> {
      return fetch(origin + path, {
        method,
        redirect: 'manual',
        headers: {
          Cookie: `mf_access=${token}`,
          Origin: requestOrigin,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    const input = {
      firstName: 'Ana',
      lastName: 'Prueba',
      email: managed.email,
      password: 'TestPassword123',
      roleCode: 'CONTADOR',
    };
    try {
      const deadline = Date.now() + 30000;
      let ready = false;
      while (Date.now() < deadline && frontend.exitCode === null) {
        try {
          ready = (await send('/api/users')).status === 200;
          if (ready) break;
        } catch {
          /* Esperar el servidor. */
        }
        await setTimeout(100);
      }
      assert.ok(ready, logs);
      const anonymousPage = await send('/admin/usuarios', 'GET', '');
      assert.equal(anonymousPage.status, 307);
      assert.ok(
        anonymousPage.headers
          .get('location')
          ?.includes('/login?reason=session'),
      );
      const workerPage = await send('/admin/usuarios', 'GET', 'worker-token');
      assert.equal(workerPage.status, 307);
      assert.ok(
        workerPage.headers
          .get('location')
          ?.includes('/dashboard?reason=forbidden'),
      );
      assert.equal((await send('/api/users', 'GET', 'fake-token')).status, 401);
      for (const method of ['GET', 'POST'])
        assert.equal(
          (
            await send(
              '/api/users',
              method,
              'worker-token',
              method === 'POST' ? input : undefined,
            )
          ).status,
          403,
        );
      assert.equal(
        (
          await send(
            '/api/users',
            'POST',
            'admin-token',
            input,
            'https://evil.test',
          )
        ).status,
        403,
      );
      assert.equal(
        (await send('/api/users', 'POST', 'admin-token', {})).status,
        400,
      );
      assert.equal(
        (await send(`/api/users/${adminId}/deactivate`, 'PATCH')).status,
        400,
      );
      assert.equal(
        (await send('/api/users/bad/deactivate', 'PATCH')).status,
        400,
      );
      assert.equal((await send('/api/users?roleCode=OWNER')).status, 400);
      assert.equal(mutations, 0);
      const created = await send('/api/users', 'POST', 'admin-token', input);
      assert.equal(created.status, 201);
      assert.deepEqual(await created.json(), managed);
      const listed = await send('/api/users?isActive=true');
      assert.equal(listed.status, 200);
      assert.equal(listed.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await listed.json(), [administrator, managed]);
      const page = await send('/admin/usuarios');
      assert.equal(page.status, 200);
      const html = await page.text();
      assert.ok(html.includes('Usuarios del sistema'));
      assert.ok(!html.includes('passwordHash'));
      assert.ok(!html.includes('admin-token'));
      conflict = true;
      assert.equal(
        (await send('/api/users', 'POST', 'admin-token', input)).status,
        409,
      );
      conflict = false;
      assert.equal(
        (await send(`/api/users/${userId}/deactivate`, 'PATCH', 'worker-token'))
          .status,
        403,
      );
      assert.equal(
        (
          await send(
            `/api/users/${userId}/deactivate`,
            'PATCH',
            'admin-token',
            undefined,
            'https://evil.test',
          )
        ).status,
        403,
      );
      const deactivated = await send(
        `/api/users/${userId}/deactivate`,
        'PATCH',
      );
      assert.equal(deactivated.status, 200);
      assert.deepEqual(await deactivated.json(), {
        ...managed,
        isActive: false,
      });
      malformed = true;
      assert.equal((await send('/api/users')).status, 502);
      malformed = false;
      unavailable = true;
      const down = await send('/api/users');
      assert.equal(down.status, 502);
      assert.ok(!(await down.text()).includes('private error'));
    } finally {
      if (frontend.exitCode === null) {
        frontend.kill();
        await once(frontend, 'exit');
      }
      backend.closeAllConnections();
      await new Promise<undefined>((resolve) => {
        backend.close(() => resolve(undefined));
      });
    }
  },
);
