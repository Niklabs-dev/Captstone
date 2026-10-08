import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

test('Auditoría HTTP: autorización, filtros, paginación, proyección segura y fallos', async () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@example.test',
    role: 'ADMINISTRADOR',
    storeId: null,
  };
  const store = {
    id: '10000000-0000-4000-8000-000000000016',
    name: 'Local de prueba',
  };
  let auditStatus = 200,
    malformed = false,
    active = true,
    role = 'ADMINISTRADOR',
    usersMalformed = false;
  let lastQuery = '';
  const backend = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    const token = request.headers.authorization?.replace('Bearer ', '');
    const roleMap: Record<string, string> = {
      'private-audit-token': 'ADMINISTRADOR',
      worker: 'TRABAJADOR',
      supervisor: 'SUPERVISOR',
      accountant: 'CONTADOR',
    };
    if (!token || !Object.hasOwn(roleMap, token)) {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    if (request.url === '/auth/me') {
      response.end(JSON.stringify({ ...user, role: roleMap[token] }));
      return;
    }
    if (request.url === '/users') {
      response.end(
        JSON.stringify(
          usersMalformed
            ? {}
            : [
                {
                  id: user.id,
                  isActive: active,
                  role: { code: role },
                  store: null,
                },
                {
                  id: store.id,
                  isActive: true,
                  role: { code: 'TRABAJADOR' },
                  store,
                },
              ],
        ),
      );
      return;
    }
    if (request.url?.startsWith('/audit-logs?')) {
      lastQuery = request.url;
      response.writeHead(auditStatus);
      if (auditStatus !== 200) {
        response.end(JSON.stringify({ message: 'internal-secret' }));
        return;
      }
      const params = new URL(request.url, 'http://localhost').searchParams;
      const limit = Number(params.get('limit')),
        offset = Number(params.get('offset'));
      const entries = [1, 2, 3].map((id) => ({
        id: String(id),
        action: 'USER_CREATED',
        entityType: 'users',
        entityId: null,
        createdAt: '2026-10-05T02:30:00.000Z',
        user: {
          id: user.id,
          email: user.email,
          firstName: '<script>evil</script>',
          lastName: 'Prueba',
          phone: 'internal-secret',
        },
        store,
        detail: { password: 'internal-secret' },
        ipAddress: 'internal-secret',
        userAgent: 'internal-secret',
      }));
      response.end(
        JSON.stringify(
          malformed
            ? {}
            : {
                items: entries.slice(offset, offset + limit),
                total: entries.length,
                limit,
                offset,
              },
        ),
      );
      return;
    }
    response.writeHead(404);
    response.end('{}');
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const address = backend.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://localhost:3136';
  const frontend = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--port', '3136'],
    {
      env: {
        ...process.env,
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
        AUDIT_STORES: '[]',
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
  const headers = { Cookie: 'mf_access=private-audit-token' };
  try {
    let ready = false;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && frontend.exitCode === null) {
      try {
        ready = (await fetch(origin + '/login')).status === 200;
        if (ready) break;
      } catch {
        /* Espera de arranque. */
      }
      await setTimeout(200);
    }
    assert.ok(ready, logs);
    for (const cookie of ['', 'mf_access=forged; mf_role=ADMINISTRADOR']) {
      const response = await fetch(origin + '/api/audit-logs', {
        headers: { Cookie: cookie },
      });
      assert.equal(response.status, 401);
      assert.ok(!JSON.stringify(await response.json()).includes('items'));
    }
    for (const token of ['worker', 'supervisor', 'accountant']) {
      let response = await fetch(origin + '/api/audit-logs', {
        headers: { Cookie: 'mf_access=' + token },
      });
      assert.equal(response.status, 403);
      response = await fetch(origin + '/admin/auditoria', {
        headers: { Cookie: 'mf_access=' + token },
        redirect: 'manual',
      });
      assert.equal(response.status, 307);
      assert.ok(
        response.headers
          .get('location')
          ?.includes(
            token === 'worker'
              ? '/portal?reason=forbidden'
              : '/dashboard?reason=forbidden',
          ),
      );
    }
    let response = await fetch(
      origin +
        '/api/audit-logs?storeId=' +
        store.id +
        '&from=2026-10-05&to=2026-10-05&limit=2&offset=1',
      { headers },
    );
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));
    const result: unknown = await response.json();
    assert.ok(JSON.stringify(result).includes('"id":"2"'));
    assert.ok(!JSON.stringify(result).includes('internal-secret'));
    assert.ok(!JSON.stringify(result).includes('private-audit-token'));
    const forwarded = new URL(lastQuery, origin).searchParams;
    assert.equal(forwarded.get('storeId'), store.id);
    assert.equal(forwarded.get('from'), '2026-10-05');
    assert.equal(forwarded.get('to'), '2026-10-05');
    assert.equal(forwarded.get('offset'), '1');
    for (const query of [
      'from=2026-02-30',
      'from=2026-10-06&to=2026-10-05',
      'storeId=bad',
      'limit=201',
      'offset=-1',
      'from=2026-10-01&from=2026-10-02',
      'password=secret',
    ]) {
      response = await fetch(origin + '/api/audit-logs?' + query, { headers });
      assert.equal(response.status, 400, query);
    }
    response = await fetch(origin + '/api/audit-logs', {
      method: 'POST',
      headers,
    });
    assert.equal(response.status, 405);
    response = await fetch(origin + '/admin/auditoria?limit=2', { headers });
    assert.equal(response.status, 200);
    let html = await response.text();
    assert.ok(html.includes('Auditoría del sistema'));
    assert.ok(html.includes('&lt;script&gt;evil&lt;/script&gt;'));
    assert.ok(!html.includes('internal-secret'));
    assert.ok(!html.includes('private-audit-token'));
    assert.ok(html.includes('offset=2'));
    response = await fetch(
      origin + '/admin/auditoria?from=2026-10-06&to=2026-10-05',
      { headers },
    );
    html = await response.text();
    assert.ok(html.includes('La fecha inicial no puede ser posterior'));
    response = await fetch(origin + '/admin/auditoria?offset=25', { headers });
    assert.ok(
      (await response.text()).includes('No hay registros para esta consulta'),
    );
    malformed = true;
    response = await fetch(origin + '/api/audit-logs', { headers });
    assert.equal(response.status, 502);
    malformed = false;
    usersMalformed = true;
    response = await fetch(origin + '/api/audit-logs', { headers });
    assert.equal(response.status, 502);
    usersMalformed = false;
    active = false;
    response = await fetch(origin + '/api/audit-logs', { headers });
    assert.equal(response.status, 401);
    assert.ok(
      response.headers
        .getSetCookie()
        .some((cookie) => cookie.startsWith('mf_access=;')),
    );
    active = true;
    role = 'CONTADOR';
    response = await fetch(origin + '/api/audit-logs', { headers });
    assert.equal(response.status, 403);
    role = 'ADMINISTRADOR';
    auditStatus = 503;
    response = await fetch(origin + '/api/audit-logs', { headers });
    assert.equal(response.status, 502);
    response = await fetch(origin + '/admin/auditoria', { headers });
    html = await response.text();
    assert.ok(html.includes('El servicio no está disponible'));
    assert.ok(!html.includes('internal-secret'));
  } finally {
    frontend.kill();
    backend.close();
    backend.closeAllConnections();
  }
});
