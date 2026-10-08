import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test, expect, type APIRequestContext } from '@playwright/test';
import { isAuthTokens, isRecord } from '../../src/lib/auth';

const backend = process.env.TEST_AUDIT_BACKEND_URL ?? 'http://localhost:3107';
const storeId = process.env.TEST_AUDIT_STORE_ID;
const otherStoreId = process.env.TEST_AUDIT_OTHER_STORE_ID;
const adminEmail = process.env.TEST_AUDIT_ADMIN_EMAIL;
const adminPassword = process.env.TEST_AUDIT_ADMIN_PASSWORD;
const password = 'Audit-test-2026!';
type FixtureRole = 'TRABAJADOR' | 'CONTADOR' | 'SUPERVISOR' | 'ADMINISTRADOR';
const accounts = new Map<FixtureRole, { id: string; email: string }>();
let adminToken = '';
const adminHeaders = (): { Authorization: string } => ({
  Authorization: `Bearer ${adminToken}`,
});

test.beforeAll(async ({ request }) => {
  if (
    process.env.TEST_AUDIT_DISPOSABLE !== 'true' ||
    !storeId ||
    !otherStoreId ||
    !adminEmail ||
    !adminPassword
  )
    throw new Error(
      'Se requiere el entorno Docker exclusivo y las credenciales de su seed.',
    );
  const response = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(response.status()).toBe(200);
  const session: unknown = await response.json();
  if (!isAuthTokens(session)) throw new Error('Respuesta de login inválida.');
  adminToken = session.accessToken;
  for (const role of [
    'TRABAJADOR',
    'CONTADOR',
    'SUPERVISOR',
    'ADMINISTRADOR',
  ] as const) {
    const email = `audit-${role.toLowerCase()}-${randomUUID()}@example.test`;
    const created = await request.post(backend + '/users', {
      headers: adminHeaders(),
      data: {
        email,
        password,
        firstName: 'Prueba',
        lastName: 'Auditoría',
        roleCode: role,
        ...(['TRABAJADOR', 'SUPERVISOR'].includes(role) ? { storeId } : {}),
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
  for (const [role, account] of accounts) {
    if (role === 'ADMINISTRADOR') continue; // El escenario de desactivación ya la desactiva.
    const response = await request.patch(
      backend + `/users/${account.id}/deactivate`,
      { headers: adminHeaders() },
    );
    expect(response.status()).toBe(200);
  }
  // Si falla un escenario antes de desactivar la cuenta, también se limpia aquí.
  const administrator = accounts.get('ADMINISTRADOR');
  if (administrator) {
    const response = await request.patch(
      backend + `/users/${administrator.id}/deactivate`,
      { headers: adminHeaders() },
    );
    expect(response.status()).toBe(200);
  }
  accounts.clear();
});
async function tokensFor(
  request: APIRequestContext,
  role: FixtureRole,
): Promise<{ accessToken: string; refreshToken: string }> {
  const account = accounts.get(role);
  if (!account) throw new Error('Falta la cuenta ficticia.');
  const response = await request.post(backend + '/auth/login', {
    data: { email: account.email, password },
  });
  expect(response.status()).toBe(200);
  const data: unknown = await response.json();
  if (!isAuthTokens(data)) throw new Error('Respuesta de login inválida.');
  return { accessToken: data.accessToken, refreshToken: data.refreshToken };
}

test('Admin consulta, filtra por local y día chileno, pagina y limpia los filtros', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(adminEmail!);
  await page.getByLabel('Contraseña').fill(adminPassword!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('link', { name: 'Consultar auditoría' }).click();
  await expect(
    page.getByRole('heading', { name: 'Auditoría del sistema' }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Local', exact: true })
    .selectOption(storeId!);
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-05');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-10-05');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByText('1–25 de 32 registros', { exact: true }),
  ).toBeVisible();
  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(26);
  await expect(table).toContainText('AUDIT_T16_BOUNDARY_END');
  await expect(table).toContainText('23:59:59');
  await expect(table).not.toContainText('AUDIT_T16_BEFORE');
  await expect(table).not.toContainText('AUDIT_T16_AFTER');
  await expect(table).not.toContainText('AUDIT_T16_OTHER_STORE');
  await expect(table).not.toContainText('AUDIT_T16_GLOBAL');
  await expect(table).toContainText('Sin usuario identificado');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  await mkdir('test-results/audit', { recursive: true });
  await page.screenshot({
    path: `test-results/audit/${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Siguiente', exact: true }).click();
  await expect(
    page.getByText('26–32 de 32 registros', { exact: true }),
  ).toBeVisible();
  await expect(table).toContainText('AUDIT_T16_BOUNDARY_START');
  await expect(table).toContainText('00:00:00');
  const url = new URL(page.url());
  expect(url.searchParams.get('storeId')).toBe(storeId);
  expect(url.searchParams.get('from')).toBe('2026-10-05');
  expect(url.searchParams.get('to')).toBe('2026-10-05');
  expect(url.searchParams.get('offset')).toBe('25');
  await page.getByRole('link', { name: 'Anterior', exact: true }).click();
  await expect(
    page.getByText('1–25 de 32 registros', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Local', exact: true })
    .selectOption(otherStoreId!);
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByText('1–1 de 1 registros', { exact: true }),
  ).toBeVisible();
  await expect(table).toContainText('AUDIT_T16_OTHER_STORE');
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/auditoria\??$/);
  await expect(
    page.getByRole('combobox', { name: 'Local', exact: true }),
  ).toHaveValue('');
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveValue('');
  // Limpiar también debe borrar una edición que todavía no se aplicó.
  await page
    .getByRole('combobox', { name: 'Local', exact: true })
    .selectOption(storeId!);
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-05');
  await page.getByRole('button', { name: 'Limpiar', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Local', exact: true }),
  ).toHaveValue('');
  await expect(page.getByLabel('Desde', { exact: true })).toHaveValue('');
  expect(new URL(page.url()).search).toBe('');
  expect(errors).toEqual([]);
});

test('Rango inválido, resultados vacíos y endpoint estrictamente de lectura', async ({
  page,
  baseURL,
}) => {
  await page.context().addCookies([
    {
      name: 'mf_access',
      value: adminToken,
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto('/admin/auditoria');
  await page.getByLabel('Desde', { exact: true }).fill('2026-10-06');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-10-05');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'La fecha inicial no puede ser posterior',
  );
  await expect(page.getByRole('table')).toHaveCount(0);
  await page.goto('/admin/auditoria?from=2020-01-01&to=2020-01-01');
  await expect(
    page.getByRole('heading', { name: 'No hay registros para esta consulta' }),
  ).toBeVisible();
  await expect(
    page.getByText('0–0 de 0 registros', { exact: true }),
  ).toBeVisible();
  const api = page.context().request;
  const invalid = await api.get('/api/audit-logs?from=2026-02-30');
  expect(invalid.status()).toBe(400);
  const response = await api.get(
    '/api/audit-logs?storeId=' +
      otherStoreId +
      '&from=2026-10-05&to=2026-10-05',
  );
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  const data: unknown = await response.json();
  expect(JSON.stringify(data)).not.toContain('detail');
  expect(JSON.stringify(data)).not.toContain('ipAddress');
  expect(JSON.stringify(data)).not.toContain('userAgent');
  expect(JSON.stringify(data)).not.toContain(adminToken);
  expect((await api.post('/api/audit-logs')).status()).toBe(405);
  expect((await api.delete('/api/audit-logs')).status()).toBe(405);
  await expect(
    page.getByRole('button', { name: /Editar|Eliminar/ }),
  ).toHaveCount(0);
});

test('Trabajador, supervisor y contador no acceden a página ni API de auditoría', async ({
  page,
  request,
  baseURL,
}) => {
  for (const role of ['TRABAJADOR', 'SUPERVISOR', 'CONTADOR'] as const) {
    await page.context().clearCookies();
    const tokens = await tokensFor(request, role);
    await page.context().addCookies([
      {
        name: 'mf_access',
        value: tokens.accessToken,
        url: baseURL!,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const response = await page.context().request.get('/api/audit-logs');
    expect(response.status()).toBe(403);
    await page.goto('/admin/auditoria');
    await expect(page).toHaveURL(
      role === 'TRABAJADOR'
        ? /\/portal\?reason=forbidden$/
        : /\/dashboard\?reason=forbidden$/,
    );
    await expect(
      page.getByRole('heading', { name: 'Auditoría del sistema' }),
    ).toHaveCount(0);
    expect(
      (
        await request.get(backend + '/audit-logs', {
          headers: { Authorization: `Bearer ${tokens.accessToken}` },
        })
      ).status(),
    ).toBe(403);
  }
});

test('Cuenta administradora desactivada pierde acceso aunque conserve un JWT válido', async ({
  page,
  request,
  baseURL,
}) => {
  const account = accounts.get('ADMINISTRADOR')!;
  const tokens = await tokensFor(request, 'ADMINISTRADOR');
  await page.context().addCookies([
    {
      name: 'mf_access',
      value: tokens.accessToken,
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  expect((await page.context().request.get('/api/audit-logs')).status()).toBe(
    200,
  );
  expect(
    (
      await request.patch(backend + `/users/${account.id}/deactivate`, {
        headers: adminHeaders(),
      })
    ).status(),
  ).toBe(200);
  const response = await page.context().request.get('/api/audit-logs');
  expect(response.status()).toBe(401);
  await page.goto('/admin/auditoria');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
});

test('Sesión ausente o falsificada nunca entrega registros', async ({
  page,
  baseURL,
}) => {
  expect((await page.context().request.get('/api/audit-logs')).status()).toBe(
    401,
  );
  await page.goto('/admin/auditoria');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  await page.context().addCookies([
    { name: 'mf_access', value: 'forged', url: baseURL! },
    { name: 'mf_role', value: 'ADMINISTRADOR', url: baseURL! },
  ]);
  expect((await page.context().request.get('/api/audit-logs')).status()).toBe(
    401,
  );
  await page.goto('/admin/auditoria');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
});
