import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3341';
const password = 'Pools-test-2026!';
let token = '';
let store = { id: '', name: '' };
let accountant = { id: '', email: '' };
let supervisor = { id: '', email: '' };
let worker = { id: '', email: '' };
let poolId = '';
const accounts: { id: string; email: string }[] = [];
const period = { periodStart: '2026-01-05', periodEnd: '2026-01-11' };
async function login(
  context: BrowserContext,
  baseURL: string,
  email = accountant.email,
  secret = password,
) {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: secret },
      })
    ).status(),
  ).toBe(200);
}
async function filters(page: Page) {
  await page.getByLabel('Local', { exact: true }).selectOption(store.id);
  await page.getByLabel('Desde', { exact: true }).fill(period.periodStart);
  await page.getByLabel('Hasta', { exact: true }).fill(period.periodEnd);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function confirm(page: Page, name: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog
    .getByRole('button', { name, exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(dialog).not.toBeVisible();
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
  token = (await auth.json()).accessToken as string;
  const headers = { Authorization: 'Bearer ' + token };
  const suffix = info.project.name + '-' + randomUUID();
  const response = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Repartos ' + suffix,
      city: 'Melipilla',
      address: 'Av. Pruebas 315',
    },
  });
  expect(response.status()).toBe(201);
  store = (await response.json()) as typeof store;
  for (const role of ['CONTADOR', 'SUPERVISOR', 'TRABAJADOR']) {
    const res = await request.post(backend + '/users', {
      headers,
      data: {
        email: role.toLowerCase() + '-' + suffix + '@example.test',
        password,
        firstName: role === 'TRABAJADOR' ? 'Camila' : 'Persona',
        lastName: 'Prueba T15',
        roleCode: role,
        ...(role === 'CONTADOR' ? {} : { storeId: store.id }),
      },
    });
    expect(res.status()).toBe(201);
    const account = (await res.json()) as { id: string; email: string };
    accounts.push(account);
    if (role === 'CONTADOR') accountant = account;
    else if (role === 'SUPERVISOR') supervisor = account;
    else worker = account;
  }
  // No existen formularios de pacto y horas en este sprint; solo se preparan
  // antecedentes sintéticos en esta base exclusiva. Todas las acciones usan API real.
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? 'sprint3-t15',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v store_id="$1" -v worker_id="$2" -v recorded_by="$3"',
      '--',
      store.id,
      worker.id,
      supervisor.id,
    ],
    {
      input:
        "INSERT INTO tip_agreements (name,rule,valid_from,valid_to,store_id,created_by_id,updated_at) VALUES ('Pacto de prueba T15','PROPORTIONAL_TO_HOURS','2026-01-01','2026-12-31',:'store_id',:'recorded_by',now()); INSERT INTO work_hours_records (period_start,period_end,hours_worked,store_id,worker_id,recorded_by_id,updated_at) VALUES ('2026-01-05','2026-01-11',40,:'store_id',:'worker_id',:'recorded_by',now());",
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  const supervisorAuth = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  expect(supervisorAuth.status()).toBe(200);
  const supervisorToken = (await supervisorAuth.json()).accessToken as string;
  for (const [method, amount] of [
    ['CASH', 10000],
    ['DEBIT_CARD', 15000],
  ] as const) {
    expect(
      (
        await request.post(backend + '/tips', {
          headers: { Authorization: 'Bearer ' + supervisorToken },
          data: {
            storeId: store.id,
            businessDate: '2026-01-06',
            paymentMethod: method,
            amount,
          },
        })
      ).status(),
    ).toBe(201);
  }
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  expect(
    (
      await request.post(backend + '/tips', {
        headers: { Authorization: 'Bearer ' + supervisorToken },
        data: {
          storeId: store.id,
          businessDate: today,
          paymentMethod: 'CREDIT_CARD',
          amount: 1000,
        },
      })
    ).status(),
  ).toBe(201);
});
test.afterAll(async ({ request }) => {
  if (!token) return;
  for (const account of accounts)
    expect(
      (
        await request.patch(backend + '/users/' + account.id + '/deactivate', {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).status(),
    ).toBe(200);
  if (store.id)
    expect(
      (
        await request.patch(backend + '/stores/' + store.id + '/deactivate', {
          headers: { Authorization: 'Bearer ' + token },
        })
      ).status(),
    ).toBe(200);
});

test('Contador: vacío, cálculo, observación, conflicto, conciliación, confirmación, pago y PDF', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  await login(context, baseURL!);
  let release: () => undefined = () => undefined;
  const gate = new Promise<undefined>((resolve) => {
    release = () => {
      resolve(undefined);
      return undefined;
    };
  });
  let first = true;
  let firstFulfilled: () => undefined = () => undefined;
  const firstDone = new Promise<undefined>((resolve) => {
    firstFulfilled = () => {
      resolve(undefined);
      return undefined;
    };
  });
  await page.route('**/api/tip-pools/alerts', async (route) => {
    if (first) {
      first = false;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response });
      firstFulfilled();
    } else await route.continue();
  });
  await page.goto('/propinas/repartos');
  await filters(page);
  await page
    .getByRole('button', { name: 'Consultar reparto', exact: true })
    .click();
  await expect(
    page.getByText('No hay un reparto guardado', { exact: false }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar ventana' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  await confirm(page, 'Calcular reparto');
  await expect(
    page.getByText('Conciliación correcta', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('cell', { name: 'Camila Prueba T15' }),
  ).toBeVisible();
  await noOverflow(page);
  await page.getByLabel('Local', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Desde', { exact: true })).toBeFocused();
  expect(
    await page
      .getByLabel('Desde', { exact: true })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe('none');
  const folder = 'output/playwright/tip-pools/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/borrador.png',
    fullPage: true,
    scale: 'css',
  });
  const query = await context.request.get(
    '/api/tip-pools?' + new URLSearchParams({ storeId: store.id, ...period }),
  );
  expect(query.status()).toBe(200);
  const pool = (await query.json())[0] as { id: string; version: number };
  poolId = pool.id;
  await page.getByRole('button', { name: 'Dejar observación' }).click();
  await page
    .getByLabel('Observación', { exact: true })
    .fill('Revisar horas antes de validar');
  await confirm(page, 'Guardar observación');
  await expect(
    page.getByText('Observación vigente:', { exact: false }),
  ).toContainText('Revisar horas');
  // Otra sesión actualiza la revisión para comprobar un conflicto real, sin mocks.
  const auth = await request.post(backend + '/auth/login', {
    data: { email: accountant.email, password },
  });
  expect(auth.status()).toBe(200);
  const access = (await auth.json()).accessToken as string;
  expect(
    (
      await request.post(backend + '/tip-pools/' + pool.id + '/observations', {
        headers: { Authorization: 'Bearer ' + access },
        data: {
          expectedVersion: pool.version + 1,
          notes: 'Revisión de otra sesión',
        },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole('button', { name: 'Validar reparto' }).click();
  await confirm(page, 'Validar reparto');
  await expect(
    page.getByRole('alert').filter({ hasText: 'El reparto cambió' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Validar reparto', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Actualizar reparto', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Validar reparto', exact: true })
    .click();
  await confirm(page, 'Validar reparto');
  await expect(
    page.getByRole('button', { name: 'Recalcular borrador' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Dejar observación' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Registrar entrega de propinas', exact: true })
    .click();
  await page.getByLabel('Fecha de entrega').fill('2026-01-12');
  await confirm(page, 'Registrar entrega de propinas');
  await expect(
    page.getByRole('heading', { name: 'Constancias de entrega' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Descargar constancia de Camila/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Actualizar alertas' }),
  ).toBeEnabled();
  release();
  await firstDone;
  await page.evaluate(
    () =>
      new Promise<undefined>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(undefined)),
        ),
      ),
  );
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: store.name })
      .filter({ hasText: 'Próxima' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('listitem')
      .filter({ hasText: store.name })
      .filter({ hasText: 'Vencida' }),
  ).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page
    .getByRole('button', { name: /Descargar constancia de Camila/ })
    .click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  await noOverflow(page);

  await page.screenshot({
    path: folder + '/enterado.png',
    fullPage: true,
    scale: 'css',
  });
});

test('Administrador: consulta histórica y constancias, mutaciones rechazadas; otros roles sin acceso', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(
    context,
    baseURL!,
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  );
  await page.goto('/propinas/repartos');
  await expect(
    page.getByText('Tu acceso es de solo lectura.', { exact: false }),
  ).toBeVisible();
  await filters(page);
  await page
    .getByRole('button', { name: 'Consultar reparto', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Constancias de entrega' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Calcular reparto', exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await context.request.post('/api/tip-pools/preview', {
        headers: { Origin: baseURL! },
        data: { storeId: store.id, ...period },
      })
    ).status(),
  ).toBe(403);
  await noOverflow(page);
  const folder = 'output/playwright/tip-pools/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/administrador.png',
    fullPage: true,
    scale: 'css',
  });
  for (const account of [supervisor, worker]) {
    await context.clearCookies();
    await login(context, baseURL!, account.email);
    await page.goto('/propinas/repartos');
    await expect(page).not.toHaveURL(/\/propinas\/repartos$/);
    expect(
      (await context.request.get('/api/tip-pools/' + poolId)).status(),
    ).toBe(403);
  }
});

test('Permisos, origen, cuerpo acotado, campos extra y errores de antecedentes', async ({
  context,
  baseURL,
  page,
}) => {
  await login(context, baseURL!);
  expect(
    (
      await context.request.post('/api/tip-pools/preview', {
        data: { storeId: store.id, ...period },
      })
    ).status(),
  ).toBe(403);
  for (const data of [
    { storeId: store.id, ...period, role: 'ADMINISTRADOR' },
    { storeId: store.id, periodStart: '2026-02-30', periodEnd: '2026-03-01' },
    { notes: 'x'.repeat(5000) },
  ])
    expect(
      (
        await context.request.post('/api/tip-pools/preview', {
          headers: { Origin: baseURL! },
          data,
        })
      ).status(),
    ).toBe(400);
  await page.goto('/propinas/repartos');
  await filters(page);
  await page.getByLabel('Desde', { exact: true }).fill('2026-02-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2026-02-02');
  await page
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('checkbox').check();
  await modal
    .getByRole('button', { name: 'Calcular reparto', exact: true })
    .click();
  await expect(modal.getByRole('alert')).toContainText('No se puede calcular');
  await expect(modal.getByRole('alert')).not.toContainText('passwordHash');
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await noOverflow(page);
});
