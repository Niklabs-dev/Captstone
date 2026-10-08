import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cookieOptions,
  hasTrustedOrigin,
  isAuthTokens,
  parseCredentials,
} from './auth';
import { requestTokens, verifyAccessToken } from './auth-backend';
const user = {
  id: 'user-id',
  email: 'user@example.cl',
  role: 'ADMINISTRADOR',
  storeId: null,
};
const tokens = {
  accessToken: 'access',
  refreshToken: 'refresh',
  tokenType: 'Bearer',
  expiresIn: 60,
  user: { ...user, firstName: 'Nombre', lastName: 'Apellido' },
};
test('Normaliza el correo sin alterar la contraseña', () => {
  assert.deepEqual(
    parseCredentials({ email: ' USER@EXAMPLE.CL ', password: ' clave ' }),
    { email: 'user@example.cl', password: ' clave ' },
  );
});
test('Rechaza cuerpos inválidos y credenciales vacías', () => {
  for (const input of [
    null,
    [],
    {},
    { email: 4, password: 'pass' },
    { email: 'invalid', password: 'pass' },
    { email: user.email, password: '' },
    { email: user.email, password: 10 },
  ])
    assert.equal(parseCredentials(input), null);
});
test('Rechaza respuestas de autenticación incompletas o con rol desconocido', () => {
  assert.equal(isAuthTokens(tokens), true);
  for (const input of [
    null,
    { ...tokens, accessToken: '' },
    { ...tokens, expiresIn: 0 },
    { ...tokens, expiresIn: 1.5 },
    { ...tokens, user: { ...tokens.user, role: 'OWNER' } },
    { ...tokens, user: user },
  ])
    assert.equal(isAuthTokens(input), false);
});
test('Cookies protegidas contra acceso por JavaScript y con expiración', () => {
  assert.deepEqual(cookieOptions(true, 60), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60,
  });
  assert.equal(cookieOptions(false, 0).maxAge, 0);
});
test('Rechaza solicitudes de otro origen o sin origen', () => {
  assert.equal(
    hasTrustedOrigin(
      new Request('https://moi.example/api/auth/login', {
        headers: { origin: 'https://moi.example' },
      }),
    ),
    true,
  );
  assert.equal(
    hasTrustedOrigin(
      new Request('https://moi.example/api/auth/login', {
        headers: { origin: 'https://external.example' },
      }),
    ),
    false,
  );
  assert.equal(
    hasTrustedOrigin(new Request('https://moi.example/api/auth/login')),
    false,
  );
});

test('Valida el origen público al ejecutarse detrás de Docker o un proxy', () => {
  const headers = { host: 'localhost:3100', origin: 'http://localhost:3100' };
  assert.equal(
    hasTrustedOrigin(
      new Request('http://0.0.0.0:3000/api/auth/login', { headers }),
    ),
    true,
  );
  assert.equal(
    hasTrustedOrigin(
      new Request('http://0.0.0.0:3000/api/auth/login', {
        headers: { ...headers, origin: 'http://external.example' },
      }),
    ),
    false,
  );
  assert.equal(
    hasTrustedOrigin(
      new Request('http://0.0.0.0:3000/api/auth/login', {
        headers: {
          host: 'moi.example',
          origin: 'https://moi.example',
          'x-forwarded-proto': 'https',
        },
      }),
    ),
    true,
  );
  assert.equal(
    hasTrustedOrigin(
      new Request('http://0.0.0.0:3000/api/auth/login', {
        headers: { ...headers, 'x-forwarded-proto': 'javascript' },
      }),
    ),
    false,
  );
});
test('Envía credenciales únicamente al backend y valida su respuesta', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit): Promise<Response> => {
      assert.ok(input.endsWith('/auth/login'));
      assert.equal(options.cache, 'no-store');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(String(options.body)), {
        email: user.email,
        password: 'pass',
      });
      return Response.json(tokens);
    },
  );
  assert.deepEqual(
    await requestTokens('/auth/login', { email: user.email, password: 'pass' }),
    { ok: true, data: tokens },
  );
});
test('Distingue credenciales incorrectas de errores de servidor y limita mensajes', async (context) => {
  for (const [status, expected] of [
    [401, 401],
    [400, 400],
    [429, 429],
    [500, 502],
  ]) {
    context.mock.method(globalThis, 'fetch', async (): Promise<Response> =>
      Response.json({ message: 'Información interna' }, { status }),
    );
    const result = await requestTokens('/auth/login', {
      email: user.email,
      password: 'pass',
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, expected);
      assert.ok(!result.message.includes('Información interna'));
    }
    context.mock.restoreAll();
  }
});
test('No acepta respuestas malformadas del servidor', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (): Promise<Response> => new Response('not-json'),
  );
  const result = await requestTokens('/auth/login', {
    email: user.email,
    password: 'pass',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 502);
});
test('Verifica el JWT con el backend y rechaza tokens falsificados o vencidos', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (_input: string, options: RequestInit): Promise<Response> => {
      assert.deepEqual(options.headers, { Authorization: 'Bearer fake-token' });
      return new Response(null, { status: 401 });
    },
  );
  const result = await verifyAccessToken('fake-token');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 401);
});
test('Devuelve únicamente datos de usuario validados por el backend', async (context) => {
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> =>
    Response.json(user),
  );
  assert.deepEqual(await verifyAccessToken('valid-token'), {
    ok: true,
    data: user,
  });
});
test('Renueva tokens con el token opaco sin enviarlo en la URL', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string, options: RequestInit): Promise<Response> => {
      assert.ok(input.endsWith('/auth/refresh'));
      assert.deepEqual(JSON.parse(String(options.body)), {
        refreshToken: 'previous',
      });
      return Response.json(tokens);
    },
  );
  assert.deepEqual(
    await requestTokens('/auth/refresh', { refreshToken: 'previous' }),
    { ok: true, data: tokens },
  );
});
test('Falla de forma controlada si el backend no responde', async (context) => {
  context.mock.method(globalThis, 'fetch', async (): Promise<Response> => {
    throw new Error('Network error');
  });
  for (const result of [
    await verifyAccessToken('token'),
    await requestTokens('/auth/login', { email: user.email, password: 'pass' }),
  ]) {
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.status, 503);
  }
});
