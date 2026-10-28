import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';

test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3339';
const password = 'Tips-test-2026!';
const date = '2026-10-26';
let adminToken = '';
let storeId = '';
let otherStoreId = '';
const accounts: { id: string; email: string; role: string }[] = [];
let supervisor: { id: string; email: string };

function id(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
async function login(
  context: BrowserContext,
  baseURL: string,
  email = supervisor.email,
  accountPassword = password,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: accountPassword },
      })
    ).status(),
  ).toBe(200);
}
async function registerDate(page: Page, value = date): Promise<undefined> {
  await page.getByLabel(/Fecha del registro/).fill(value);
  await expect(
    page.getByRole('button', { name: 'Guardar propinas', exact: true }),
  ).toBeEnabled();
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test.beforeAll(async ({ request }, info) => {
  const admin = await request.post(backend + '/auth/login', {
    data: {
      email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
      password:
        process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
    },
  });
  expect(admin.status()).toBe(200);
  const session: unknown = await admin.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string')
    throw Error('Login de prueba inválido.');
  adminToken = session.accessToken;
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID();
  for (const name of ['Centro ', 'Norte ']) {
    const response = await request.post(backend + '/stores', {
      headers,
      data: {
        name: 'Propinas ' + name + suffix,
        city: 'Melipilla',
        address: 'Av. Pruebas 311',
      },
    });
    expect(response.status()).toBe(201);
    if (!storeId) storeId = id(await response.json());
    else otherStoreId = id(await response.json());
  }
  for (const [key, role, assignedStore] of [
    ['supervisor', 'SUPERVISOR', storeId],
    ['other', 'SUPERVISOR', otherStoreId],
    ['worker', 'TRABAJADOR', storeId],
    ['accountant', 'CONTADOR', null],
  ] as const) {
    const email = key + '-' + suffix + '@example.test';
    const response = await request.post(backend + '/users', {
      headers,
      data: {
        email,
        password,
        firstName: 'Camila',
        lastName: 'Prueba de propinas',
        roleCode: role,
        ...(assignedStore ? { storeId: assignedStore } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const account = { id: id(await response.json()), email, role };
    accounts.push(account);
    if (key === 'supervisor') supervisor = account;
  }
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  for (const account of accounts)
    expect(
      (
        await request.patch(backend + '/users/' + account.id + '/deactivate', {
          headers: { Authorization: 'Bearer ' + adminToken },
        })
      ).status(),
    ).toBe(200);
  for (const store of [storeId, otherStoreId])
    if (store)
      expect(
        (
          await request.patch(backend + '/stores/' + store + '/deactivate', {
            headers: { Authorization: 'Bearer ' + adminToken },
          })
        ).status(),
      ).toBe(200);
});

test('Supervisor: campos, CLP, cuatro medios, totales, responsable, doble envío y duplicados', async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/dashboard');
  await page
    .getByRole('link', { name: 'Registrar propinas', exact: true })
    .click();
  await expect(page).toHaveURL(/\/propinas\/diarias$/);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Registro diario de propinas',
    }),
  ).toBeVisible();
  await registerDate(page);
  await expect(
    page.getByRole('heading', { name: 'No hay registros para esta fecha' }),
  ).toBeVisible();
  const save = page.getByRole('button', {
    name: 'Guardar propinas',
    exact: true,
  });
  const amount = page.getByRole('textbox', { name: /Monto en CLP/ });
  const method = page.getByRole('combobox', { name: /Medio de pago/ });
  await save.click();
  await expect(method).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await method.selectOption('CASH');
  for (const invalid of ['-1', '1.5', '10000000000']) {
    await amount.fill(invalid);
    await save.click();
    await expect(amount).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Corrige los campos',
    );
  }
  let posts = 0;
  await page.route('**/api/tips', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 200));
    }
    await route.continue();
  });
  await amount.fill('12500');
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Propinas registradas correctamente.' }),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  expect(posts).toBe(1);
  for (const [code, value] of [
    ['DEBIT_CARD', '8750'],
    ['CREDIT_CARD', '0'],
    ['TRANSFER', '3500'],
  ]) {
    await expect(save).toBeEnabled();
    await method.selectOption(code);
    await amount.fill(value);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/tips') &&
        response.request().method() === 'POST' &&
        response.status() === 201,
    );
    await save.click();
    await saved;
  }
  await expect(page.getByRole('row')).toHaveCount(5);
  await expect(
    page.getByText('Camila Prueba de propinas', { exact: true }),
  ).toHaveCount(4);
  await expect(page.getByText(/Total del día:/)).toContainText('24.750');
  const totals = page.locator('dl[aria-label="Totales por medio de pago"]');
  await expect(totals.locator('dd')).toHaveText([
    '$12.500',
    '$8.750',
    '$0',
    '$3.500',
  ]);
  expect(posts).toBe(4);
  const replay = await context.request.post('/api/tips', {
    headers: { Origin: baseURL! },
    data: { businessDate: date, paymentMethod: 'CASH', amount: 12500 },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.text()).not.toContain('accessToken');
  await method.selectOption('CASH');
  await amount.fill('12500');
  await save.click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Este registro ya estaba guardado.' }),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(5);
  await expect(save).toBeEnabled();
  await amount.fill('13000');
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Ya existe un registro',
  );
  await expect(amount).toHaveValue('13000');
  await expect(page.getByText(/Total del día:/)).toContainText('24.750');
  const persisted = await context.request.get('/api/tips?businessDate=' + date);
  const records: unknown = await persisted.json();
  expect(records).toHaveLength(4);
  expect(JSON.stringify(records)).toContain(supervisor.id);
  const directLogin = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  const token: unknown = await directLogin.json();
  if (!isRecord(token) || typeof token.accessToken !== 'string')
    throw Error('Falta token de prueba.');
  expect(
    (
      await request.get(
        backend + '/tips?storeId=' + otherStoreId + '&businessDate=' + date,
        { headers: { Authorization: 'Bearer ' + token.accessToken } },
      )
    ).status(),
  ).toBe(403);
  await page.keyboard.press('Tab');
  await amount.focus();
  await expect(amount).toBeFocused();
  expect(
    await amount.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe('2px');
  await noOverflow(page);
  const folder = 'output/playwright/tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: folder + '/registro.png', scale: 'css' });
  await page.getByLabel(/Fecha del registro/).fill('');
  await expect(page.getByLabel(/Fecha del registro/)).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(save).toBeDisabled();
  await registerDate(page, '2026-10-25');
  await expect(
    page.getByRole('heading', { name: 'No hay registros para esta fecha' }),
  ).toBeVisible();
  await expect(page.getByText(/Total del día:/)).toContainText('$0');
  await registerDate(page);
  await expect(page.getByRole('row')).toHaveCount(5);
  expect(
    (await context.cookies())
      .filter((cookie) => cookie.name.startsWith('mf_'))
      .every((cookie) => cookie.httpOnly),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
});

test('BFF y páginas: sesión, roles, origen e identidad/local no editables', async ({
  page,
  context,
  baseURL,
}) => {
  expect(
    (await context.request.get('/api/tips?businessDate=' + date)).status(),
  ).toBe(401);
  await login(context, baseURL!);
  const headers = { Origin: baseURL! };
  const input = { businessDate: date, paymentMethod: 'CASH', amount: 12500 };
  for (const body of [
    { ...input, storeId: otherStoreId },
    { ...input, responsibleId: accounts[1].id },
    { ...input, amount: -1 },
    { ...input, businessDate: '2026-02-30' },
  ])
    expect(
      (
        await context.request.post('/api/tips', { headers, data: body })
      ).status(),
    ).toBe(400);
  expect(
    (
      await context.request.get(
        '/api/tips?businessDate=' + date + '&storeId=' + otherStoreId,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.get(
        '/api/tips?businessDate=' + date + '&businessDate=2026-10-25',
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post('/api/tips', {
        headers: { Origin: 'https://other.example.test' },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (await context.request.post('/api/tips', { data: input })).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch('/api/tips', { headers, data: input })
    ).status(),
  ).toBe(405);
  for (const account of accounts.filter((item) => item.role !== 'SUPERVISOR')) {
    await login(context, baseURL!, account.email);
    await page.goto('/propinas/diarias');
    await expect(page).toHaveURL(
      account.role === 'TRABAJADOR'
        ? /\/portal\?reason=forbidden$/
        : /\/dashboard\?reason=forbidden$/,
    );
    expect(
      (await context.request.get('/api/tips?businessDate=' + date)).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post('/api/tips', { headers, data: input })
      ).status(),
    ).toBe(403);
  }
  await login(
    context,
    baseURL!,
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  );
  await page.goto('/propinas/diarias');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  expect(
    (await context.request.get('/api/tips?businessDate=' + date)).status(),
  ).toBe(403);
});

test('Carga, error, reintento y conservación de campos sobre la API real', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  let release: (() => undefined) | undefined;
  const gate = new Promise<undefined>((resolve) => {
    release = () => {
      resolve(undefined);
      return undefined;
    };
  });
  let failure = false;
  let hold = true;
  await page.route('**/api/tips**', async (route) => {
    if (route.request().method() === 'GET' && hold) await gate;
    if (failure) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"temporary"}',
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/propinas/diarias');
  await expect(
    page.getByText('Cargando registros de propinas…', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Guardar propinas', exact: true }),
  ).toBeDisabled();
  hold = false;
  release?.();
  await registerDate(page, '2026-10-24');
  failure = true;
  await page.getByRole('button', { name: 'Actualizar registros' }).click();
  await expect(
    page.getByRole('button', { name: 'Reintentar consulta' }),
  ).toBeVisible();
  const folder = 'output/playwright/tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: folder + '/error-consulta.png', scale: 'css' });
  failure = false;
  await page.getByRole('button', { name: 'Reintentar consulta' }).click();
  const save = page.getByRole('button', {
    name: 'Guardar propinas',
    exact: true,
  });
  await expect(save).toBeEnabled();
  await page
    .getByRole('combobox', { name: /Medio de pago/ })
    .selectOption('TRANSFER');
  const amount = page.getByRole('textbox', { name: /Monto en CLP/ });
  await amount.fill('4500');
  failure = true;
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Conservamos los campos',
  );
  await expect(amount).toHaveValue('4500');
  await expect(save).toBeEnabled();
  failure = false;
  await save.click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Propinas registradas correctamente.' }),
  ).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);
  await noOverflow(page);
});

test('Local desactivado después de abrir la vista: causa clara, monto conservado e historial disponible', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/propinas/diarias');
  await registerDate(page, '2026-10-23');
  await page
    .getByRole('combobox', { name: /Medio de pago/ })
    .selectOption('CASH');
  const amount = page.getByRole('textbox', { name: /Monto en CLP/ });
  await amount.fill('7500');
  // La API bloquea la baja si hay usuarios activos. Solo en esta base exclusiva
  // se prepara el estado inactivo con la vista abierta para probar la regresión.
  const changed = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? 'sprint3-t11',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v store_id="$1"',
      '--',
      storeId,
    ],
    {
      input:
        "UPDATE stores SET is_active = false, updated_at = now() WHERE id = :'store_id'::uuid AND name LIKE 'Propinas %' RETURNING id;",
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  expect(changed).toContain(storeId);
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/tips') && res.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Guardar propinas', exact: true })
    .click();
  expect((await response).status()).toBe(400);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Tu local está inactivo. Consulta con el administrador',
  );
  await expect(amount).toHaveValue('7500');
  await page.getByRole('button', { name: 'Actualizar registros' }).click();
  await expect(
    page.getByRole('heading', { name: 'No hay registros para esta fecha' }),
  ).toBeVisible();
  await noOverflow(page);
  const folder = 'output/playwright/tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/local-desactivado.png',
    fullPage: true,
    scale: 'css',
  });
});
