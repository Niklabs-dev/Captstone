import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';

test('Flujo HTTP con Next.js compilado y contrato de backend simulado', async () => {
  const user = {
    id: 'test-user',
    email: 'test@example.cl',
    role: 'ADMINISTRADOR',
    storeId: null,
  };
  let accessToken = 'test-access';
  let refreshToken = 'test-refresh';
  let unavailable = false;
  const backend = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (unavailable) {
      response.writeHead(503);
      response.end('{}');
      return;
    }
    if (request.url === '/auth/me') {
      response.writeHead(
        request.headers.authorization === `Bearer ${accessToken}` ? 200 : 401,
      );
      response.end(
        request.headers.authorization === `Bearer ${accessToken}`
          ? JSON.stringify(user)
          : '{}',
      );
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body: unknown = JSON.parse(raw || '{}');
    const payload = typeof body === 'object' && body !== null ? body : {};
    if (request.url === '/auth/logout') {
      refreshToken = 'revoked';
      response.end('{}');
      return;
    }
    if (
      request.url === '/auth/login' &&
      (!('email' in payload) ||
        payload.email !== user.email ||
        !('password' in payload) ||
        payload.password !== 'test-password')
    ) {
      response.writeHead(401);
      response.end('{}');
      return;
    }
    if (request.url === '/auth/refresh') {
      if (
        !('refreshToken' in payload) ||
        payload.refreshToken !== refreshToken
      ) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      accessToken = 'test-access-rotated';
      refreshToken = 'test-refresh-rotated';
    }
    response.end(
      JSON.stringify({
        accessToken,
        refreshToken,
        expiresIn: 60,
        tokenType: 'Bearer',
        user: { ...user, firstName: 'Test', lastName: 'User' },
      }),
    );
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const address = backend.address();
  assert.ok(address && typeof address !== 'string');
  const origin = 'http://localhost:3119';
  const frontend = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--port', '3119'],
    {
      env: {
        ...process.env,
        BACKEND_INTERNAL_URL: `http://127.0.0.1:${address.port}`,
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
  const cookieJar = new Map<string, string>();
  function acceptCookies(response: Response): undefined {
    for (const header of response.headers.getSetCookie()) {
      const pair = header.split(';')[0];
      const index = pair.indexOf('=');
      cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }
  async function post(path: string, body?: unknown): Promise<Response> {
    return fetch(origin + path, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Cookie: [...cookieJar]
          .map(([key, value]) => `${key}=${value}`)
          .join('; '),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
  }
  try {
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline && frontend.exitCode === null) {
      try {
        const response = await fetch(origin + '/login');
        ready = response.status === 200;
        if (ready) break;
      } catch {
        /* Esperar a que Next.js escuche. */
      }
      await setTimeout(200);
    }
    assert.ok(ready, logs);
    let response = await fetch(origin + '/dashboard', { redirect: 'manual' });
    assert.equal(response.status, 307);
    assert.ok(response.headers.get('location')?.includes('/login'));
    response = await fetch(origin + '/api/auth/login', {
      method: 'POST',
      headers: {
        Origin: 'https://external.example',
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(response.status, 403);
    response = await post('/api/auth/login', {
      email: 10,
      password: 'test-password',
    });
    assert.equal(response.status, 400);
    response = await post('/api/auth/login', {
      email: user.email,
      password: 'wrong',
    });
    assert.equal(response.status, 401);
    response = await post('/api/auth/login', {
      email: user.email,
      password: 'test-password',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: '/dashboard' });
    for (const header of response.headers.getSetCookie()) {
      assert.ok(header.includes('HttpOnly'));
      assert.ok(header.includes('Secure'));
      assert.ok(header.toLowerCase().includes('samesite=lax'));
    }
    acceptCookies(response);
    response = await fetch(origin + '/dashboard', {
      headers: { Cookie: `mf_access=${cookieJar.get('mf_access')}` },
    });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(user.email));
    response = await fetch(origin + '/dashboard', {
      headers: { Cookie: 'mf_access=forged; mf_user={"rol":"ADMINISTRADOR"}' },
      redirect: 'manual',
    });
    assert.equal(response.status, 307);
    response = await post('/api/auth/refresh');
    assert.equal(response.status, 200);
    acceptCookies(response);
    assert.equal(cookieJar.get('mf_access'), 'test-access-rotated');
    response = await post('/api/auth/refresh');
    assert.equal(response.status, 200);
    acceptCookies(response);
    unavailable = true;
    response = await fetch(origin + '/dashboard', {
      headers: { Cookie: `mf_access=${cookieJar.get('mf_access')}` },
      redirect: 'manual',
    });
    assert.equal(response.status, 503);
    response = await post('/api/auth/login', {
      email: user.email,
      password: 'test-password',
    });
    assert.equal(response.status, 502);
    unavailable = false;
    for (const role of [
      'TRABAJADOR',
      'CONTADOR',
      'SUPERVISOR',
      'ADMINISTRADOR',
    ]) {
      user.role = role;
      const home = role === 'TRABAJADOR' ? '/portal' : '/dashboard';
      response = await post('/api/auth/login', {
        email: user.email,
        password: 'test-password',
      });
      assert.deepEqual(await response.json(), { redirectTo: home });
      acceptCookies(response);
      const headers = { Cookie: `mf_access=${cookieJar.get('mf_access')}` };
      for (const path of ['/', '/login']) {
        response = await fetch(origin + path, { headers, redirect: 'manual' });
        assert.equal(response.status, 307);
        assert.equal(
          new URL(response.headers.get('location')!, origin).pathname,
          home,
        );
      }
      response = await fetch(origin + home, { headers, redirect: 'manual' });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes(user.email));
      assert.ok(!html.includes(accessToken));
      if (role === 'TRABAJADOR') {
        assert.ok(html.includes('Portal del Trabajador'));
        for (const path of [
          '/dashboard',
          '/admin/usuarios',
          '/admin/usuarios/crear',
          '/documentos',
          '/propinas',
          '/ventas',
          '/caja',
          '/inventario',
          '/usuarios',
          '/auditoria',
        ]) {
          response = await fetch(origin + path + '?next=https://evil.example', {
            headers,
            redirect: 'manual',
          });
          assert.equal(response.status, 307, path);
          const destination = new URL(
            response.headers.get('location')!,
            origin,
          );
          assert.equal(destination.pathname, '/portal');
          assert.equal(destination.search, '?reason=forbidden');
        }
      } else {
        response = await fetch(origin + '/portal', {
          headers,
          redirect: 'manual',
        });
        assert.equal(response.status, 307);
        assert.ok(
          response.headers
            .get('location')
            ?.endsWith('/dashboard?reason=forbidden'),
        );
      }
      response = await post('/api/auth/refresh');
      assert.deepEqual(await response.json(), { redirectTo: home });
      acceptCookies(response);
    }
    for (const cookie of ['', 'mf_access=forged; mf_role=TRABAJADOR']) {
      response = await fetch(origin + '/portal', {
        headers: { Cookie: cookie },
        redirect: 'manual',
      });
      assert.equal(response.status, 307);
      assert.ok(
        response.headers.get('location')?.includes('/login?reason=session'),
      );
    }
    unavailable = true;
    response = await fetch(origin + '/portal', {
      headers: { Cookie: `mf_access=${cookieJar.get('mf_access')}` },
      redirect: 'manual',
    });
    assert.equal(response.status, 503);
    unavailable = false;
    response = await post('/api/auth/logout');
    assert.equal(response.status, 200);
    acceptCookies(response);
    assert.equal(cookieJar.get('mf_access'), '');
    assert.equal(cookieJar.get('mf_refresh'), '');
    response = await post('/api/auth/refresh');
    assert.equal(response.status, 401);
    console.log(
      'Verificados login, cookies, renovación, logout, acceso falsificado y fallos del backend.',
    );
  } finally {
    frontend.kill();
    backend.close();
    backend.closeAllConnections();
  }
});
