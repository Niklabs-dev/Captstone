import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { getNavigationItems } from '../../src/lib/navigation';
import { openNavigation, navigateTo } from '../helpers/navigation';

const backend =
  process.env.TEST_NAVIGATION_BACKEND_URL ?? 'http://127.0.0.1:3001';
const adminEmail = process.env.TEST_NAVIGATION_ADMIN_EMAIL;
const adminPassword = process.env.TEST_NAVIGATION_ADMIN_PASSWORD;
const storeId = process.env.TEST_NAVIGATION_STORE_ID;
const password = 'Navigation-test-2026!';
const accounts = new Map<string, { id: string; email: string }>();
let adminToken = '';

test('Diseño compartido: radios, icono decorativo, sesión y recuperación paginada de 44 px', async ({
  page,
}, info) => {
  await login(page, adminEmail!, adminPassword!);
  await openNavigation(page);
  const navigation = page.getByRole('navigation', {
    name: 'Navegación principal',
    exact: true,
  });
  expect(
    await navigation
      .getByRole('link')
      .first()
      .evaluate((element) => getComputedStyle(element).borderRadius),
  ).toBe('8px');
  const toggle = page.getByRole('button', {
    name: 'Menú principal',
    exact: true,
  });
  if (await toggle.isVisible()) {
    await expect(toggle.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await toggle.click();
  }
  const summary = page.getByText('Mi sesión', { exact: true });
  await summary.click();
  const renew = page.getByRole('button', {
    name: 'Renovar sesión',
    exact: true,
  });
  await expect(renew).toBeVisible();
  const styles = await Promise.all(
    [summary, renew].map((control) =>
      control.evaluate((element) => {
        const css = getComputedStyle(element);
        return Object.fromEntries(
          [
            'border-radius',
            'border-width',
            'font-family',
            'font-size',
            'font-weight',
            'min-height',
            'padding',
          ].map((key) => [key, css.getPropertyValue(key)]),
        );
      }),
    ),
  );
  expect(styles[0]).toEqual(styles[1]);
  await renew.focus();
  await page.keyboard.press('Escape');
  await expect(renew).toBeHidden();
  await expect(summary).toBeFocused();
  await summary.click();
  await page.getByRole('heading', { name: 'Inicio', exact: true }).click();
  await expect(renew).toBeHidden();
  await page.goto('/admin/auditoria?from=2020-01-01&to=2020-01-01&offset=20');
  const firstPage = page.getByRole('link', {
    name: 'Volver a la primera página',
    exact: true,
  });
  await expect(firstPage).toBeVisible();
  const rect = await firstPage.boundingBox();
  expect(rect?.height).toBeGreaterThanOrEqual(44);
  expect(rect?.width).toBeGreaterThanOrEqual(44);
  await page.keyboard.press('Tab');
  await firstPage.focus();
  await expect(firstPage).toBeFocused();
  expect(
    await firstPage.evaluate(
      (element) => getComputedStyle(element).outlineWidth,
    ),
  ).toBe('2px');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const folder = 'output/playwright/navigation/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/auditoria-pagina-vacia.png',
    scale: 'css',
  });
  await firstPage.click();
  await expect(firstPage).toHaveCount(0);
  expect(Number(new URL(page.url()).searchParams.get('offset') ?? 0)).toBe(0);
});
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
  const toggle = page.getByRole('button', {
    name: 'Menú principal',
    exact: true,
  });
  if (await toggle.isVisible()) {
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
  }
  const originalNavigation = await page
    .getByRole('navigation', { name: 'Navegación principal', exact: true })
    .elementHandle();
  if (!originalNavigation) throw new Error('Falta la navegación inicial.');
  const folder = `output/playwright/navigation/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  for (const route of [...routes, routes[0]]) {
    const nav = page.getByRole('navigation', {
      name: 'Navegación principal',
      exact: true,
    });
    await navigateTo(page, route.label);
    await expect(page).toHaveURL(new RegExp(route.href + '$'));
    expect(
      await originalNavigation.evaluate((element) => element.isConnected),
    ).toBe(true);
    await expect(
      page.getByRole('heading', { level: 1, name: route.title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name:
          route.label === 'Inicio'
            ? 'Bienvenido al sistema'
            : route.label === 'Usuarios'
              ? 'Usuarios del sistema'
              : 'Registro de operaciones',
        exact: true,
      }),
    ).toBeVisible();
    await openNavigation(page);
    await expect(nav.getByRole('link')).toHaveText(
      getNavigationItems('ADMINISTRADOR').map((item) => item.label),
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

for (const role of ['TRABAJADOR', 'SUPERVISOR', 'CONTADOR'] as const) {
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
    const labels = getNavigationItems(role).map((item) => item.label);
    await openNavigation(page);
    await expect(nav.getByRole('link')).toHaveText(labels);
    await expect(nav.getByRole('link').first()).toHaveAttribute('href', home);
    await page.goto('/admin/auditoria');
    await expect(page).toHaveURL(new RegExp(home + '\\?reason=forbidden$'));
    expect((await page.request.get('/api/audit-logs')).status()).toBe(403);
    await page.goto('/admin/usuarios');
    await expect(page).toHaveURL(new RegExp(home + '\\?reason=forbidden$'));
    expect((await page.request.get('/api/users')).status()).toBe(403);
    await openNavigation(page);
    await expect(nav.getByRole('link')).toHaveText(labels);
    await page.getByText('Mi sesión', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Renovar sesión', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(home + '$'));
    await openNavigation(page);
    await expect(nav.getByRole('link')).toHaveText(labels);
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
  await openNavigation(page);
  await expect(
    page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link'),
  ).toHaveText(getNavigationItems('ADMINISTRADOR').map((item) => item.label));
});

test('Cambiar entre administrador y trabajador no conserva las opciones de la cuenta anterior', async ({
  page,
}) => {
  const worker = accounts.get('TRABAJADOR');
  if (!worker) throw new Error('Falta el trabajador de prueba.');
  await login(page, adminEmail!, adminPassword!);
  for (const identity of [worker.email, adminEmail!]) {
    await page.getByText('Mi sesión', { exact: true }).click();
    await page
      .getByRole('button', { name: 'Cerrar sesión', exact: true })
      .click();
    await expect(page).toHaveURL(/\/login$/);
    await login(
      page,
      identity,
      identity === worker.email ? password : adminPassword!,
    );
    const nav = page.getByRole('navigation', {
      name: 'Navegación principal',
      exact: true,
    });
    await openNavigation(page);
    await expect(nav.getByRole('link')).toHaveText(
      getNavigationItems(
        identity === worker.email ? 'TRABAJADOR' : 'ADMINISTRADOR',
      ).map((item) => item.label),
    );
    await expect(
      page.getByRole('complementary').getByText(identity, { exact: true }),
    ).toBeVisible();
    expect((await page.request.get('/api/users')).status()).toBe(
      identity === worker.email ? 403 : 200,
    );
  }
});
