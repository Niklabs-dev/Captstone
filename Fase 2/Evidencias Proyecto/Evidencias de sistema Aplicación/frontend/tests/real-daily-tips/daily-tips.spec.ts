import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';
import { weekOf } from '../../src/lib/daily-tips';
import { tipBusinessDate } from '../../src/lib/tips';

// Vista de propinas del administrador y el contador (SPRINT-4A-T07) contra
// API y PostgreSQL reales. Cada proyecto crea su propio local y cuentas
// sintéticas; las operaciones diarias las registra el supervisor por la API.
// La descarga Excel (T05) y el pago por lote (T06) se prueban de punta a punta
// si el backend ya los expone; si no, se verifica el aviso de no disponible.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3341';
const password = 'Propinas-T07-2026!';
const pastWeek = { from: '2026-10-05', to: '2026-10-11' };
const today = tipBusinessDate();

interface Account {
  id: string;
  email: string;
  name: string;
}
let adminToken = '';
let storeId = '';
let storeName = '';
let accountant: Account;
let supervisor: Account;
let worker: Account;
let exportAvailable = false;
let paymentAvailable = false;
const accountIds: string[] = [];

function idOf(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function multipartBody(fields: Record<string, string | string[]>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = '----PropinasT07';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${item}\r\n`,
        ),
      );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
async function login(
  context: BrowserContext,
  baseURL: string,
  email: string,
): Promise<undefined> {
  await context.clearCookies();
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
function display(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}
function tipsUrl(from: string, to: string): string {
  return `/propinas?${new URLSearchParams({ storeId, from, to }).toString()}`;
}
function dayRow(page: Page, date: string) {
  return page
    .getByRole('region', { name: 'Propinas por día del período' })
    .getByRole('row')
    .filter({ hasText: display(date) });
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
  storeName = 'Propinas T07 ' + suffix.slice(0, 18);
  const store = await request.post(backend + '/stores', {
    headers,
    data: { name: storeName, city: 'Melipilla', address: 'Av. Pruebas 707' },
  });
  expect(store.status()).toBe(201);
  storeId = idOf(await store.json());
  const created: Account[] = [];
  for (const [key, role, assigned, firstName] of [
    ['accountant', 'CONTADOR', null, 'Carmen'],
    ['supervisor', 'SUPERVISOR', storeId, 'Sofía'],
    ['ana', 'TRABAJADOR', storeId, 'Ana'],
    ['beto', 'TRABAJADOR', storeId, 'Beto'],
  ] as const) {
    const email = key + '-' + suffix + '@example.test';
    const response = await request.post(backend + '/users', {
      headers,
      data: {
        email,
        password,
        firstName,
        lastName: 'Propinas T07',
        roleCode: role,
        ...(assigned ? { storeId: assigned } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const account = {
      id: idOf(await response.json()),
      email,
      name: firstName + ' Propinas T07',
    };
    accountIds.push(account.id);
    created.push(account);
  }
  const [ana, beto] = created.slice(2);
  [accountant, supervisor, worker] = created;
  const supervisorLogin = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  expect(supervisorLogin.status()).toBe(200);
  const supervisorToken = idOfToken(await supervisorLogin.json());
  // Semana pasada: $10.000 entre dos, un día sin propinas y $500 a una.
  // Semana actual: $9.000 entre tres (incluido el supervisor) el día de hoy.
  for (const [businessDate, cash, participants] of [
    ['2026-10-05', '10000', [ana.id, beto.id]],
    ['2026-10-06', '0', []],
    ['2026-10-07', '500', [ana.id]],
    [today, '9000', [ana.id, beto.id, supervisor.id]],
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
        Authorization: 'Bearer ' + supervisorToken,
        'Content-Type': form.contentType,
      },
      data: form.body,
    });
    expect(operation.status(), businessDate).toBe(201);
  }
  // T05 y T06 se desarrollan en paralelo: se detectan por sus rutas GET.
  const range = new URLSearchParams({ storeId, ...pastWeek }).toString();
  exportAvailable =
    (
      await request.get(backend + '/daily-tips/export?' + range, { headers })
    ).status() === 200;
  paymentAvailable =
    (
      await request.get(backend + '/daily-tips/payment-batches?' + range, {
        headers,
      })
    ).status() === 200;
});
function idOfToken(value: unknown): string {
  if (!isRecord(value) || typeof value.accessToken !== 'string')
    throw Error('Login de supervisor inválido.');
  return value.accessToken;
}
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const id of accountIds)
    await request.patch(backend + '/users/' + id + '/deactivate', { headers });
  if (storeId)
    await request.patch(backend + '/stores/' + storeId + '/deactivate', {
      headers,
    });
});

test('El contador entra a /propinas desde el menú; los repartos lo redirigen y la semana actual es la predeterminada', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/daily-tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await login(context, baseURL!, accountant.email);
  await page.goto('/dashboard');
  const menu = (await page.getByRole('navigation').allTextContents()).join(' ');
  expect(menu).toContain('Propinas');
  expect(menu).not.toContain('Reparto de propinas');
  await page.goto('/propinas/repartos');
  await expect(page).toHaveURL(/\/propinas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Propinas' }),
  ).toBeVisible();

  await page.goto('/propinas?storeId=' + storeId);
  const week = weekOf(today);
  await expect(page.getByLabel('Desde')).toHaveValue(week.from);
  await expect(page.getByLabel('Hasta')).toHaveValue(week.to);
  await expect(page.getByLabel('Local')).toHaveValue(storeId);
  await expect(
    page.getByRole('heading', {
      name: `${storeName} · ${display(week.from)} al ${display(week.to)}`,
    }),
  ).toBeVisible();
  const row = dayRow(page, today);
  await expect(row).toContainText('$9.000');
  await expect(row).toContainText('No pagado');
  await row.getByRole('button', { name: /Ver detalle/ }).click();
  const detail = page.getByRole('list', {
    name: `Propina por trabajador del ${display(today)}`,
  });
  await expect(detail.getByRole('listitem')).toHaveCount(3);
  await expect(detail).toContainText(supervisor.name);
  await expect(detail.getByText('$3.000')).toHaveCount(3);
  await expect(detail.getByText('No pagada')).toHaveCount(3);
  await expect(
    row.getByRole('button', { name: /Ocultar detalle/ }),
  ).toHaveAttribute('aria-expanded', 'true');
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/semana-actual.png',
    fullPage: true,
    scale: 'css',
  });
});

test('El período muestra días, «Sin propinas», resumen por trabajador, Excel y pago sin recargar', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/daily-tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await login(context, baseURL!, accountant.email);
  await page.goto(tipsUrl(pastWeek.from, pastWeek.to));
  await expect(dayRow(page, '2026-10-05')).toContainText('$10.000');
  await expect(dayRow(page, '2026-10-05')).toContainText('No pagado');
  await expect(dayRow(page, '2026-10-06')).toContainText('Sin propinas');
  await expect(dayRow(page, '2026-10-06')).not.toContainText('No pagado');
  await expect(dayRow(page, '2026-10-07')).toContainText('$500');
  // Teclado: el detalle se abre con Enter y muestra a quién le corresponde.
  await dayRow(page, '2026-10-07')
    .getByRole('button', { name: /Ver detalle/ })
    .press('Enter');
  const detail = page.getByRole('list', {
    name: 'Propina por trabajador del 07-10-2026',
  });
  await expect(detail.getByRole('listitem')).toHaveCount(1);
  await expect(detail).toContainText('Ana Propinas T07');

  const workers = page.getByRole('region', {
    name: 'Resumen de propinas por trabajador',
  });
  await expect(workers.getByRole('row', { name: /Ana/ })).toContainText(
    '$5.500',
  );
  await expect(workers.getByRole('row', { name: /Beto/ })).toContainText(
    '$5.000',
  );
  const total = workers.getByRole('row', { name: /Total general/ });
  await expect(total).toContainText('$10.500');
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/periodo-pendiente.png',
    fullPage: true,
    scale: 'css',
  });

  // Excel del filtro actual (T05).
  const excel = page.getByRole('button', { name: 'Descargar Excel' });
  if (exportAvailable) {
    const pending = page.waitForEvent('download');
    await excel.click();
    const file = await pending;
    expect(file.suggestedFilename()).toMatch(
      /^propinas_.+_2026-10-05_2026-10-11\.xlsx$/,
    );
    const saved = folder + '/' + file.suggestedFilename();
    await file.saveAs(saved);
    expect((await readFile(saved)).subarray(0, 2).toString()).toBe('PK');
    await expect(
      page.getByRole('status').filter({ hasText: 'Se descargó' }),
    ).toBeVisible();
  } else {
    await excel.click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'aún no está disponible' }),
    ).toBeVisible();
  }

  // Pago del período (T06): la confirmación resume lo pendiente.
  await page.evaluate(() => {
    document.body.dataset.sinRecarga = 'true';
  });
  await page.getByRole('button', { name: 'Marcar como pagado' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Marcar propinas como pagadas',
  });
  await expect(dialog).toContainText('05-10-2026 al 11-10-2026');
  await expect(dialog).toContainText('$10.500');
  await expect(dialog).toContainText('2 trabajadores');
  await expect(dialog).toContainText(storeName);
  await page.screenshot({ path: folder + '/confirmar-pago.png', scale: 'css' });
  await dialog.getByRole('button', { name: 'Confirmar pago' }).click();
  if (paymentAvailable) {
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('status').filter({
        hasText:
          'Se registró el pago de $10.500 a 2 trabajadores del período 05-10-2026 al 11-10-2026.',
      }),
    ).toBeVisible();
    await expect(dayRow(page, '2026-10-05')).toContainText('Pagado');
    await expect(dayRow(page, '2026-10-07')).toContainText('Pagado');
    await expect(dayRow(page, '2026-10-06')).toContainText('Sin propinas');
    await expect(detail.getByText('Pagada', { exact: true })).toBeVisible();
    await expect(total).toContainText('$0');
    await expect(
      page.getByRole('button', { name: 'Marcar como pagado' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('region', { name: 'Pagos de propinas registrados' }),
    ).toContainText('$10.500');
    // Sin recarga: el marcador del documento sigue presente.
    expect(await page.evaluate(() => document.body.dataset.sinRecarga)).toBe(
      'true',
    );
    // Un segundo pago no tiene pendientes: 409 con mensaje propio del BFF.
    const again = await context.request.post(
      '/api/daily-tips/payment-batches',
      {
        headers: { Origin: baseURL! },
        data: { storeId, ...pastWeek },
      },
    );
    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({
      message: expect.stringContaining('No hay propinas pendientes'),
    });
    await noOverflow(page);
    await page.screenshot({
      path: folder + '/periodo-pagado.png',
      fullPage: true,
      scale: 'css',
    });
  } else {
    await expect(
      dialog.getByRole('alert').filter({ hasText: 'aún no está disponible' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).not.toBeVisible();
  }
});

test('Vacío, error, validación y permisos (administrador, supervisor y trabajador)', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/daily-tips/' + info.project.name;
  await mkdir(folder, { recursive: true });
  // El administrador también ve la vista en su menú.
  await context.clearCookies();
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL! },
        data: {
          email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
          password:
            process.env.TEST_REAL_ADMIN_PASSWORD ??
            'admin-cambiar-en-produccion',
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto('/dashboard');
  expect(
    (await page.getByRole('navigation').allTextContents()).join(' '),
  ).toContain('Propinas');

  // Vacío: sin operaciones en el período, sin Excel ni pago.
  await page.goto(tipsUrl('2025-01-06', '2025-01-12'));
  await expect(
    page.getByText(
      'No hay operaciones diarias registradas en el período para este local.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText('Nadie recibió propinas en el período seleccionado.'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Descargar Excel' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Marcar como pagado' }),
  ).toBeDisabled();
  await noOverflow(page);
  await page.screenshot({ path: folder + '/vacio.png', scale: 'css' });

  // Validación del filtro: más de 62 días.
  await page.goto(tipsUrl('2026-01-01', '2026-03-31'));
  await expect(
    page.getByRole('alert').filter({ hasText: 'no puede superar 62 días' }),
  ).toBeVisible();

  // Error del servicio y reintento.
  let failing = true;
  await page.route('**/api/daily-tips/days?**', async (route) => {
    if (failing)
      await route.fulfill({
        status: 503,
        json: { message: 'No se pudo conectar con el servicio de propinas.' },
      });
    else await route.continue();
  });
  await page.goto(tipsUrl(pastWeek.from, pastWeek.to));
  const error = page
    .getByRole('alert')
    .filter({ hasText: 'No se pudieron cargar las propinas.' });
  await expect(error).toBeVisible();
  await page.screenshot({ path: folder + '/error.png', scale: 'css' });
  failing = false;
  await error.getByRole('button', { name: 'Reintentar' }).click();
  await expect(dayRow(page, '2026-10-05')).toContainText('$10.000');
  await page.unroute('**/api/daily-tips/days?**');

  // El BFF solo acepta el contrato y no reenvía errores del backend.
  const range = new URLSearchParams({ storeId, ...pastWeek }).toString();
  const extra = await context.request.get(
    '/api/daily-tips/days?' + range + '&debug=1',
  );
  expect(extra.status()).toBe(400);
  const missing = await context.request.get(
    '/api/daily-tips/days?' +
      new URLSearchParams({ storeId: randomUUID(), ...pastWeek }).toString(),
  );
  expect(missing.status()).toBe(404);
  expect(await missing.json()).toEqual({
    message: 'El local seleccionado no existe. Elige otro local.',
  });
  const noOrigin = await context.request.post(
    '/api/daily-tips/payment-batches',
    { data: { storeId, ...pastWeek } },
  );
  expect(noOrigin.status()).toBe(403);

  // El supervisor no entra a la vista ni al Excel o al pago, y desde
  // SPRINT-4A-T08 la vista de repartos lo devuelve a su inicio.
  await login(context, baseURL!, supervisor.email);
  await page.goto('/propinas');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  await page.goto('/propinas/repartos');
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(
    (await context.request.get('/api/daily-tips/export?' + range)).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post('/api/daily-tips/payment-batches', {
        headers: { Origin: baseURL! },
        data: { storeId, ...pastWeek },
      })
    ).status(),
  ).toBe(403);

  // El trabajador no consulta propinas de otros.
  await login(context, baseURL!, worker.email);
  expect(
    (await context.request.get('/api/daily-tips/days?' + range)).status(),
  ).toBe(403);
  await page.goto('/propinas');
  await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
});
