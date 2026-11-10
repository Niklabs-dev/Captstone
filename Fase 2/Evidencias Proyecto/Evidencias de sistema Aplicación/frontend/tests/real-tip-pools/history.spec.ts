import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { seedLegacyPools } from '../helpers/legacy-tip-pools';

// SPRINT-4A-T08: los repartos por período son un histórico de solo lectura.
// Administrador y contador los consultan en /propinas/historico (enlazado
// desde /propinas) y descargan las constancias PDF de los pagados; no hay
// acciones de calcular, observar, confirmar ni pagar, y la API responde 410.
// El supervisor ya no tiene la vista de repartos. Los repartos se siembran
// en la base exclusiva de la prueba (la API ya no los crea).
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3341';
const composeProject = process.env.COMPOSE_PROJECT_NAME ?? 'sprint4a-t08';
const password = 'History-test-2026!';
let adminToken = '';
let store = { id: '', name: '' };
let accountant = { id: '', email: '' };
let supervisor = { id: '', email: '' };
let camila = { id: '', email: '' };
let diego = { id: '', email: '' };
const accounts: { id: string }[] = [];
let paidId = '';
let draftId = '';

async function login(context: BrowserContext, baseURL: string, email: string) {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
// Ninguna vista del histórico ofrece acciones sobre el reparto.
async function noPoolActions(page: Page) {
  for (const name of [
    /Calcular/,
    /Recalcular/,
    /Observ/,
    /Confirmar/,
    /Validar/,
    /Registrar entrega/,
    /Marcar como pagad/,
  ])
    await expect(page.getByRole('button', { name })).toHaveCount(0);
}

test.beforeAll(async ({ request }, info) => {
  const auth = await request.post(backend + '/auth/login', {
    data: {
      email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
      password:
        process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
    },
  });
  expect(auth.status()).toBe(200);
  adminToken = (await auth.json()).accessToken as string;
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID();
  const created = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Historico ' + suffix,
      city: 'Melipilla',
      address: 'Av. Pruebas 408',
    },
  });
  expect(created.status()).toBe(201);
  store = (await created.json()) as typeof store;
  for (const [key, role, firstName] of [
    ['accountant', 'CONTADOR', 'Carmen'],
    ['supervisor', 'SUPERVISOR', 'Sofia'],
    ['camila', 'TRABAJADOR', 'Camila'],
    ['diego', 'TRABAJADOR', 'Diego'],
  ] as const) {
    const res = await request.post(backend + '/users', {
      headers,
      data: {
        email: key + '-' + suffix + '@example.test',
        password,
        firstName,
        lastName: 'Prueba T08',
        roleCode: role,
        ...(role === 'CONTADOR' ? {} : { storeId: store.id }),
      },
    });
    expect(res.status()).toBe(201);
    const account = (await res.json()) as { id: string; email: string };
    accounts.push(account);
    if (key === 'accountant') accountant = account;
    if (key === 'supervisor') supervisor = account;
    if (key === 'camila') camila = account;
    if (key === 'diego') diego = account;
  }
  const lines = [
    { userId: camila.id, amount: 10000 },
    { userId: diego.id, amount: 15000 },
  ];
  [paidId, , draftId] = seedLegacyPools(composeProject, [
    {
      storeId: store.id,
      periodStart: '2026-01-05',
      periodEnd: '2026-01-11',
      accountantId: accountant.id,
      status: 'PAID',
      paymentDate: '2026-01-12',
      lines,
    },
    {
      storeId: store.id,
      periodStart: '2026-01-12',
      periodEnd: '2026-01-18',
      accountantId: accountant.id,
      status: 'CONFIRMED',
      lines,
    },
    {
      storeId: store.id,
      periodStart: '2026-01-19',
      periodEnd: '2026-01-25',
      accountantId: accountant.id,
      status: 'DRAFT',
      lines,
    },
  ]);
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const account of accounts)
    await request.patch(backend + '/users/' + account.id + '/deactivate', {
      headers,
    });
  if (store.id)
    await request.patch(backend + '/stores/' + store.id + '/deactivate', {
      headers,
    });
});

test('El contador llega al histórico desde Propinas, ve los estados y descarga la constancia de un reparto pagado', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/tip-pools/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await login(context, baseURL!, accountant.email);
  await page.goto('/propinas');
  await page.getByRole('link', { name: 'Repartos anteriores' }).click();
  await expect(page).toHaveURL(/\/propinas\/historico$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Repartos anteriores' }),
  ).toBeVisible();

  const closed = page.getByRole('region', {
    name: 'Repartos confirmados y pagados',
  });
  const own = closed.getByRole('row').filter({ hasText: store.name });
  await expect(own).toHaveCount(2);
  await expect(own.nth(0)).toContainText('Confirmado sin pago');
  await expect(own.nth(0)).toContainText('Sin pago');
  await expect(own.nth(1)).toContainText('Pagado');
  await expect(own.nth(1)).toContainText('$25.000');

  // Los borradores sin efecto van aparte y plegados.
  const drafts = page.getByRole('region', { name: 'Borradores sin efecto' });
  const draftRow = drafts.getByRole('row').filter({ hasText: store.name });
  await expect(draftRow).toBeHidden();
  await drafts.getByText('Mostrar borradores').click();
  await expect(draftRow).toBeVisible();
  await expect(draftRow).toContainText('Borrador sin efecto');
  await noPoolActions(page);
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/historico.png',
    fullPage: true,
    scale: 'css',
  });

  await own
    .nth(1)
    .getByRole('link', { name: /Ver reparto/ })
    .click();
  await expect(page).toHaveURL(new RegExp('/propinas/historico/' + paidId));
  await expect(page.getByRole('main')).toContainText(
    'cada trabajador tiene su constancia',
  );
  const receipts = page.getByRole('region', { name: 'Constancias de pago' });
  await expect(receipts.getByRole('listitem')).toHaveCount(2);
  const downloadEvent = page.waitForEvent('download');
  await receipts
    .getByRole('link', { name: /Descargar constancia de Camila/ })
    .click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toBe('constancia-propinas.pdf');
  const path = await download.path();
  expect(path).toBeTruthy();
  expect((await readFile(path!)).subarray(0, 5).toString('latin1')).toBe(
    '%PDF-',
  );
  await noPoolActions(page);
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/reparto-pagado.png',
    fullPage: true,
    scale: 'css',
  });
});

test('Un borrador antiguo se muestra sin efecto y sin constancias', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, accountant.email);
  await page.goto('/propinas/historico/' + draftId);
  const main = page.getByRole('main');
  await expect(main).toContainText('Borrador sin efecto');
  await expect(main).toContainText('no tiene efecto');
  await expect(
    page.getByRole('region', { name: 'Constancias de pago' }),
  ).toHaveCount(0);
  await noPoolActions(page);
  const pdf = await context.request.get(
    `/api/tip-pools/${draftId}/receipts/${camila.id}/download`,
  );
  expect(pdf.status()).toBe(409);
});

test('El supervisor ya no tiene la vista de repartos y el trabajador tampoco entra al histórico', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, supervisor.email);
  await page.goto('/dashboard');
  const menu = (await page.getByRole('navigation').allTextContents()).join(' ');
  expect(menu).not.toContain('Reparto de propinas');
  await page.goto('/propinas/repartos');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto('/propinas/historico');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  expect(
    (
      await context.request.get(
        `/api/tip-pools/${paidId}/receipts/${camila.id}/download`,
      )
    ).status(),
  ).toBe(403);

  await login(context, baseURL!, camila.email);
  await page.goto('/propinas/historico');
  await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
});

test('Las acciones del reparto por período responden 410 y el BFF ya no las expone', async ({
  request,
  context,
  baseURL,
}) => {
  const auth = await request.post(backend + '/auth/login', {
    data: { email: accountant.email, password },
  });
  const headers = {
    Authorization: 'Bearer ' + ((await auth.json()).accessToken as string),
  };
  for (const path of [
    '/tip-pools/preview',
    `/tip-pools/${draftId}/observations`,
    `/tip-pools/${draftId}/confirm`,
    `/tip-pools/${paidId}/pay`,
  ]) {
    const response = await request.post(backend + path, {
      headers,
      data: { expectedVersion: 1 },
    });
    expect(response.status()).toBe(410);
  }
  const pool = await request.get(backend + '/tip-pools/' + draftId, {
    headers,
  });
  expect(await pool.json()).toMatchObject({ status: 'DRAFT', version: 1 });

  await login(context, baseURL!, accountant.email);
  for (const path of ['/api/tip-pools/preview', `/api/tip-pools/${draftId}`])
    expect(
      (
        await context.request.post(path, {
          headers: { Origin: baseURL! },
          data: { expectedVersion: 1 },
        })
      ).status(),
    ).toBe(404);
});
