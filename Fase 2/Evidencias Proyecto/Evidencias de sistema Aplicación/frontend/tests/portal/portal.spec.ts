import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { isAuthTokens, isRecord } from '../../src/lib/auth';

const backend = process.env.TEST_PORTAL_BACKEND_URL ?? 'http://localhost:3105';
const storeId = process.env.TEST_PORTAL_STORE_ID;
const adminEmail = process.env.TEST_PORTAL_ADMIN_EMAIL;
const adminPassword = process.env.TEST_PORTAL_ADMIN_PASSWORD;
const password = 'Portal-test-2026!';
type FixtureRole = 'TRABAJADOR' | 'CONTADOR' | 'SUPERVISOR';
const accounts = new Map<FixtureRole, { id: string; email: string }>();
let adminToken = '';

test.beforeAll(async ({ request }) => {
  if (
    process.env.TEST_PORTAL_DISPOSABLE !== 'true' ||
    !storeId ||
    !adminEmail ||
    !adminPassword
  )
    throw new Error(
      'Las pruebas requieren una base desechable y TEST_PORTAL_STORE_ID/ADMIN_EMAIL/ADMIN_PASSWORD.',
    );
  const response = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(response.status()).toBe(200);
  const session: unknown = await response.json();
  if (!isAuthTokens(session)) throw new Error('Respuesta de login inválida.');
  adminToken = session.accessToken;
  for (const role of ['TRABAJADOR', 'CONTADOR', 'SUPERVISOR'] as const) {
    const email = `portal-${role.toLowerCase()}-${randomUUID()}@example.test`;
    const created = await request.post(backend + '/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        email,
        password,
        firstName: 'Prueba',
        lastName: 'Portal',
        roleCode: role,
        ...(role === 'CONTADOR' ? {} : { storeId }),
      },
    });
    expect(created.status()).toBe(201);
    const user: unknown = await created.json();
    if (!isRecord(user) || typeof user.id !== 'string')
      throw new Error('Respuesta de creación inválida.');
    accounts.set(role, { id: user.id, email });
  }
});

test.afterAll(async ({ request }) => {
  for (const account of accounts.values()) {
    const response = await request.patch(
      backend + `/users/${account.id}/deactivate`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(response.status()).toBe(200);
  }
  accounts.clear();
});

async function loginTokens(
  request: APIRequestContext,
  role: FixtureRole,
): Promise<{ accessToken: string; refreshToken: string }> {
  const account = accounts.get(role);
  if (!account) throw new Error('No se creó la cuenta de prueba.');
  const response = await request.post(backend + '/auth/login', {
    data: { email: account.email, password },
  });
  expect(response.status()).toBe(200);
  const data: unknown = await response.json();
  if (!isAuthTokens(data)) throw new Error('Respuesta de login inválida.');
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

test('Login del trabajador, módulos restringidos, renovación y cierre de sesión', async ({
  page,
  request,
}, testInfo) => {
  const account = accounts.get('TRABAJADOR')!;
  const errors: string[] = [];
  const tokens = await loginTokens(request, 'TRABAJADOR');
  const restricted = await request.get(backend + '/users', {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  expect(restricted.status()).toBe(403);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(account.email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/portal$/);
  await expect(
    page.getByRole('heading', { name: 'Portal del Trabajador', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(account.email, { exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole('navigation')).not.toContainText('Usuarios');
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
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
    await expect(page.getByRole('status').first()).toContainText(
      'Te redirigimos aquí',
    );
  }
  for (const path of ['/', '/login']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal$/);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === 'mf_access')?.httpOnly).toBe(
    true,
  );
  await mkdir('test-results/portal', { recursive: true });
  await page.screenshot({
    path: `test-results/portal/${testInfo.project.name}.png`,
    fullPage: true,
  });
  const before = cookies.find((cookie) => cookie.name === 'mf_refresh')?.value;
  await page.getByRole('button', { name: 'Renovar sesión' }).click();
  await expect
    .poll(
      async () =>
        (await page.context().cookies()).find(
          (cookie) => cookie.name === 'mf_refresh',
        )?.value,
    )
    .not.toBe(before);
  await expect(page).toHaveURL(/\/portal$/);
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/portal');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  expect(errors).toEqual([]);
});

test('Los otros roles conservan su dashboard y no entran al portal', async ({
  page,
  request,
  baseURL,
}) => {
  for (const role of ['CONTADOR', 'SUPERVISOR'] as const) {
    await page.context().clearCookies();
    const tokens = await loginTokens(request, role);
    await page.context().addCookies([
      {
        name: 'mf_access',
        value: tokens.accessToken,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'mf_refresh',
        value: tokens.refreshToken,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/portal');
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
    await page.goto('/admin/usuarios');
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  }
  await page.context().clearCookies();
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(adminEmail!);
  await page.getByLabel('Contraseña').fill(adminPassword!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/portal');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
});

test('Sin sesión o con cookies falsas nunca se muestra el portal', async ({
  page,
  baseURL,
}) => {
  await page.goto('/portal');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  await page.context().addCookies([
    { name: 'mf_access', value: 'forged', url: baseURL! },
    { name: 'mf_role', value: 'TRABAJADOR', url: baseURL! },
  ]);
  await page.goto('/portal');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
});
