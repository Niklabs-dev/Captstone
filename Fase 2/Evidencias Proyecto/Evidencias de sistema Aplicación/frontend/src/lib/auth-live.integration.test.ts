import assert from 'node:assert/strict';
import { test } from 'node:test';

const origin = process.env.TEST_FRONTEND_URL;
const email = process.env.TEST_AUTH_EMAIL;
const password = process.env.TEST_AUTH_PASSWORD;

test(
  'Login, renovación y logout con frontend, NestJS y PostgreSQL reales',
  {
    skip: !origin || !email || !password,
  },
  async () => {
    assert.ok(origin && email && password);
    const frontendOrigin: string = origin;
    const cookies = new Map<string, string>();
    function acceptCookies(response: Response): undefined {
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0];
        const index = pair.indexOf('=');
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
    function cookieHeader(): string {
      return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    }
    async function post(path: string, body?: unknown): Promise<Response> {
      return fetch(origin + path, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          Origin: frontendOrigin,
          'Content-Type': 'application/json',
          Cookie: cookieHeader(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }

    let response = await fetch(origin + '/dashboard', { redirect: 'manual' });
    assert.equal(response.status, 307);
    response = await post('/api/auth/login', {
      email,
      password: 'incorrect-test-password',
    });
    assert.equal(response.status, 401);
    response = await post('/api/auth/login', { email, password });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { redirectTo: '/dashboard' });
    assert.equal(response.headers.getSetCookie().length, 2);
    for (const header of response.headers.getSetCookie()) {
      assert.ok(header.includes('HttpOnly'));
      assert.ok(header.includes('Secure'));
      assert.ok(header.toLowerCase().includes('samesite=lax'));
    }
    acceptCookies(response);
    response = await fetch(origin + '/dashboard', {
      headers: { Cookie: cookieHeader() },
    });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(email));
    response = await fetch(origin + '/dashboard', {
      headers: {
        Cookie: 'mf_access=forged-token; mf_user={"rol":"ADMINISTRADOR"}',
      },
      redirect: 'manual',
    });
    assert.equal(response.status, 307);
    const previousRefresh = cookies.get('mf_refresh');
    response = await post('/api/auth/refresh');
    assert.equal(response.status, 200);
    acceptCookies(response);
    assert.notEqual(cookies.get('mf_refresh'), previousRefresh);
    response = await fetch(origin + '/api/auth/refresh', {
      method: 'POST',
      headers: { Origin: origin, Cookie: `mf_refresh=${previousRefresh}` },
    });
    assert.equal(response.status, 401);
    response = await fetch(origin + '/api/auth/logout', {
      method: 'POST',
      headers: { Origin: 'https://external.example', Cookie: cookieHeader() },
    });
    assert.equal(response.status, 403);
    response = await post('/api/auth/logout');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, revoked: true });
    acceptCookies(response);
    assert.equal(cookies.get('mf_access'), '');
    assert.equal(cookies.get('mf_refresh'), '');
    response = await fetch(origin + '/dashboard', {
      headers: { Cookie: cookieHeader() },
      redirect: 'manual',
    });
    assert.equal(response.status, 307);
  },
);
