import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const backend =
  process.env.TEST_NAVIGATION_BACKEND_URL ?? 'http://127.0.0.1:3001';
const adminEmail = process.env.TEST_NAVIGATION_ADMIN_EMAIL;
const adminPassword = process.env.TEST_NAVIGATION_ADMIN_PASSWORD;
const storeId = process.env.TEST_NAVIGATION_STORE_ID;
const password = 'Navigation-test-2026!';
const accounts = new Map<string, { id: string; email: string }>();
let adminToken = '';
const routes = [
  { href: '/dashboard', label: 'Inicio', title: 'Inicio' },
  { href: '/admin/usuarios', label: 'Usuarios', title: 'Usuarios y roles' },
  {
    href: '/admin/auditoria',
    label: 'Auditoría',
    title: 'Auditoría del sistema',
  },
];

async function login(
  page: Page,
  email: string,
  accountPassword: string,
): Promise<undefined> {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill(email);
  await page
    .getByRole('textbox', { name: 'Contraseña', exact: true })
    .fill(accountPassword);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page).toHaveURL(/\/(dashboard|portal)$/);
}

test.beforeAll(async ({ request }) => {
  if (
    process.env.TEST_NAVIGATION_DISPOSABLE !== 'true' ||
    !adminEmail ||
    !adminPassword ||
    !storeId
  )
    throw new Error(
      'Se requiere entorno Docker exclusivo, local ficticio y credenciales del seed.',
    );
  const response = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(response.status()).toBe(200);
  const session: unknown = await response.json();
  if (
    typeof session !== 'object' ||
    session === null ||
    !('accessToken' in session) ||
    typeof session.accessToken !== 'string'
  )
    throw new Error('Login sin token válido.');
  adminToken = session.accessToken;
  for (const role of ['TRABAJADOR', 'SUPERVISOR', 'CONTADOR']) {
    const email = `navigation-${role.toLowerCase()}-${randomUUID()}@example.test`;
    const created = await request.post(backend + '/users', {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        email,
        password,
        firstName: 'Prueba',
        lastName: 'Navegación',
        roleCode: role,
        ...(role === 'CONTADOR' ? {} : { storeId }),
      },
    });
    expect(created.status()).toBe(201);
    const user: unknown = await created.json();
    if (
      typeof user !== 'object' ||
      user === null ||
      !('id' in user) ||
      typeof user.id !== 'string'
    )
      throw new Error('Alta sin identificador válido.');
    accounts.set(role, { id: user.id, email });
  }
});

test.afterAll(async ({ request }) => {
  for (const account of accounts.values()) {
    const response = await request.patch(
      `${backend}/users/${account.id}/deactivate`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    expect(response.status()).toBe(200);
  }
  accounts.clear();
});

test('El administrador recorre las tres vistas con el mismo menú y un solo enlace activo', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await login(page, adminEmail!, adminPassword!);
  const folder = `output/playwright/navigation/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  for (const route of [...routes, routes[0]]) {
    const nav = page.getByRole('navigation', {
      name: 'Navegación principal',
      exact: true,
    });
    await nav.getByRole('link', { name: route.label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(route.href + '$'));
    await expect(
      page.getByRole('heading', { level: 1, name: route.title, exact: true }),
    ).toBeVisible();
    await expect(nav.getByRole('link')).toHaveText(
      routes.map((item) => item.label),
    );
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(
      nav.getByRole('link', { name: route.label, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(
      page.getByText(adminEmail!, { exact: true }).first(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${folder}/${route.label === 'Inicio' ? 'inicio' : route.label === 'Usuarios' ? 'usuarios' : 'auditoria'}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

for (const route of routes) {
  test(`La sesión se cierra desde ${route.label} y se protege la página al volver`, async ({
    page,
    context,
  }) => {
    await login(page, adminEmail!, adminPassword!);
    await page.goto(route.href);
    await page.getByText('Mi sesión', { exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole('button', { name: 'Cerrar sesión', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    expect(
      (await context.cookies()).filter((cookie) =>
        ['mf_access', 'mf_refresh'].includes(cookie.name),
      ),
    ).toEqual([]);
    await page.goto(route.href);
    await expect(page).toHaveURL(/\/login\?reason=session$/);
  });
}

for (const role of ['TRABAJADOR', 'SUPERVISOR', 'CONTADOR']) {
  test(`${role} conserva su inicio y no recibe enlaces administrativos`, async ({
    page,
  }) => {
    const account = accounts.get(role);
    if (!account) throw new Error('Falta la cuenta de prueba.');
    await login(page, account.email, password);
    const home = role === 'TRABAJADOR' ? '/portal' : '/dashboard';
    const nav = page.getByRole('navigation', {
      name: 'Navegación principal',
      exact: true,
    });
    await expect(nav.getByRole('link')).toHaveText(['Inicio']);
    await expect(nav.getByRole('link')).toHaveAttribute('href', home);
    await page.goto('/admin/auditoria');
    await expect(page).toHaveURL(new RegExp(home + '\\?reason=forbidden$'));
    expect((await page.request.get('/api/audit-logs')).status()).toBe(403);
    await page.goto('/admin/usuarios');
    await expect(page).toHaveURL(new RegExp(home + '\\?reason=forbidden$'));
    expect((await page.request.get('/api/users')).status()).toBe(403);
    await expect(nav.getByRole('link')).toHaveText(['Inicio']);
    await page.getByText('Mi sesión', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Renovar sesión', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(home + '$'));
    await expect(nav.getByRole('link')).toHaveText(['Inicio']);
  });
}

test('Renovar desde Usuarios vuelve a Inicio con la misma navegación', async ({
  page,
  context,
}) => {
  await login(page, adminEmail!, adminPassword!);
  const before = (await context.cookies()).find(
    (cookie) => cookie.name === 'mf_refresh',
  )?.value;
  await page.goto('/admin/usuarios');
  await page.getByText('Mi sesión', { exact: true }).click();
  await page
    .getByRole('button', { name: 'Renovar sesión', exact: true })
    .click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect
    .poll(
      async () =>
        (await context.cookies()).find((cookie) => cookie.name === 'mf_refresh')
          ?.value,
    )
    .not.toBe(before);
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link'),
  ).toHaveText(routes.map((item) => item.label));
});
