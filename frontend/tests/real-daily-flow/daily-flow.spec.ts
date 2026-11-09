import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';

// Verificación de punta a punta del flujo diario y el reparto equitativo
// (SPRINT-4R-T07) con API y PostgreSQL reales. A diferencia de los specs por
// módulo (T05 y T06), aquí las operaciones se registran desde el formulario
// del supervisor y el mismo dato recorre toda la cadena: operación diaria →
// cálculo del contador → confirmación y entrega → constancia en el portal de
// cada trabajador. Cada proyecto usa su propio local y cuentas sintéticas.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3341';
const password = 'Flujo-diario-T07-2026!';
const lastName = 'Flujo T07';
const period = { periodStart: '2026-09-14', periodEnd: '2026-09-20' };
const mixedDay = '2026-09-14';
const cashDay = '2026-09-15';
const paymentDate = '2026-09-21';
// PNG 1x1 real para el voucher.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Account {
  id: string;
  email: string;
  name: string;
}
let adminToken = '';
let storeId = '';
let storeName = '';
let supervisor: Account;
let accountant: Account;
let workers: Account[] = [];
const accountIds: string[] = [];

function idOf(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function money(amount: number): string {
  return '$' + new Intl.NumberFormat('es-CL').format(amount);
}
// Regla documentada del calculador del backend: base para todos y el peso
// extra en la posición (díaDesdeEpoch mod n) del orden por ID.
function expectedSplit(
  businessDate: string,
  fund: number,
  ids: readonly string[],
): Record<string, number> {
  const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const [year, month, day] = businessDate.split('-').map(Number);
  const epochDay = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const base = Math.floor(fund / sorted.length);
  const residual = fund % sorted.length;
  const offset = epochDay % sorted.length;
  return Object.fromEntries(
    sorted.map((id, index) => [
      id,
      base +
        ((index - offset + sorted.length) % sorted.length < residual ? 1 : 0),
    ]),
  );
}
function addAmounts(
  ...parts: Record<string, number>[]
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const part of parts)
    for (const [id, amount] of Object.entries(part))
      total[id] = (total[id] ?? 0) + amount;
  return total;
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
// El título de la consulta sale del estado de React: si muestra la fecha, la
// página ya hidrató y el input controlado no vuelve a la fecha inicial.
async function selectDate(
  page: Page,
  value: string,
  empty = true,
): Promise<undefined> {
  const input = page.getByLabel(/Fecha de operación/);
  const [year, month, day] = value.split('-');
  const title = page.getByRole('heading', {
    name: `Operación registrada · ${day}-${month}-${year}`,
  });
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 1000 });
    await expect(title).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30000 });
  if (empty)
    await expect(
      page.getByRole('heading', { name: 'No hay operación registrada' }),
    ).toBeVisible();
}
async function fillDay(
  page: Page,
  values: { card: string; cash: string; difference: string; reason: string },
): Promise<undefined> {
  await page
    .getByRole('textbox', { name: /Propina con tarjeta/ })
    .fill(values.card);
  await page
    .getByRole('textbox', { name: /Propina en efectivo/ })
    .fill(values.cash);
  await page
    .getByRole('textbox', { name: /Diferencia de efectivo/ })
    .fill(values.difference);
  await page
    .getByRole('textbox', { name: /Motivo de la diferencia/ })
    .fill(values.reason);
}
async function save(page: Page): Promise<undefined> {
  await page
    .getByRole('button', { name: 'Guardar operación', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
}
function registeredSection(page: Page) {
  return page.locator('section', {
    has: page.getByRole('heading', { name: /Operación registrada/ }),
  });
}
// Multipart con campos repetidos (participantIds del contrato).
function multipartBody(
  fields: Record<string, string | string[]>,
  file?: { filename: string; type: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = '----FlujoDiarioT07';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${item}\r\n`,
        ),
      );
  if (file)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="voucher"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
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
  storeName = 'Flujo T07 ' + suffix;
  const store = await request.post(backend + '/stores', {
    headers,
    data: { name: storeName, city: 'Melipilla', address: 'Av. Pruebas 707' },
  });
  expect(store.status()).toBe(201);
  storeId = idOf(await store.json());
  const created: Account[] = [];
  for (const [key, role, assigned, firstName] of [
    ['supervisor', 'SUPERVISOR', storeId, 'Sofia'],
    ['accountant', 'CONTADOR', null, 'Carmen'],
    ['ana', 'TRABAJADOR', storeId, 'Ana'],
    ['beto', 'TRABAJADOR', storeId, 'Beto'],
    ['carla', 'TRABAJADOR', storeId, 'Carla'],
  ] as const) {
    const email = key + '-' + suffix + '@example.test';
    const response = await request.post(backend + '/users', {
      headers,
      data: {
        email,
        password,
        firstName,
        lastName,
        roleCode: role,
        ...(assigned ? { storeId: assigned } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const account = {
      id: idOf(await response.json()),
      email,
      name: firstName + ' ' + lastName,
    };
    accountIds.push(account.id);
    created.push(account);
  }
  [supervisor, accountant, ...workers] = created;
});
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

test('El supervisor tiene una sola operación diaria: sin cierre por turno ni captura de ventas o Mercado Pago', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, supervisor.email);
  await page.goto('/dashboard');
  // El menú (visible o colapsado en móvil) ofrece la operación diaria y
  // ninguna entrada del flujo reemplazado.
  const menu = (await page.getByRole('navigation').allTextContents()).join(' ');
  expect(menu).toContain('Operación diaria');
  expect(menu).not.toMatch(/cierre|turno|venta|mercado pago|concilia/i);

  await page.goto('/propinas/diarias');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Operación diaria' }),
  ).toBeVisible();
  await selectDate(page, '2026-09-30');
  const main = page.getByRole('main');
  await expect(main).not.toContainText(/cierre de caja|turno|mercado pago/i);
  await expect(main).not.toContainText(/venta|concilia/i);
  // Solo se declaran propinas, diferencia y su motivo: ningún campo de
  // ventas, apertura de caja ni montos de Mercado Pago.
  const fields = await main
    .getByRole('textbox')
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute('aria-label') ?? item.id),
    );
  expect(fields.join(' ')).not.toMatch(/venta|mercado|apertura|turno/i);
  await expect(
    main.getByRole('textbox', { name: /Propina con tarjeta/ }),
  ).toBeVisible();
  await expect(
    main.getByRole('textbox', { name: /Propina en efectivo/ }),
  ).toBeVisible();
  await expect(
    main.getByRole('textbox', { name: /Diferencia de efectivo/ }),
  ).toBeVisible();
  await noOverflow(page);

  // El BFF tampoco expone el cierre por turno ni la captura de ventas.
  for (const path of ['/api/cash-closings', '/api/sales'])
    expect(
      (
        await context.request.post(path, {
          headers: { Origin: baseURL! },
          data: { storeId, businessDate: '2026-09-30', shift: 1 },
        })
      ).status(),
    ).toBe(404);
});

test('Flujo completo: el supervisor registra dos días, el contador reparte y entrega, y cada trabajador ve su monto', async ({
  page,
  context,
  baseURL,
}, info) => {
  const [ana, beto, carla] = workers;
  const everyone = [ana.id, beto.id, carla.id];
  const firstDay = expectedSplit(mixedDay, 10000, everyone);
  const secondDay = expectedSplit(cashDay, 6001, [beto.id, carla.id]);
  const expected = addAmounts(firstDay, secondDay);
  const folder = 'output/playwright/daily-flow/' + info.project.name;
  await mkdir(folder, { recursive: true });

  // 1. Día 1: tarjeta + efectivo ($10.000 entre tres), voucher y sobrante.
  await login(context, baseURL!, supervisor.email);
  await page.goto('/propinas/diarias');
  await selectDate(page, mixedDay);
  await fillDay(page, {
    card: '7000',
    cash: '3000',
    difference: '2000',
    reason: 'Sobrante por vuelto no entregado',
  });
  await page.getByLabel(/Foto del voucher/).setInputFiles({
    name: 'voucher.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const participants = page.getByRole('group', {
    name: 'Trabajadores participantes del reparto',
  });
  await expect(participants).toContainText('0 de 3 seleccionados');
  await participants.getByRole('button', { name: 'Seleccionar todos' }).click();
  await expect(participants).toContainText('3 de 3 seleccionados');
  // La vista previa del formulario anticipa el monto exacto de cada uno.
  const preview = page.getByRole('region', {
    name: 'Vista previa del reparto del día',
  });
  for (const worker of workers)
    await expect(
      preview.getByRole('row').filter({ hasText: worker.name }),
    ).toContainText(money(firstDay[worker.id]));
  await save(page);
  const registered = registeredSection(page);
  await expect(registered).toContainText('$7.000');
  await expect(registered).toContainText('$3.000');
  await expect(registered).toContainText('$10.000');
  await expect(registered).toContainText('$2.000');
  await expect(registered).not.toContainText('-$2.000');
  await expect(registered).toContainText('Sobrante por vuelto no entregado');
  for (const worker of workers)
    await expect(registered.getByRole('table')).toContainText(worker.name);
  await noOverflow(page);
  await page.screenshot({ path: folder + '/dia-1.png', scale: 'css' });

  // Reintento idéntico por el BFF: mismo ID, sin duplicar.
  const listed = await context.request.get(
    '/api/daily-operations?storeId=' + storeId + '&businessDate=' + mixedDay,
  );
  const listedBody: unknown = await listed.json();
  if (!Array.isArray(listedBody) || listedBody.length !== 1)
    throw Error('Se esperaba una operación del día 1.');
  const mixedId = idOf(listedBody[0]);
  const replay = multipartBody(
    {
      storeId,
      businessDate: mixedDay,
      cardTipAmount: '7000',
      cashTipAmount: '3000',
      cashDifference: '2000',
      differenceReason: 'Sobrante por vuelto no entregado',
      participantIds: [...everyone].reverse(),
    },
    { filename: 'voucher.png', type: 'image/png', data: png },
  );
  const replayed = await context.request.post('/api/daily-operations', {
    headers: { Origin: baseURL!, 'Content-Type': replay.contentType },
    data: replay.body,
  });
  expect(replayed.status()).toBe(200);
  expect(idOf(await replayed.json())).toBe(mixedId);

  // 2. Día 2: solo efectivo con faltante y otros participantes.
  await selectDate(page, cashDay);
  await fillDay(page, {
    card: '0',
    cash: '6001',
    difference: '-1500',
    reason: 'Faltante por error en el vuelto',
  });
  await page.getByRole('checkbox', { name: beto.name }).check();
  await page.getByRole('checkbox', { name: carla.name }).check();
  await expect(participants).toContainText('2 de 3 seleccionados');
  await expect(preview).toContainText('queda $1 de residuo');
  await save(page);
  await expect(registered).toContainText('$6.001');
  await expect(registered).toContainText('-$1.500');
  await expect(registered).toContainText('Faltante por error en el vuelto');
  await expect(registered.getByRole('table')).not.toContainText(ana.name);
  await page.screenshot({ path: folder + '/dia-2.png', scale: 'css' });

  // 3. El contador calcula el período: cada uno recibe la suma exacta de
  //    sus asignaciones diarias y el reparto concilia.
  await login(context, baseURL!, accountant.email);
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
  async function expectDistribution(): Promise<undefined> {
    for (const worker of workers)
      await expect(
        distribution.getByRole('row').filter({ hasText: worker.name }),
      ).toContainText(money(expected[worker.id]));
    await expect(
      page.getByText(
        'Conciliación correcta: suma individual $16.001 · fondo $16.001 · fuentes $16.001 · diferencia con líneas $0 · diferencia con fuentes $0.',
      ),
    ).toBeVisible();
    await expect(
      distribution.getByRole('columnheader', { name: 'Horas' }),
    ).toHaveCount(0);
  }
  await expectDistribution();
  await page
    .getByRole('button', { name: 'Validar reparto', exact: true })
    .click();
  await confirm(page, 'Validar reparto');
  await page
    .getByRole('button', { name: 'Registrar entrega de propinas', exact: true })
    .click();
  await page.getByLabel('Fecha de entrega').fill(paymentDate);
  await confirm(page, 'Registrar entrega de propinas');
  await expect(
    page.getByRole('heading', { name: 'Constancias de entrega' }),
  ).toBeVisible();
  await expectDistribution();
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/reparto-entregado.png',
    fullPage: true,
    scale: 'css',
  });

  // 4. Cada trabajador ve en su portal la constancia con su monto exacto.
  for (const worker of workers) {
    await login(context, baseURL!, worker.email);
    await page.goto('/portal/propinas');
    const main = page.getByRole('main');
    await expect(main).toContainText(money(expected[worker.id]));
    await expect(main).toContainText(storeName);
    await noOverflow(page);
  }

  // 5. Entregado el reparto, el supervisor ya no puede corregir el día: la
  //    interfaz explica la causa y la operación queda como estaba.
  await login(context, baseURL!, supervisor.email);
  await page.goto('/propinas/diarias');
  await selectDate(page, cashDay, false);
  await expect(registered).toContainText('$6.001');
  await registered.getByRole('button', { name: 'Corregir operación' }).click();
  await page.getByRole('textbox', { name: /Propina en efectivo/ }).fill('6100');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'reparto confirmado o pagado',
  );
  // Con la corrección cancelada, la consulta fresca muestra la operación tal
  // como quedó en el reparto entregado.
  await page.getByRole('button', { name: 'Cancelar corrección' }).click();
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(registered).toContainText('$6.001');
  await expect(registered).not.toContainText('$6.100');
  await noOverflow(page);
  await page.screenshot({
    path: folder + '/correccion-rechazada.png',
    scale: 'css',
  });
});
