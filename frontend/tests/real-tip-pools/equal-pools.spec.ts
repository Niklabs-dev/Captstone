import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// Detalle del reparto equitativo con API y PostgreSQL reales (SPRINT-4R-T06).
// Los montos salen de operaciones diarias creadas por la API; cada proyecto
// usa su propio local y sus propias cuentas sintéticas.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3341';
const password = 'Equal-pools-2026!';
const period = { periodStart: '2026-02-02', periodEnd: '2026-02-08' };
const firstName = 'Ana Prueba T06';
const secondName = 'Bruno Prueba T06';
let adminToken = '';
let storeId = '';
let accountantEmail = '';
let workerEmail = '';
let supervisorEmail = '';
let supervisorToken = '';
let otherStoreId = '';
let firstWorkerId = '';
let secondWorkerId = '';
const accountIds: string[] = [];

function idOf(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string'
  )
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function multipartBody(fields: Record<string, string | string[]>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----RepartoEquitativoE2E';
  const parts: string[] = [];
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${item}\r\n`,
      );
  parts.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.from(parts.join('')),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
async function login(
  context: BrowserContext,
  baseURL: string,
  email: string,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
}
async function confirm(page: Page, name: string): Promise<undefined> {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name, exact: true }).click();
  await expect(dialog).not.toBeVisible();
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
  const session = (await admin.json()) as { accessToken: string };
  adminToken = session.accessToken;
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID();
  const store = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Reparto T06 ' + suffix,
      city: 'Melipilla',
      address: 'Av. Pruebas 606',
    },
  });
  expect(store.status()).toBe(201);
  storeId = idOf(await store.json());
  const otherStore = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Reparto T06 otro ' + suffix,
      city: 'Melipilla',
      address: 'Av. Pruebas 607',
    },
  });
  expect(otherStore.status()).toBe(201);
  otherStoreId = idOf(await otherStore.json());
  const created: Record<string, string> = {};
  for (const [key, role, assigned, first] of [
    ['supervisor', 'SUPERVISOR', storeId, 'Sofia'],
    ['first', 'TRABAJADOR', storeId, 'Ana'],
    ['second', 'TRABAJADOR', storeId, 'Bruno'],
    ['accountant', 'CONTADOR', null, 'Carla'],
  ] as const) {
    const email = key + '-' + suffix + '@example.test';
    const response = await request.post(backend + '/users', {
      headers,
      data: {
        email,
        password,
        firstName: first,
        lastName: 'Prueba T06',
        roleCode: role,
        ...(assigned ? { storeId: assigned } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const id = idOf(await response.json());
    accountIds.push(id);
    created[key] = id;
    if (key === 'accountant') accountantEmail = email;
    if (key === 'first') workerEmail = email;
    if (key === 'supervisor') supervisorEmail = email;
  }
  const supervisorLogin = await request.post(backend + '/auth/login', {
    data: { email: supervisorEmail, password },
  });
  expect(supervisorLogin.status()).toBe(200);
  const supervisor = (await supervisorLogin.json()) as { accessToken: string };
  supervisorToken = supervisor.accessToken;
  firstWorkerId = created.first;
  secondWorkerId = created.second;
  // Dos días: el primero reparte $10.001 entre dos; el segundo, $500 a una.
  for (const [businessDate, cash, participants] of [
    ['2026-02-02', '10001', [created.first, created.second]],
    ['2026-02-03', '500', [created.first]],
  ] as const) {
    const form = multipartBody({
      storeId,
      businessDate,
      cardTipAmount: '0',
      cashTipAmount: cash,
      cashDifference: '0',
      participantIds: [...participants],
    });
    const operation = await request.post(backend + '/daily-operations', {
      headers: {
        Authorization: 'Bearer ' + supervisor.accessToken,
        'Content-Type': form.contentType,
      },
      data: form.body,
    });
    expect(operation.status()).toBe(201);
  }
});
test.afterAll(async ({ request }) => {
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const id of accountIds)
    await request.patch(backend + '/users/' + id + '/deactivate', { headers });
  for (const id of [storeId, otherStoreId])
    if (id)
      await request.patch(backend + '/stores/' + id + '/deactivate', {
        headers,
      });
});

test('Monto a pagar: reparto equitativo sin horas, conciliado en borrador, confirmado, enterado y constancia', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!, accountantEmail);
  await page.goto('/propinas/repartos');
  await page.getByLabel('Local', { exact: true }).selectOption(storeId);
  await page.getByLabel('Desde', { exact: true }).fill(period.periodStart);
  await page.getByLabel('Hasta', { exact: true }).fill(period.periodEnd);
  await page
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  await confirm(page, 'Calcular reparto');

  const distribution = page.getByRole('region', {
    name: 'Distribución por trabajador',
  });
  async function expectDetail(): Promise<undefined> {
    await expect(
      distribution.getByRole('columnheader', { name: 'Monto a pagar' }),
    ).toBeVisible();
    await expect(
      distribution.getByRole('columnheader', { name: 'Horas' }),
    ).toHaveCount(0);
    await expect(distribution.getByRole('row')).toHaveCount(3);
    const amounts = await distribution
      .getByRole('row')
      .filter({ hasText: 'Prueba T06' })
      .evaluateAll((rows) =>
        rows.map((row) =>
          Number((row.lastElementChild?.textContent ?? '').replace(/\D/g, '')),
        ),
      );
    // $10.001 entre dos más $500 de Ana: el peso extra depende de la fecha.
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(10_501);
    expect(amounts.every((amount) => amount >= 5_000)).toBe(true);
    await expect(
      page.getByText(
        'Conciliación correcta: suma individual $10.501 · fondo $10.501 · fuentes $10.501 · diferencia con líneas $0 · diferencia con fuentes $0.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Reparto equitativo diario entre participantes'),
    ).toBeVisible();
    await expect(page.getByText('Horas totales')).toHaveCount(0);
    await expect(page.getByText('Pacto aplicado')).toHaveCount(0);
    await noOverflow(page);
  }

  await expect(distribution).toContainText(firstName);
  await expect(distribution).toContainText(secondName);
  await expectDetail();
  await page
    .getByRole('button', { name: 'Validar reparto', exact: true })
    .click();
  await confirm(page, 'Validar reparto');
  await expect(
    page.getByRole('button', {
      name: 'Registrar entrega de propinas',
      exact: true,
    }),
  ).toBeVisible();
  await expectDetail();
  await page
    .getByRole('button', { name: 'Registrar entrega de propinas', exact: true })
    .click();
  await page.getByLabel('Fecha de entrega').fill('2026-02-09');
  await confirm(page, 'Registrar entrega de propinas');
  await expect(
    page.getByRole('heading', { name: 'Constancias de entrega' }),
  ).toBeVisible();
  await expectDetail();
  const firstRow = distribution.getByRole('row').filter({ hasText: firstName });
  const firstAmount = (
    await firstRow.getByRole('cell').last().innerText()
  ).trim();
  const folder = 'output/playwright/tip-pools/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/monto-a-pagar.png',
    fullPage: true,
    scale: 'css',
  });

  // La constancia del trabajador coincide y no inventa horas.
  await context.clearCookies();
  await login(context, baseURL!, workerEmail);
  await page.goto('/portal/propinas');
  await expect(
    page.getByText('No aplica (reparto equitativo)').first(),
  ).toBeVisible();
  // El monto de la constancia es el de su línea del reparto.
  await expect(page.getByRole('main')).toContainText(firstAmount);
  await noOverflow(page);
});

test('Supervisor: solo lectura de su local, sin acciones, alertas, constancias ni otros locales', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, supervisorEmail);
  await page.goto('/propinas/repartos');
  const local = page.getByLabel('Local', { exact: true });
  // Solo su local, además de la opción vacía del selector.
  await expect(local.locator('option')).toHaveCount(2);
  await expect(local).toHaveValue(storeId);
  await page.getByLabel('Desde', { exact: true }).fill(period.periodStart);
  await page.getByLabel('Hasta', { exact: true }).fill(period.periodEnd);
  await page
    .getByRole('button', { name: 'Consultar reparto', exact: true })
    .click();
  const distribution = page.getByRole('region', {
    name: 'Distribución por trabajador',
  });
  await expect(
    distribution.getByRole('columnheader', { name: 'Monto a pagar' }),
  ).toBeVisible();
  await expect(distribution).toContainText(firstName);
  for (const name of [
    'Calcular reparto',
    'Recalcular borrador',
    'Validar reparto',
    'Registrar entrega de propinas',
  ])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Constancias de entrega' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: /pendientes de entrega/ }),
  ).toHaveCount(0);
  await noOverflow(page);

  const query = (id: string) =>
    '/api/tip-pools?' +
    new URLSearchParams({ storeId: id, ...period }).toString();
  const own = await context.request.get(query(storeId));
  expect(own.status()).toBe(200);
  const pools = (await own.json()) as { id: string }[];
  expect((await context.request.get(query(otherStoreId))).status()).toBe(403);
  expect((await context.request.get('/api/tip-pools/alerts')).status()).toBe(
    403,
  );
  expect(
    (
      await context.request.get('/api/tip-pools/' + pools[0].id + '/receipts')
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post('/api/tip-pools/preview', {
        headers: { Origin: baseURL! },
        data: { storeId, ...period },
      })
    ).status(),
  ).toBe(403);
});

test('Operación corregida después del cálculo: borrador desactualizado visible y recalculable', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const stalePeriod = { periodStart: '2026-03-02', periodEnd: '2026-03-08' };
  const auth = { Authorization: 'Bearer ' + supervisorToken };
  const form = multipartBody({
    storeId,
    businessDate: stalePeriod.periodStart,
    cardTipAmount: '0',
    cashTipAmount: '1000',
    cashDifference: '0',
    participantIds: [firstWorkerId, secondWorkerId],
  });
  const created = await request.post(backend + '/daily-operations', {
    headers: { ...auth, 'Content-Type': form.contentType },
    data: form.body,
  });
  expect(created.status()).toBe(201);
  const operationId = idOf(await created.json());

  await login(context, baseURL!, accountantEmail);
  await page.goto('/propinas/repartos');
  await page.getByLabel('Local', { exact: true }).selectOption(storeId);
  await page.getByLabel('Desde', { exact: true }).fill(stalePeriod.periodStart);
  await page.getByLabel('Hasta', { exact: true }).fill(stalePeriod.periodEnd);
  await page
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  await confirm(page, 'Calcular reparto');
  await expect(
    page.getByText('Conciliación correcta', { exact: false }),
  ).toBeVisible();

  const correction = multipartBody({ cashTipAmount: '1200' });
  expect(
    (
      await request.patch(backend + '/daily-operations/' + operationId, {
        headers: { ...auth, 'Content-Type': correction.contentType },
        data: correction.body,
      })
    ).status(),
  ).toBe(200);

  await page
    .getByRole('button', { name: 'Consultar reparto', exact: true })
    .click();
  const warning = page.getByRole('alert').filter({
    hasText: 'Borrador desactualizado',
  });
  await expect(warning).toContainText('calculado $1.000');
  await expect(warning).toContainText('actual $1.200');
  await expect(
    page.getByRole('button', { name: 'Validar reparto', exact: true }),
  ).toBeDisabled();
  await noOverflow(page);

  await page.getByRole('button', { name: 'Recalcular borrador' }).click();
  await confirm(page, 'Recalcular borrador');
  await expect(
    page.getByText('Conciliación correcta', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('fondo $1.200', { exact: false })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Validar reparto', exact: true }),
  ).toBeEnabled();
});
