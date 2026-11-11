import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';
import { tipBusinessDate } from '../../src/lib/tips';
import { navigateTo } from '../helpers/navigation';
import { excelDate, readXlsx, type XlsxValue } from '../helpers/xlsx';

// Recorrido end-to-end del nuevo flujo de propinas y pago (SPRINT-4A-T13)
// por la interfaz real, con Next.js, NestJS y PostgreSQL reales detrás:
//   supervisor registra y corrige los días → reparto automático (4 × $10.000
//   y un día con residuo) → el trabajador ve No pagada → contador y
//   administrador ven el total diario, el detalle y la alerta legal (T22) →
//   el Excel cuadra con la pantalla → el contador paga 03-11 al 10-11-2026
//   (segundo pago 409) → el administrador paga el período vencido desde la
//   alerta (desaparece; segundo pago 409) → el trabajador ve Pagada y la
//   corrección posterior al pago se rechaza.
// Cada proyecto (1440 y 390 px) crea su propio local y cuentas sintéticas;
// los pagos no se pueden borrar, por eso corre solo en un stack desechable
// que se destruye al terminar (ver frontend/README.md).
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere API y base exclusivas con datos sintéticos.',
);
test.describe.configure({ mode: 'serial' });

const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3614';
const adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
const adminPassword =
  process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
const password = 'Flujo-propinas-T13-2026!';
const lastName = 'Propinas T13';
// Días del período que paga el contador (criterio de la tarea).
const fullDay = '2026-11-03';
const correctedDay = '2026-11-04';
const residualDay = '2026-11-10';
const contadorPeriod = { from: fullDay, to: residualDay };
// Días antiguos, fuera del plazo legal de pago: los paga el administrador.
const overdueDays = ['2026-10-20', '2026-10-22'] as const;
// PNG 1x1 real para el voucher de la propina con tarjeta.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Account {
  id: string;
  email: string;
  name: string;
}
interface Allocation {
  workerId: string;
  name: string;
  amount: number;
  status: string;
}
let adminToken = '';
let storeId = '';
let storeName = '';
let supervisor: Account;
let accountant: Account;
let ana: Account;
let beto: Account;
let carla: Account;
let outsider: Account;
const accountIds: string[] = [];
const storeIds: string[] = [];
// Propinas persistidas de cada día, leídas de la API tras guardarlo.
const allocations = new Map<string, Allocation[]>();

function idOf(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function tokenOf(value: unknown): string {
  if (!isRecord(value) || typeof value.accessToken !== 'string')
    throw Error('Login de prueba inválido.');
  return value.accessToken;
}
function money(amount: number): string {
  return '$' + new Intl.NumberFormat('es-CL').format(amount);
}
function parseMoney(text: string): number {
  const match = /(-?)\$\s*([\d.]+)/.exec(text);
  if (!match) throw Error('Sin monto en: ' + text);
  return Number(match[1] + match[2].replace(/\./g, ''));
}
function display(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}
function tipsUrl(from: string, to: string): string {
  return `/propinas?${new URLSearchParams({ storeId, from, to }).toString()}`;
}
function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
// Monto de cada trabajador en los días indicados, según la API.
function totalsByWorker(
  dates: readonly string[],
  status?: string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const date of dates)
    for (const line of allocations.get(date) ?? [])
      if (!status || line.status === status)
        totals[line.name] = (totals[line.name] ?? 0) + line.amount;
  return totals;
}
async function apiLogin(
  request: APIRequestContext,
  email: string,
  secret = password,
): Promise<string> {
  const response = await request.post(backend + '/auth/login', {
    data: { email, password: secret },
  });
  expect(response.status()).toBe(200);
  return tokenOf(await response.json());
}
async function login(
  context: BrowserContext,
  baseURL: string,
  email: string,
  secret = password,
): Promise<undefined> {
  await context.clearCookies();
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: secret },
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
async function shot(
  page: Page,
  folder: string,
  name: string,
): Promise<undefined> {
  await page.screenshot({
    path: `${folder}/${name}.png`,
    fullPage: true,
    scale: 'css',
  });
}
// Lee de la API las propinas guardadas de un día (fuente de verdad).
async function readDay(
  request: APIRequestContext,
  businessDate: string,
): Promise<Allocation[]> {
  const response = await request.get(
    backend +
      '/daily-tips/day?' +
      new URLSearchParams({ storeId, businessDate }).toString(),
    { headers: { Authorization: 'Bearer ' + adminToken } },
  );
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.allocations))
    throw Error('Detalle del día inválido.');
  const lines = body.allocations.map((item: unknown): Allocation => {
    if (
      !isRecord(item) ||
      !isRecord(item.worker) ||
      typeof item.worker.id !== 'string' ||
      typeof item.worker.name !== 'string' ||
      typeof item.amount !== 'number' ||
      typeof item.status !== 'string'
    )
      throw Error('Propina del día inválida.');
    return {
      workerId: item.worker.id,
      name: item.worker.name,
      amount: item.amount,
      status: item.status,
    };
  });
  allocations.set(businessDate, lines);
  return lines;
}

// --- Formulario del supervisor ------------------------------------------------

async function selectDate(
  page: Page,
  value: string,
  empty = true,
): Promise<undefined> {
  const input = page.getByLabel(/Fecha de operación/);
  const title = page.getByRole('heading', {
    name: `Operación registrada · ${display(value)}`,
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
async function fillTips(
  page: Page,
  card: string,
  cash: string,
): Promise<undefined> {
  await page.getByRole('textbox', { name: /Propina con tarjeta/ }).fill(card);
  await page.getByRole('textbox', { name: /Propina en efectivo/ }).fill(cash);
  await page.getByRole('textbox', { name: /Diferencia de efectivo/ }).fill('0');
}
function participants(page: Page): Locator {
  return page.getByRole('group', {
    name: 'Trabajadores participantes del reparto',
  });
}
async function choose(
  page: Page,
  people: readonly Account[],
): Promise<undefined> {
  for (const person of people)
    await participants(page)
      .getByRole('checkbox', { name: person.name })
      .check();
}
function registeredTable(page: Page): Locator {
  return page.getByRole('table', {
    name: 'Monto del día por participante registrado',
  });
}
// Monto de cada participante en una tabla de reparto del formulario.
async function sharesOf(table: Locator): Promise<Record<string, number>> {
  const rows = table.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const shares: Record<string, number> = {};
  for (const row of await rows.all())
    shares[(await row.locator('th').innerText()).trim()] = parseMoney(
      await row.locator('td').innerText(),
    );
  return shares;
}
function byName(lines: readonly Allocation[]): Record<string, number> {
  return Object.fromEntries(lines.map((line) => [line.name, line.amount]));
}

// --- Vista /propinas ----------------------------------------------------------

function dayRow(page: Page, date: string): Locator {
  return page
    .getByRole('region', { name: 'Propinas por día del período' })
    .getByRole('row')
    .filter({ hasText: display(date) });
}
function dayDetail(page: Page, date: string): Locator {
  return page.getByRole('list', {
    name: `Propina por trabajador del ${display(date)}`,
  });
}
async function openDetail(page: Page, date: string): Promise<Locator> {
  await dayRow(page, date)
    .getByRole('button', { name: /Ver detalle/ })
    .click();
  const detail = dayDetail(page, date);
  await expect(detail.getByRole('listitem').first()).toBeVisible();
  return detail;
}
function workersTable(page: Page): Locator {
  return page.getByRole('region', {
    name: 'Resumen de propinas por trabajador',
  });
}
function storeAlert(page: Page): Locator {
  return page.getByRole('article', {
    name: `Propinas vencidas de ${storeName}`,
  });
}
// Lo que muestra la pantalla: total de cada día y de cada trabajador.
async function screenTotals(page: Page): Promise<{
  days: Record<string, number>;
  workers: Record<string, number>;
  total: number;
}> {
  const days: Record<string, number> = {};
  for (const row of await page
    .getByRole('region', { name: 'Propinas por día del período' })
    .locator('tbody > tr:has(button[aria-expanded])')
    .all()) {
    const date = (
      await row.locator('td').first().locator('span').first().innerText()
    ).trim();
    days[date] = parseMoney(await row.locator('td').nth(1).innerText());
  }
  const workers: Record<string, number> = {};
  for (const row of await workersTable(page).locator('tbody tr').all()) {
    const name = (
      await row
        .locator('th')
        .evaluate((cell) => cell.firstChild?.textContent ?? '')
    ).trim();
    workers[name] = parseMoney(await row.locator('td').last().innerText());
  }
  const total = parseMoney(
    await workersTable(page).locator('tfoot td').last().innerText(),
  );
  return { days, workers, total };
}
async function downloadExcel(
  page: Page,
  folder: string,
): Promise<{ summary: XlsxValue[][]; detail: XlsxValue[][] }> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel' }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toMatch(
    new RegExp(
      `^propinas_.+_${contadorPeriod.from}_${contadorPeriod.to}\\.xlsx$`,
    ),
  );
  const saved = `${folder}/${file.suggestedFilename()}`;
  await file.saveAs(saved);
  await expect(
    page.getByRole('status').filter({ hasText: 'Se descargó' }),
  ).toBeVisible();
  const sheets = readXlsx(await readFile(saved));
  const summary = sheets.find((sheet) => sheet.name === 'Resumen');
  const detail = sheets.find((sheet) => sheet.name === 'Detalle');
  if (!summary || !detail) throw Error('Faltan las hojas del Excel.');
  return { summary: summary.rows, detail: detail.rows };
}
async function payPeriod(
  page: Page,
  from: string,
  to: string,
  amount: number,
  workerCount: number,
): Promise<undefined> {
  await page.getByRole('button', { name: 'Marcar como pagado' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Marcar propinas como pagadas',
  });
  await expect(dialog).toContainText(storeName);
  await expect(dialog).toContainText(`${display(from)} al ${display(to)}`);
  await expect(dialog).toContainText(money(amount));
  await expect(dialog).toContainText(`${workerCount} trabajadores`);
  await dialog.getByRole('button', { name: 'Confirmar pago' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('status').filter({
      hasText: `Se registró el pago de ${money(amount)} a ${workerCount} trabajadores del período ${display(from)} al ${display(to)}.`,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Marcar como pagado' }),
  ).toBeDisabled();
}
async function secondPaymentIsRejected(
  context: BrowserContext,
  baseURL: string,
  from: string,
  to: string,
): Promise<undefined> {
  const again = await context.request.post('/api/daily-tips/payment-batches', {
    headers: { Origin: baseURL },
    data: { storeId, from, to },
  });
  expect(again.status()).toBe(409);
  expect(await again.json()).toEqual({
    message: expect.stringContaining('No hay propinas pendientes'),
  });
}

// --- Portal «Mis propinas» ----------------------------------------------------

function myDays(page: Page): Locator {
  return page
    .getByRole('region', { name: /^Propinas por día ·/ })
    .getByRole('listitem');
}
async function expectMyMonth(
  page: Page,
  month: string,
  expected: readonly { date: string; amount: number; status: string }[],
): Promise<undefined> {
  await page.goto('/portal/propinas?month=' + month);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mis propinas' }),
  ).toBeVisible();
  await expect(myDays(page)).toHaveCount(expected.length);
  for (const day of expected)
    await expect(
      page.getByRole('article', {
        name: `Propina del ${display(day.date)}: ${money(day.amount)}, ${day.status}`,
      }),
    ).toBeVisible();
  const unpaid = sum(
    expected
      .filter((day) => day.status === 'No pagada')
      .map((day) => day.amount),
  );
  await expect(
    page.getByRole('region', { name: 'Totales del mes' }),
  ).toContainText(money(unpaid));
  await noOverflow(page);
}
function ownDays(
  person: Account,
  dates: readonly string[],
  status: string,
): { date: string; amount: number; status: string }[] {
  return dates.flatMap((date) =>
    (allocations.get(date) ?? [])
      .filter((line) => line.workerId === person.id)
      .map((line) => ({ date, amount: line.amount, status })),
  );
}

test.beforeAll(async ({ request }, info) => {
  // Las fechas de la tarea exigen que el 10-11-2026 ya haya llegado.
  expect(
    tipBusinessDate() >= residualDay,
    'El recorrido usa días hasta el 10-11-2026.',
  ).toBe(true);
  adminToken = await apiLogin(request, adminEmail, adminPassword);
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID().slice(0, 8);
  storeName = 'Propinas T13 ' + suffix;
  for (const name of [storeName, 'Otro local T13 ' + suffix]) {
    const store = await request.post(backend + '/stores', {
      headers,
      data: { name, city: 'Melipilla', address: 'Av. Pruebas 1313' },
    });
    expect(store.status()).toBe(201);
    storeIds.push(idOf(await store.json()));
  }
  [storeId] = storeIds;
  const created: Account[] = [];
  for (const [key, role, assigned, firstName] of [
    ['supervisor', 'SUPERVISOR', storeIds[0], 'Sofía'],
    ['accountant', 'CONTADOR', null, 'Carmen'],
    ['ana', 'TRABAJADOR', storeIds[0], 'Ana'],
    ['beto', 'TRABAJADOR', storeIds[0], 'Beto'],
    ['carla', 'TRABAJADOR', storeIds[0], 'Carla'],
    ['otro', 'TRABAJADOR', storeIds[1], 'Óscar'],
  ] as const) {
    const email = `${key}-${suffix}@example.test`;
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
      name: `${firstName} ${lastName}`,
    };
    accountIds.push(account.id);
    created.push(account);
  }
  [supervisor, accountant, ana, beto, carla, outsider] = created;

  // Los días vencidos se registran por la API con la cuenta del supervisor:
  // el formulario ya se recorre con los días del período del contador.
  const supervisorToken = await apiLogin(request, supervisor.email);
  for (const [businessDate, cash, people] of [
    [overdueDays[0], '8000', [ana, supervisor]],
    [overdueDays[1], '5001', [ana, beto, carla]],
  ] as const) {
    const form = new FormData();
    for (const [name, value] of [
      ['storeId', storeId],
      ['businessDate', businessDate],
      ['cardTipAmount', '0'],
      ['cashTipAmount', cash],
      ['cashDifference', '0'],
      ...people.map((person) => ['participantIds', person.id]),
    ])
      form.append(name, value);
    const operation = await request.post(backend + '/daily-operations', {
      headers: { Authorization: 'Bearer ' + supervisorToken },
      multipart: form,
    });
    expect(operation.status(), businessDate).toBe(201);
    await readDay(request, businessDate);
  }
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const id of accountIds)
    await request.patch(backend + '/users/' + id + '/deactivate', { headers });
  for (const id of storeIds)
    await request.patch(backend + '/stores/' + id + '/deactivate', {
      headers,
    });
});

test('1. El supervisor registra $40.000 con tres trabajadores y él mismo, un día con residuo y corrige un día antes del pago', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await login(context, baseURL!, supervisor.email);
  await page.goto('/dashboard');
  await navigateTo(page, 'Operación diaria');
  await expect(page).toHaveURL(/\/propinas\/diarias/);
  const preview = page.getByRole('table', {
    name: 'Monto por trabajador antes de guardar',
  });

  // Día completo: $15.000 con tarjeta (con voucher) + $25.000 en efectivo
  // entre los tres trabajadores y el propio supervisor.
  await selectDate(page, fullDay);
  await fillTips(page, '15000', '25000');
  await page.getByLabel(/Foto del voucher/).setInputFiles({
    name: 'voucher.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await expect(participants(page)).toContainText('0 de 4 seleccionados');
  await choose(page, [ana, beto, carla, supervisor]);
  await expect(participants(page)).toContainText('4 de 4 seleccionados');
  const fourWay = Object.fromEntries(
    [ana, beto, carla, supervisor].map((person) => [person.name, 10000]),
  );
  expect(await sharesOf(preview)).toEqual(fourWay);
  await page
    .getByRole('button', { name: 'Guardar operación', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  expect(await sharesOf(registeredTable(page))).toEqual(fourWay);
  // Se guardan 4 asignaciones de $10.000 No pagadas.
  const full = await readDay(request, fullDay);
  expect(full).toHaveLength(4);
  expect(byName(full)).toEqual(fourWay);
  expect(full.every((line) => line.status === 'UNPAID')).toBe(true);
  await noOverflow(page);
  await shot(page, folder, '1-dia-completo');

  // Día con residuo: $10.000 entre tres suma exactamente el fondo.
  await selectDate(page, residualDay);
  await fillTips(page, '0', '10000');
  await choose(page, [ana, beto, supervisor]);
  await expect(
    page.getByRole('region', { name: 'Vista previa del reparto del día' }),
  ).toContainText('queda $1 de residuo');
  const residualPreview = await sharesOf(preview);
  await page
    .getByRole('button', { name: 'Guardar operación', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  const residual = await readDay(request, residualDay);
  expect(residual).toHaveLength(3);
  expect(sum(residual.map((line) => line.amount))).toBe(10000);
  expect(residual.map((line) => line.amount).sort()).toEqual([
    3333, 3333, 3334,
  ]);
  // La vista previa, lo registrado y lo persistido coinciden.
  expect(residualPreview).toEqual(byName(residual));
  expect(await sharesOf(registeredTable(page))).toEqual(byName(residual));
  await shot(page, folder, '1-dia-residuo');

  // Día que se corrige antes del pago: $6.000 entre dos…
  await selectDate(page, correctedDay);
  await fillTips(page, '0', '6000');
  await choose(page, [ana, beto]);
  await page
    .getByRole('button', { name: 'Guardar operación', exact: true })
    .click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  expect(byName(await readDay(request, correctedDay))).toEqual({
    [ana.name]: 3000,
    [beto.name]: 3000,
  });
  // …y se corrige a $9.000 entre tres: el reparto se recalcula.
  await page.getByRole('button', { name: 'Corregir operación' }).click();
  await page.getByRole('textbox', { name: /Propina en efectivo/ }).fill('9000');
  await choose(page, [carla]);
  await expect(participants(page)).toContainText('3 de 4 seleccionados');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria corregida correctamente.' }),
  ).toBeVisible();
  const threeWay = {
    [ana.name]: 3000,
    [beto.name]: 3000,
    [carla.name]: 3000,
  };
  expect(await sharesOf(registeredTable(page))).toEqual(threeWay);
  const corrected = await readDay(request, correctedDay);
  expect(byName(corrected)).toEqual(threeWay);
  expect(corrected.every((line) => line.status === 'UNPAID')).toBe(true);
  await noOverflow(page);
  await shot(page, folder, '1-dia-corregido');
});

test('2. Antes del pago, cada trabajador ve solo sus propinas No pagadas', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  const november = [fullDay, correctedDay, residualDay];
  await login(context, baseURL!, ana.email);
  await page.goto('/portal');
  await navigateTo(page, 'Mis propinas');
  await expect(page).toHaveURL(/\/portal\/propinas$/);
  await expectMyMonth(page, '2026-11', ownDays(ana, november, 'No pagada'));
  // Ningún dato de otro trabajador: solo su monto de cada día.
  const main = page.getByRole('main');
  for (const other of [beto, carla, supervisor, outsider])
    await expect(main).not.toContainText(other.name);
  await shot(page, folder, '2-ana-no-pagada');
  await expectMyMonth(page, '2026-10', ownDays(ana, overdueDays, 'No pagada'));

  // Carla no participó del día con residuo; Óscar es de otro local.
  await login(context, baseURL!, carla.email);
  await expectMyMonth(page, '2026-11', ownDays(carla, november, 'No pagada'));
  await expect(myDays(page)).toHaveCount(2);
  await login(context, baseURL!, outsider.email);
  await expectMyMonth(page, '2026-11', []);

  // La API propia no acepta pedir los datos de otra persona y no expone a
  // los demás participantes; el trabajador tampoco entra a /propinas.
  const token = await apiLogin(request, ana.email);
  const headers = { Authorization: 'Bearer ' + token };
  const range = new URLSearchParams({ from: '2026-11-01', to: '2026-11-30' });
  const own = await request.get(`${backend}/my-tips?${range.toString()}`, {
    headers,
  });
  expect(own.status()).toBe(200);
  const text = JSON.stringify(await own.json());
  for (const other of [beto, carla, supervisor, outsider]) {
    expect(text).not.toContain(other.id);
    expect(text).not.toContain(other.name);
  }
  for (const extra of ['userId=' + beto.id, 'storeId=' + storeId])
    expect(
      (
        await request.get(`${backend}/my-tips?${range.toString()}&${extra}`, {
          headers,
        })
      ).status(),
    ).toBe(400);
  await login(context, baseURL!, ana.email);
  const query = new URLSearchParams({ storeId, ...contadorPeriod }).toString();
  for (const path of ['days', 'summary', 'export'])
    expect(
      (await context.request.get(`/api/daily-tips/${path}?${query}`)).status(),
    ).toBe(403);
  await page.goto('/propinas');
  await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
});

test('3. El contador ve la alerta legal, el total diario, el detalle y un Excel que cuadra con la pantalla', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  await login(context, baseURL!, accountant.email);
  await page.goto('/dashboard');
  await navigateTo(page, 'Propinas');
  await expect(page).toHaveURL(/\/propinas$/);

  // Alerta legal (T22): lo No pagado hasta la fecha que ya venció.
  const alerts = await request.get(backend + '/tip-payment-alerts', {
    headers: { Authorization: 'Bearer ' + adminToken },
  });
  expect(alerts.status()).toBe(200);
  const alertBody: unknown = await alerts.json();
  if (!isRecord(alertBody) || typeof alertBody.overdueThrough !== 'string')
    throw Error('Alertas inválidas.');
  const overdueThrough = alertBody.overdueThrough;
  const overdueDates = [...allocations.keys()].filter(
    (date) => date <= overdueThrough,
  );
  expect(overdueDates).toEqual(expect.arrayContaining([...overdueDays]));
  const overdue = totalsByWorker(overdueDates, 'UNPAID');
  const alert = storeAlert(page);
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(
    `${money(sum(Object.values(overdue)))} sin pagar`,
  );
  for (const [name, amount] of Object.entries(overdue))
    await expect(
      alert.getByRole('listitem').filter({ hasText: name }),
    ).toContainText(money(amount));
  await noOverflow(page);
  await shot(page, folder, '3-alerta');

  // Período del contador: total diario, detalle y resumen por trabajador.
  await page.goto(tipsUrl(contadorPeriod.from, contadorPeriod.to));
  await expect(
    page.getByRole('heading', {
      name: `${storeName} · ${display(contadorPeriod.from)} al ${display(contadorPeriod.to)}`,
    }),
  ).toBeVisible();
  for (const [date, total] of [
    [fullDay, 40000],
    [correctedDay, 9000],
    [residualDay, 10000],
  ] as const) {
    await expect(dayRow(page, date)).toContainText(money(total));
    await expect(dayRow(page, date)).toContainText('No pagado');
  }
  const full = await openDetail(page, fullDay);
  await expect(full.getByRole('listitem')).toHaveCount(4);
  await expect(full.getByText('$10.000')).toHaveCount(4);
  await expect(full.getByText('No pagada')).toHaveCount(4);
  await expect(full).toContainText(supervisor.name);
  const residual = await openDetail(page, residualDay);
  await expect(residual.getByRole('listitem')).toHaveCount(3);
  for (const line of allocations.get(residualDay) ?? [])
    await expect(
      residual.getByRole('listitem').filter({ hasText: line.name }),
    ).toContainText(money(line.amount));
  const november = [fullDay, correctedDay, residualDay];
  const expectedWorkers = totalsByWorker(november);
  const screen = await screenTotals(page);
  expect(screen.workers).toEqual(expectedWorkers);
  expect(screen.total).toBe(59000);
  expect(screen.days).toEqual({
    [display(fullDay)]: 40000,
    [display(correctedDay)]: 9000,
    [display(residualDay)]: 10000,
  });
  await noOverflow(page);
  await shot(page, folder, '3-periodo-pendiente');

  // El Excel del período cuadra con la pantalla.
  const { summary, detail } = await downloadExcel(page, folder);
  const header = summary[0].map(String);
  const totalColumn = header.indexOf('Total');
  const workersInExcel: Record<string, number> = {};
  for (const row of summary.slice(1, -1))
    workersInExcel[String(row[0])] = Number(row[totalColumn]);
  expect(workersInExcel).toEqual(screen.workers);
  const totalRow = summary[summary.length - 1];
  expect(totalRow[0]).toBe('Total por día');
  expect(Number(totalRow[totalColumn])).toBe(screen.total);
  const daysInExcel: Record<string, number> = {};
  header.forEach((title, column) => {
    if (/^\d{2}-\d{2}-\d{4}$/.test(title) && Number(totalRow[column]) > 0)
      daysInExcel[title] = Number(totalRow[column]);
  });
  expect(daysInExcel).toEqual(screen.days);
  // Hoja «Detalle»: una fila por propina, todas No pagadas.
  const lines = detail.slice(1);
  expect(lines).toHaveLength(10);
  expect(sum(lines.map((row) => Number(row[2])))).toBe(screen.total);
  // Celda vacía del lote: el archivo la omite al final de la fila.
  expect(
    lines.every((row) => row[3] === 'No pagada' && (row[4] ?? '') === ''),
  ).toBe(true);
  expect(
    [...new Set(lines.map((row) => excelDate(Number(row[0]))))].sort(),
  ).toEqual(november);
});

test('4. El contador paga del 03-11-2026 al 10-11-2026: todo pasa a Pagado y un segundo pago responde 409', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  await login(context, baseURL!, accountant.email);
  await page.goto(tipsUrl(contadorPeriod.from, contadorPeriod.to));
  await expect(dayRow(page, fullDay)).toContainText('No pagado');
  await payPeriod(page, contadorPeriod.from, contadorPeriod.to, 59000, 4);
  for (const date of [fullDay, correctedDay, residualDay])
    await expect(dayRow(page, date)).toContainText('Pagado');
  const full = await openDetail(page, fullDay);
  await expect(full.getByText('Pagada', { exact: true })).toHaveCount(4);
  await expect(workersTable(page).locator('tfoot td').nth(1)).toContainText(
    '$0',
  );
  await expect(
    page.getByRole('region', { name: 'Pagos de propinas registrados' }),
  ).toContainText(accountant.name);
  await secondPaymentIsRejected(
    context,
    baseURL!,
    contadorPeriod.from,
    contadorPeriod.to,
  );
  // Tras el pago, el Excel del período informa el lote de cada propina.
  const { detail } = await downloadExcel(page, folder);
  const lines = detail.slice(1);
  expect(lines).toHaveLength(10);
  expect(
    lines.every((row) => row[3] === 'Pagada' && (row[4] ?? '') !== ''),
  ).toBe(true);
  // La alerta del local sigue con los días vencidos de octubre.
  await expect(storeAlert(page)).toContainText(
    money(sum(Object.values(totalsByWorker([...overdueDays])))) + ' sin pagar',
  );
  await noOverflow(page);
  await shot(page, folder, '4-pagado-contador');
});

test('5. El trabajador ve Pagada lo pagado y No pagada lo pendiente', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  const november = [fullDay, correctedDay, residualDay];
  await login(context, baseURL!, ana.email);
  await expectMyMonth(page, '2026-11', ownDays(ana, november, 'Pagada'));
  await expect(myDays(page).filter({ hasText: 'Pagada el' })).toHaveCount(3);
  await shot(page, folder, '5-ana-pagada');
  await expectMyMonth(page, '2026-10', ownDays(ana, overdueDays, 'No pagada'));
  await login(context, baseURL!, supervisor.email);
  await expectMyMonth(page, '2026-11', ownDays(supervisor, november, 'Pagada'));
});

test('6. El administrador abre el período vencido desde la alerta, lo paga y la alerta desaparece; un segundo pago responde 409', async ({
  page,
  context,
  baseURL,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  await login(context, baseURL!, adminEmail, adminPassword);
  // También ve el total diario y el detalle del período ya pagado.
  await page.goto(tipsUrl(contadorPeriod.from, contadorPeriod.to));
  await expect(dayRow(page, fullDay)).toContainText('$40.000');
  await expect(dayRow(page, fullDay)).toContainText('Pagado');
  const full = await openDetail(page, fullDay);
  await expect(full.getByRole('listitem')).toHaveCount(4);
  await expect(full.getByText('Pagada', { exact: true })).toHaveCount(4);

  await page.goto('/propinas');
  const alert = storeAlert(page);
  await expect(alert).toBeVisible();
  await alert
    .getByRole('link', { name: `Ver propinas vencidas de ${storeName}` })
    .click();
  await expect(page).toHaveURL(
    new RegExp(`from=${overdueDays[0]}&to=${overdueDays[1]}`),
  );
  await expect(dayRow(page, overdueDays[0])).toContainText('$8.000');
  await expect(dayRow(page, overdueDays[1])).toContainText('$5.001');
  const old = await openDetail(page, overdueDays[1]);
  await expect(old.getByRole('listitem')).toHaveCount(3);
  await expect(old.getByText('No pagada')).toHaveCount(3);
  await shot(page, folder, '6-periodo-vencido');
  await payPeriod(page, overdueDays[0], overdueDays[1], 13001, 4);
  for (const date of overdueDays)
    await expect(dayRow(page, date)).toContainText('Pagado');
  // La alerta del local desaparece sin recargar y tampoco vuelve al recargar.
  await expect(storeAlert(page)).toHaveCount(0);
  await page.goto('/propinas');
  await expect(
    page.getByRole('region', { name: 'Propinas vencidas sin pagar' }),
  ).toBeVisible();
  await expect(storeAlert(page)).toHaveCount(0);
  await secondPaymentIsRejected(
    context,
    baseURL!,
    overdueDays[0],
    overdueDays[1],
  );
  await noOverflow(page);
  await shot(page, folder, '6-alerta-resuelta');
});

test('7. Después del pago la corrección se rechaza y el trabajador ve todo Pagada', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  const folder = 'output/playwright/tip-flow/' + info.project.name;
  await login(context, baseURL!, supervisor.email);
  await page.goto('/propinas/diarias');
  await selectDate(page, correctedDay, false);
  await page.getByRole('button', { name: 'Corregir operación' }).click();
  await page
    .getByRole('textbox', { name: /Propina en efectivo/ })
    .fill('12000');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'reparto confirmado o pagado',
  );
  await page.getByRole('button', { name: 'Cancelar corrección' }).click();
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(registeredTable(page)).toContainText('$3.000');
  // Lo persistido queda tal como se pagó.
  const lines = await readDay(request, correctedDay);
  expect(byName(lines)).toEqual({
    [ana.name]: 3000,
    [beto.name]: 3000,
    [carla.name]: 3000,
  });
  expect(lines.every((line) => line.status === 'PAID')).toBe(true);
  await noOverflow(page);
  await shot(page, folder, '7-correccion-rechazada');

  await login(context, baseURL!, ana.email);
  await expectMyMonth(page, '2026-10', ownDays(ana, overdueDays, 'Pagada'));
  await login(context, baseURL!, beto.email);
  await expectMyMonth(page, '2026-10', ownDays(beto, overdueDays, 'Pagada'));
  await expect(page.getByRole('main')).not.toContainText(ana.name);
});
