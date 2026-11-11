import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { randomInt, randomUUID } from 'node:crypto';
import writeXlsxFile from 'write-excel-file/node';
import { isRecord } from '../../src/lib/auth';

// Panel, reportes y calendario de ventas del administrador con API y
// PostgreSQL reales (SPRINT-4R-T14). Cada prueba crea su propio local,
// cuentas y datos sintéticos (Excel ficticio y operación diaria por API),
// así las repeticiones no dependen del estado de otra.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3343';
const password = 'Panel-ventas-T14-2026!';
let adminEmail = '';
let adminPassword = '';
let adminToken = '';
const storeIds: string[] = [];
const accountIds: string[] = [];

// --- Fechas de negocio en hora de Chile ---------------------------------------
function chileToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join('-');
}
function shift(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}
function display(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}
function slash(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}
// PNG 1x1 real y ficticio para el voucher (SPRINT-4A-T11).
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
function money(amount: number): string {
  return '$' + new Intl.NumberFormat('es-CL').format(amount);
}

// --- Datos sintéticos -----------------------------------------------------------
type Cell = string | number | null;
function row(cells: Record<number, Cell>): Cell[] {
  return Array.from({ length: 7 }, (_, index) => cells[index] ?? null);
}
// Misma estructura del Informe de Ventas Diario de MrComanda, inventada.
async function report(
  code: string,
  date: string,
  cash: number,
  debit: number,
): Promise<Buffer> {
  const total = cash + debit;
  const rows: Cell[][] = [
    row({ 4: `Fecha ${slash(shift(date, 1))} - 09:30:00` }),
    row({ 0: `Informe de Ventas Diario ${slash(date)} - ${slash(date)}` }),
    row({
      0: ` - Todas las Empresas  - Todos los puntos de venta - Local: ${code} - Todos los Sectores  - Toda la banda horaria  - Todos los comprobantes`,
    }),
    row({}),
    row({}),
    row({ 0: 'Período:', 1: `${slash(date)} al ${slash(date)}` }),
    row({ 0: 'Horario:', 1: '00:00:00 a 23:59:59' }),
    row({ 0: 'Ventas', 5: total }),
    row({ 0: 'Medios de pago', 5: total, 6: 'Porcentaje' }),
    row({ 0: 'T. DEBITO           ', 5: debit, 6: 50 }),
    row({ 0: 'EFECTIVO            ', 5: cash, 6: 50 }),
    row({}),
    row({ 0: 'Venta por depto.', 2: 1, 4: 'Cantidad', 5: 'Importe', 6: '%' }),
    row({ 0: 'UNIDADES        ', 4: 1, 5: 1, 6: 100 }),
    row({ 0: 'Emitió: Gerente de prueba' }),
  ];
  return writeXlsxFile(
    rows.map((cells) =>
      cells.map((cell) => (cell === null ? null : { value: cell })),
    ),
    { sheet: 'Informe_ventas_diario' },
  ).toBuffer();
}
function idOf(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function auth(token = adminToken): Record<string, string> {
  return { Authorization: 'Bearer ' + token };
}
async function createAccount(
  request: APIRequestContext,
  role: 'SUPERVISOR' | 'TRABAJADOR' | 'CONTADOR',
  storeId: string | null,
): Promise<{ id: string; email: string }> {
  const email = `${role.toLowerCase()}-${randomUUID()}@example.test`;
  const response = await request.post(backend + '/users', {
    headers: auth(),
    data: {
      email,
      password,
      firstName: role === 'TRABAJADOR' ? 'Tomas' : 'Sofia',
      lastName: 'Prueba T14',
      roleCode: role,
      ...(storeId ? { storeId } : {}),
    },
  });
  expect(response.status()).toBe(201);
  const id = idOf(await response.json());
  accountIds.push(id);
  return { id, email };
}
interface Fixture {
  storeId: string;
  storeName: string;
  code: string;
  supervisorEmail: string;
  workerId: string;
}
// Local con calendario de todos los días desde hace 10 días. El ID Subway
// del informe se asigna al crear el local (SPRINT-4A-T18 reemplazó la tabla
// de equivalencias); sin Excel en la prueba se omite.
async function createStore(
  request: APIRequestContext,
  label: string,
  calendar = true,
  externalCode = true,
): Promise<Fixture> {
  const storeName = `${label} T14 ${randomUUID()}`;
  const subwayStoreId = String(randomInt(1_000_000_000, 9_999_999_999));
  const store = await request.post(backend + '/stores', {
    headers: auth(),
    data: {
      name: storeName,
      city: 'Melipilla',
      address: 'Av. Pruebas 1414',
      ...(externalCode ? { subwayStoreId } : {}),
    },
  });
  expect(store.status()).toBe(201);
  const storeId = idOf(await store.json());
  storeIds.push(storeId);
  const code = `${randomInt(100, 999)} - ${subwayStoreId}`;
  if (calendar)
    expect(
      (
        await request.put(`${backend}/stores/${storeId}/operating-calendar`, {
          headers: auth(),
          data: {
            weekdays: [1, 2, 3, 4, 5, 6, 7],
            trackingStartDate: shift(chileToday(), -10),
          },
        })
      ).status(),
    ).toBe(200);
  const supervisor = await createAccount(request, 'SUPERVISOR', storeId);
  const worker = await createAccount(request, 'TRABAJADOR', storeId);
  return {
    storeId,
    storeName,
    code,
    supervisorEmail: supervisor.email,
    workerId: worker.id,
  };
}
async function importSales(
  request: APIRequestContext,
  fixture: Fixture,
  date: string,
  cash: number,
  debit: number,
): Promise<string> {
  const preview = await request.post(backend + '/sales-imports/preview', {
    headers: auth(),
    multipart: {
      file: {
        name: `ventas-${date}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: await report(fixture.code, date, cash, debit),
      },
    },
  });
  expect(preview.status()).toBe(201);
  const body: unknown = await preview.json();
  if (!isRecord(body) || !isRecord(body.import) || body.canConfirm !== true)
    throw Error('La vista previa no se puede confirmar.');
  const id = idOf(body.import);
  expect(
    (
      await request.post(`${backend}/sales-imports/${id}/confirm`, {
        headers: auth(),
        data: { expectedActiveImportId: null },
      })
    ).status(),
  ).toBe(200);
  return id;
}
async function registerOperation(
  request: APIRequestContext,
  fixture: Fixture,
  date: string,
  cashTip: number,
  difference: number,
  reason: string,
  cardTip = 0,
): Promise<string> {
  const login = await request.post(backend + '/auth/login', {
    data: { email: fixture.supervisorEmail, password },
  });
  expect(login.status()).toBe(200);
  const session: unknown = await login.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string')
    throw Error('Login de supervisor inválido.');
  const response = await request.post(backend + '/daily-operations', {
    headers: auth(session.accessToken),
    multipart: {
      storeId: fixture.storeId,
      businessDate: date,
      cardTipAmount: String(cardTip),
      cashTipAmount: String(cashTip),
      cashDifference: String(difference),
      differenceReason: reason,
      participantIds: fixture.workerId,
      // Con propina de tarjeta la foto del voucher es obligatoria.
      ...(cardTip > 0
        ? {
            voucher: {
              name: 'voucher-ficticio.png',
              mimeType: 'image/png',
              buffer: png,
            },
          }
        : {}),
    },
  });
  expect(response.status()).toBe(201);
  return idOf(await response.json());
}
async function addClosure(
  request: APIRequestContext,
  fixture: Fixture,
  date: string,
  reason: string,
): Promise<undefined> {
  expect(
    (
      await request.post(`${backend}/stores/${fixture.storeId}/closures`, {
        headers: auth(),
        data: { date, reason },
      })
    ).status(),
  ).toBe(201);
  return undefined;
}

// --- Navegador -----------------------------------------------------------------
async function login(
  context: BrowserContext,
  baseURL: string,
  email: string,
  secret: string,
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
  return undefined;
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return undefined;
}
function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}
// Resumen del local: fila de tabla en escritorio y ficha en móvil y tablet.
function storeSummary(page: Page, name: string): Locator {
  const panel = page.locator('section', {
    has: page.getByRole('heading', { name: 'Resumen por local' }),
  });
  return isDesktop(page)
    ? panel.getByRole('row').filter({ hasText: name })
    : panel.getByRole('article', { name });
}
function section(page: Page, title: string): Locator {
  return page.locator('section', {
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}

test.beforeAll(async ({ request }) => {
  adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
  adminPassword =
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
  const admin = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(admin.status()).toBe(200);
  const session: unknown = await admin.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string')
    throw Error('Login de prueba inválido.');
  adminToken = session.accessToken;
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  for (const id of accountIds)
    await request.patch(`${backend}/users/${id}/deactivate`, {
      headers: auth(),
    });
  for (const id of storeIds)
    await request.patch(`${backend}/stores/${id}/deactivate`, {
      headers: auth(),
    });
});

test('Panel: datos reales, sin dato, día cerrado, enlaces a cada fuente y carga tardía', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const today = chileToday();
  const imported = shift(today, -3);
  const late = shift(today, -2);
  const closed = shift(today, -4);
  const fixture = await createStore(request, 'Panel');
  const reason = 'Vuelto mal entregado ' + randomUUID().slice(0, 8);
  const closureReason = 'Mantención ' + randomUUID().slice(0, 8);
  await importSales(request, fixture, imported, 150_000, 400_000);
  await registerOperation(request, fixture, imported, 5000, -1500, reason);
  await addClosure(request, fixture, closed, closureReason);

  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/dashboard');
  // Navegación común: el panel figura en el menú lateral o en «Más».
  if (isDesktop(page))
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Panel de ventas' })
      .click();
  else {
    await page.getByRole('button', { name: 'Menú principal' }).click();
    await page
      .getByRole('dialog')
      .getByRole('link', { name: 'Panel de ventas' })
      .click();
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'Panel de ventas' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/panel-ventas$/);

  // Día con Excel vigente y operación diaria: cada cifra desde su fuente.
  await page.goto('/admin/panel-ventas?date=' + imported);
  await expect(
    page.getByRole('heading', { name: 'Resumen del ' + display(imported) }),
  ).toBeVisible();
  const summary = storeSummary(page, fixture.storeName);
  await expect(summary).toContainText('Importado');
  await expect(summary).toContainText(money(550_000));
  await expect(summary).toContainText(money(5000));
  await expect(summary).toContainText('-' + money(1500));
  await expect(summary).toContainText('Faltante');
  await expect(summary).toContainText(reason);
  const methods = section(page, 'Ventas por medio de pago')
    .getByRole('row')
    .filter({ hasText: fixture.storeName });
  await expect(methods).toContainText(money(150_000));
  await expect(methods).toContainText(money(400_000));
  const differences = section(page, 'Diferencias de efectivo')
    .getByRole('row')
    .filter({ hasText: fixture.storeName });
  await expect(differences).toContainText('-' + money(1500));
  await expect(differences).toContainText(reason);
  await expect(page.getByRole('main')).not.toContainText(/mercado pago/i);
  await noOverflow(page);

  // Enlaces a la importación y a la operación diaria, sin mezclar fuentes.
  await summary
    .getByRole('link', {
      name: 'Ver importación de ventas de ' + fixture.storeName,
    })
    .click();
  await expect(page).toHaveURL(/\/admin\/importacion-ventas\?importacion=/);
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: /Detalle de la importación/ }),
  });
  await expect(detail).toContainText(fixture.storeName);
  await expect(detail).toContainText(display(imported));
  await expect(detail).toContainText(money(550_000));
  await noOverflow(page);
  await page.goBack();
  await storeSummary(page, fixture.storeName)
    .getByRole('link', {
      name: 'Ver operación diaria de ' + fixture.storeName,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      name: `Operación diaria · ${fixture.storeName} · ${display(imported)}`,
    }),
  ).toBeVisible();
  const operation = page.getByRole('main');
  await expect(operation).toContainText('-' + money(1500));
  await expect(operation).toContainText('Faltante');
  await expect(operation).toContainText(reason);
  // SPRINT-4A-T23: junto a la diferencia, las ventas del día por medio.
  const contrast = section(page, 'Diferencia de efectivo y ventas del día');
  await expect(contrast).toContainText(money(150_000));
  await expect(contrast).toContainText(money(400_000));
  await expect(contrast).toContainText(money(550_000));
  await noOverflow(page);

  // Día abierto sin Excel: «Sin dato», nunca $0, y alerta de atrasado.
  await page.goto('/admin/panel-ventas?date=' + late);
  const lateSummary = storeSummary(page, fixture.storeName);
  await expect(lateSummary).toContainText('Atrasado');
  await expect(lateSummary).toContainText('Sin dato');
  await expect(lateSummary).not.toContainText('$0');
  await expect(
    lateSummary.getByRole('link', {
      name: 'Importar ventas de ' + fixture.storeName,
    }),
  ).toBeVisible();
  const missing = section(page, 'Ventas sin importar');
  const missingRow = (date: string): Locator =>
    missing
      .getByRole('row')
      .filter({ hasText: fixture.storeName })
      .filter({ hasText: display(date) });
  await expect(missingRow(late)).toContainText('Atrasado');
  await expect(missingRow(today)).toContainText('Pendiente hoy');
  // CERRADO e IMPORTADO no son faltantes.
  await expect(missingRow(closed)).toHaveCount(0);
  await expect(missingRow(imported)).toHaveCount(0);
  await noOverflow(page);

  // Día cerrado por excepción: se muestra cerrado con su motivo.
  await page.goto('/admin/panel-ventas?date=' + closed);
  const closedSummary = storeSummary(page, fixture.storeName);
  await expect(closedSummary).toContainText('Cerrado');
  await expect(closedSummary).toContainText('Motivo: ' + closureReason);
  await expect(closedSummary).not.toContainText('Atrasado');
  await noOverflow(page);

  // Una carga tardía resuelve la alerta sin intervención manual.
  await importSales(request, fixture, late, 90_000, 10_000);
  await page.goto('/admin/panel-ventas');
  await expect(missingRow(late)).toHaveCount(0);
  await expect(missingRow(today)).toContainText('Pendiente hoy');
  await page.goto('/admin/panel-ventas?date=' + late);
  await expect(storeSummary(page, fixture.storeName)).toContainText(
    money(100_000),
  );

  // Fechas inválidas o futuras: se explica sin mostrar cifras.
  await page.goto('/admin/panel-ventas?date=2026-13-45');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'no es válida',
  );
  await expect(page.getByRole('heading', { name: /^Resumen del/ })).toHaveCount(
    0,
  );
  await page.goto('/admin/panel-ventas?date=' + shift(today, 1));
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'días futuros',
  );
  await noOverflow(page);
});

test('Reportes: rango y local, medios dinámicos, propinas separadas, vacío y fechas inválidas', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const today = chileToday();
  const imported = shift(today, -3);
  const late = shift(today, -2);
  const closed = shift(today, -4);
  const fixture = await createStore(request, 'Reporte');
  const empty = await createStore(request, 'Reporte vacío', false);
  const reason = 'Sobrante de caja ' + randomUUID().slice(0, 8);
  await importSales(request, fixture, imported, 120_000, 30_000);
  await registerOperation(request, fixture, imported, 7000, 2000, reason);
  await addClosure(request, fixture, closed, 'Feriado local');

  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/admin/reportes-ventas');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reportes de ventas' }),
  ).toBeVisible();
  // Filtros desde el formulario: rango y un local.
  await page.getByLabel('Desde').fill(shift(today, -5));
  await page.getByLabel('Hasta').fill(today);
  await page
    .getByRole('combobox', { name: /^Local/ })
    .selectOption({ label: fixture.storeName });
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  await expect(
    page.getByRole('heading', {
      name: `Totales del ${display(shift(today, -5))} al ${display(today)} · ${fixture.storeName}`,
    }),
  ).toBeVisible();
  const tiles = page.locator('section', {
    has: page.getByRole('heading', { name: /^Totales del/ }),
  });
  await expect(tiles).toContainText(money(150_000));
  await expect(tiles).toContainText(money(7000));
  await expect(tiles).toContainText('+' + money(2000));

  // Columnas dinámicas del catálogo, sin conciliación Mercado Pago.
  const methods = section(page, 'Ventas por medio de pago');
  await expect(
    methods.getByRole('columnheader', { name: 'Efectivo', exact: true }),
  ).toBeVisible();
  await expect(
    methods.getByRole('columnheader', { name: 'Tarjeta de débito' }),
  ).toBeVisible();
  const methodRow = methods
    .getByRole('row')
    .filter({ hasText: fixture.storeName });
  await expect(methodRow).toContainText(money(120_000));
  await expect(methodRow).toContainText(money(30_000));
  await expect(page.getByRole('main')).not.toContainText(
    /mercado pago|concilia/i,
  );
  // Propinas como concepto aparte de las ventas.
  const tips = section(page, 'Propinas y diferencias por local')
    .getByRole('row')
    .filter({ hasText: fixture.storeName });
  await expect(tips).toContainText(money(7000));
  await expect(tips).toContainText('+' + money(2000));

  // Detalle por día: importado, atrasado sin dato y cerrado con motivo.
  const days = section(page, 'Detalle por día');
  const day = (date: string): Locator =>
    days.getByRole('row').filter({ hasText: display(date) });
  await expect(day(imported)).toContainText('Importado');
  await expect(day(imported)).toContainText(money(150_000));
  await expect(day(late)).toContainText('Atrasado');
  await expect(day(late)).toContainText('Sin dato');
  await expect(day(late)).not.toContainText('$0');
  await expect(day(closed)).toContainText('Cerrado');
  await expect(day(closed)).toContainText('Feriado local');
  await expect(
    day(imported).getByRole('link', { name: /^Ver importación de ventas/ }),
  ).toHaveAttribute('href', /\/admin\/importacion-ventas\?importacion=/);
  await expect(
    day(imported).getByRole('link', { name: /^Ver operación diaria/ }),
    // SPRINT-4A-T23: desde los reportes, el detalle vive bajo los reportes.
  ).toHaveAttribute('href', /\/admin\/reportes-ventas\/operaciones\//);
  await expect(
    section(page, 'Diferencias de efectivo')
      .getByRole('row')
      .filter({ hasText: reason }),
  ).toContainText('Sobrante');
  await noOverflow(page);

  // Todos los locales: el local con datos aparece junto a los demás.
  await page
    .getByRole('combobox', { name: /^Local/ })
    .selectOption({ label: 'Todos los locales' });
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  await expect(
    page.getByRole('heading', { name: /· Todos los locales$/ }),
  ).toBeVisible();
  await expect(
    section(page, 'Ventas por medio de pago')
      .getByRole('row')
      .filter({ hasText: fixture.storeName }),
  ).toContainText(money(150_000));

  // Local sin datos: «Sin dato» y estados vacíos, nunca ventas en cero.
  await page.goto(
    `/admin/reportes-ventas?from=${shift(today, -5)}&to=${today}&storeId=${empty.storeId}`,
  );
  const emptyRow = section(page, 'Ventas por medio de pago')
    .getByRole('row')
    .filter({ hasText: empty.storeName });
  await expect(emptyRow).toContainText('Sin dato');
  await expect(emptyRow).not.toContainText('$0');
  await expect(section(page, 'Detalle por día')).toContainText(
    'No hay días informados en el período.',
  );
  await expect(section(page, 'Diferencias de efectivo')).toContainText(
    'No hay diferencias de efectivo declaradas en el período.',
  );
  await noOverflow(page);

  // Fechas inválidas: se explica qué corregir sin consultar cifras.
  for (const [query, message] of [
    [`from=${today}&to=${shift(today, -1)}`, 'posterior a la de término'],
    [`from=${today}&to=${shift(today, 1)}`, 'días futuros'],
    [`from=${shift(today, -400)}&to=${today}`, '366 días'],
    ['from=2026-02-30&to=2026-03-01', 'no es válida'],
  ] as const) {
    await page.goto('/admin/reportes-ventas?' + query);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      message,
    );
    await expect(
      page.getByRole('heading', { name: /^Totales del/ }),
    ).toHaveCount(0);
  }
  await noOverflow(page);
});

test('Voucher: administrador y contador revisan la foto, la diferencia y las ventas del día; otro local recibe 403 (SPRINT-4A-T11/T23)', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const today = chileToday();
  const withVoucher = shift(today, -2);
  const cashOnly = shift(today, -1);
  const fixture = await createStore(request, 'Voucher', false);
  const foreign = await createStore(request, 'Voucher ajeno', false, false);
  // Excel vigente solo del día con voucher: el otro día no tiene ventas.
  await importSales(request, fixture, withVoucher, 120_000, 80_000);
  const reason = 'Faltante de arqueo ' + randomUUID().slice(0, 8);
  const operationId = await registerOperation(
    request,
    fixture,
    withVoucher,
    3000,
    -1200,
    reason,
    9000,
  );
  await registerOperation(request, fixture, cashOnly, 2000, 800, 'Sobrante');
  const voucherPath = '/api/daily-operations/' + operationId + '/voucher';

  await login(context, baseURL!, adminEmail, adminPassword);
  // Lista por local y rango: propinas, diferencia resaltada, voucher y enlace.
  await page.goto(
    `/admin/reportes-ventas?from=${shift(today, -3)}&to=${today}&storeId=${fixture.storeId}`,
  );
  const days = section(page, 'Detalle por día');
  const day = (date: string): Locator =>
    days.getByRole('row').filter({ hasText: display(date) });
  await expect(day(withVoucher)).toContainText(money(9000));
  await expect(day(withVoucher)).toContainText(money(3000));
  await expect(day(withVoucher)).toContainText('-' + money(1200));
  await expect(day(withVoucher)).toContainText('Faltante');
  await expect(day(withVoucher)).toContainText(reason);
  await expect(day(withVoucher)).toContainText('Con voucher');
  await expect(day(cashOnly)).toContainText('+' + money(800));
  await expect(day(cashOnly)).toContainText('Sobrante');
  await expect(day(cashOnly)).toContainText('Sin voucher');
  await noOverflow(page);
  await day(withVoucher)
    .getByRole('link', { name: /^Ver operación diaria/ })
    .click();

  // Detalle: vista previa y descarga por el BFF, sin URL pública.
  await expect(
    page.getByRole('heading', {
      name: `Operación diaria · ${fixture.storeName} · ${display(withVoucher)}`,
    }),
  ).toBeVisible();
  const main = page.getByRole('main');
  await expect(main).toContainText('-' + money(1200));
  await expect(main).toContainText('Faltante');
  const preview = page.getByRole('img', { name: /^Foto del voucher/ });
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute('src', voucherPath);
  await expect
    .poll(() =>
      preview.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const download = page.getByRole('link', { name: /^Descargar voucher de/ });
  await expect(download).toHaveAttribute('href', voucherPath);
  const file = await context.request.get(voucherPath);
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/png');
  expect(file.headers()['cache-control']).toBe('private, no-store');
  expect(Buffer.from(await file.body())).toEqual(png);
  // SPRINT-4A-T23: ventas del día por medio de pago junto a la diferencia.
  const contrast = section(page, 'Diferencia de efectivo y ventas del día');
  await expect(contrast).toContainText('-' + money(1200));
  await expect(contrast).toContainText(reason);
  await expect(contrast).toContainText(money(120_000));
  await expect(contrast).toContainText(money(80_000));
  await expect(contrast).toContainText(money(200_000));
  await noOverflow(page);

  // Operación sin propina con tarjeta ni Excel: sin voucher y con aviso.
  await page.goBack();
  await day(cashOnly)
    .getByRole('link', { name: /^Ver operación diaria/ })
    .click();
  await expect(page.getByRole('main')).toContainText('Sin voucher:');
  await expect(
    page.getByRole('img', { name: /^Foto del voucher/ }),
  ).toHaveCount(0);
  await expect(
    section(page, 'Diferencia de efectivo y ventas del día'),
  ).toContainText('No hay una importación vigente');

  // SPRINT-4A-T23: el CONTADOR llega desde su menú a los reportes y al
  // detalle de solo lectura, con la foto, la diferencia y las ventas.
  const accountant = await createAccount(request, 'CONTADOR', null);
  await login(context, baseURL!, accountant.email, password);
  await page.goto('/dashboard');
  // Menú lateral en escritorio; barra inferior (cuatro módulos) en móvil.
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Reportes de ventas' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reportes de ventas' }),
  ).toBeVisible();
  await page.goto(
    `/admin/reportes-ventas?from=${shift(today, -3)}&to=${today}&storeId=${fixture.storeId}`,
  );
  await expect(day(withVoucher)).toContainText('Con voucher');
  // Sin acceso a la importación: ni enlace ni página.
  await expect(
    days.getByRole('link', { name: /^Ver importación/ }),
  ).toHaveCount(0);
  await noOverflow(page);
  await day(withVoucher)
    .getByRole('link', { name: /^Ver operación diaria/ })
    .click();
  await expect(page).toHaveURL(
    new RegExp('/admin/reportes-ventas/operaciones/' + operationId + '$'),
  );
  await expect(
    page.getByRole('heading', {
      name: `Operación diaria · ${fixture.storeName} · ${display(withVoucher)}`,
    }),
  ).toBeVisible();
  const accountantPreview = page.getByRole('img', {
    name: /^Foto del voucher/,
  });
  await expect(accountantPreview).toHaveAttribute('src', voucherPath);
  await expect
    .poll(() =>
      accountantPreview.evaluate(
        (image: HTMLImageElement) => image.naturalWidth,
      ),
    )
    .toBeGreaterThan(0);
  const accountantContrast = section(
    page,
    'Diferencia de efectivo y ventas del día',
  );
  await expect(accountantContrast).toContainText('-' + money(1200));
  await expect(accountantContrast).toContainText('Faltante');
  await expect(accountantContrast).toContainText(money(9000));
  await expect(accountantContrast).toContainText(money(3000));
  await expect(accountantContrast).toContainText(money(120_000));
  await expect(accountantContrast).toContainText(money(80_000));
  // Solo lectura: el detalle no ofrece ningún botón de edición.
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await noOverflow(page);
  const accountantFile = await context.request.get(voucherPath);
  expect(accountantFile.status()).toBe(200);
  expect(Buffer.from(await accountantFile.body())).toEqual(png);
  // Ni el panel, ni la importación, ni la corrección por el BFF.
  for (const path of [
    '/admin/panel-ventas',
    '/admin/panel-ventas/operaciones/' + operationId,
    '/admin/importacion-ventas',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  }
  expect(
    (
      await context.request.patch('/api/daily-operations/' + operationId, {
        headers: { Origin: baseURL! },
        multipart: { cashDifference: '0' },
      })
    ).status(),
  ).toBe(403);
  // La lectura del contador queda auditada con su identidad.
  const audit = await request.get(
    `${backend}/audit-logs?storeId=${fixture.storeId}&limit=100`,
    { headers: auth() },
  );
  expect(audit.status()).toBe(200);
  const auditBody: unknown = await audit.json();
  const auditItems =
    isRecord(auditBody) && Array.isArray(auditBody.items)
      ? auditBody.items
      : [];
  expect(
    auditItems.some(
      (item: unknown) =>
        isRecord(item) &&
        item.action === 'DAILY_OPERATION_VOUCHER_DOWNLOADED' &&
        item.entityId === operationId &&
        isRecord(item.user) &&
        item.user.id === accountant.id,
    ),
  ).toBe(true);

  // El supervisor del local lo descarga; el de otro local recibe 403.
  await login(context, baseURL!, fixture.supervisorEmail, password);
  expect((await context.request.get(voucherPath)).status()).toBe(200);
  await login(context, baseURL!, foreign.supervisorEmail, password);
  expect((await context.request.get(voucherPath)).status()).toBe(403);
  // El trabajador no ve el voucher ni el detalle.
  const worker = await createAccount(request, 'TRABAJADOR', fixture.storeId);
  await login(context, baseURL!, worker.email, password);
  expect((await context.request.get(voucherPath)).status()).toBe(403);
  await page.goto('/admin/reportes-ventas/operaciones/' + operationId);
  await expect(page).toHaveURL(/\/portal\?reason=forbidden$/);
  await context.clearCookies();
  expect((await context.request.get(voucherPath)).status()).toBe(401);
});

test('Calendario: revisa la semana y registra o quita un cierre con fecha y motivo', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const today = chileToday();
  const fixture = await createStore(request, 'Calendario', false);
  const closure = shift(today, 20);
  const reason = 'Inventario anual ' + randomUUID().slice(0, 8);

  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/admin/calendario-locales');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Calendario de locales' }),
  ).toBeVisible();
  await expect(page.getByRole('main')).toContainText(
    'no define horarios ni turnos de los trabajadores',
  );
  const select = page.getByRole('combobox', { name: /^Local a revisar/ });
  // Solo tras hidratar el selector carga el calendario elegido.
  await expect(async () => {
    await select.selectOption({ label: fixture.storeName });
    await expect(
      page.getByRole('heading', {
        name: 'Configuración semanal · ' + fixture.storeName,
      }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  const weekly = section(page, 'Configuración semanal · ' + fixture.storeName);
  await expect(weekly).toContainText('Sin configurar');

  // Revisión y ajuste de la semana: lunes a viernes.
  for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'])
    await weekly.getByRole('checkbox', { name: day }).check();
  await weekly
    .getByLabel('Exigir ventas importadas desde')
    .fill(shift(today, -7));
  await weekly.getByRole('button', { name: 'Guardar calendario' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Calendario semanal guardado.' }),
  ).toBeVisible();
  await expect(weekly).toContainText('Configurado');
  await expect(weekly).toContainText(
    'Lunes, martes, miércoles, jueves y viernes',
  );
  await expect(weekly).toContainText(display(shift(today, -7)));
  await noOverflow(page);

  // Excepción de cierre: el motivo es obligatorio.
  const closures = section(page, 'Cierres por excepción');
  await closures.getByLabel('Fecha del cierre').fill(closure);
  await closures.getByRole('button', { name: 'Registrar cierre' }).click();
  await expect(closures.getByRole('alert')).toContainText(
    'Indica el motivo del cierre.',
  );
  await closures.getByLabel('Motivo del cierre').fill(reason);
  await closures.getByRole('button', { name: 'Registrar cierre' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `Cierre registrado para el ${display(closure)}.` }),
  ).toBeVisible();
  const closureRow = closures.getByRole('row').filter({ hasText: reason });
  await expect(closureRow).toContainText(display(closure));

  // El mismo día no admite un segundo cierre.
  await closures.getByLabel('Fecha del cierre').fill(closure);
  await closures.getByLabel('Motivo del cierre').fill('Duplicado');
  await closures.getByRole('button', { name: 'Registrar cierre' }).click();
  await expect(closures.getByRole('alert')).toContainText(
    'Ya existe un cierre registrado',
  );
  await noOverflow(page);

  // Quitar un cierre registrado por error, con confirmación.
  await closureRow
    .getByRole('button', { name: `Quitar cierre del ${display(closure)}` })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Quitar cierre' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Quitar cierre' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: `Cierre del ${display(closure)} quitado.` }),
  ).toBeVisible();
  await expect(closures).toContainText(
    'Este local no tiene cierres por excepción registrados.',
  );

  // Lo guardado persiste en la API real.
  const saved = await request.get(
    `${backend}/stores/${fixture.storeId}/operating-calendar`,
    { headers: auth() },
  );
  const body: unknown = await saved.json();
  expect(isRecord(body) && body.weekdays).toEqual([1, 2, 3, 4, 5]);
  expect(isRecord(body) && body.closures).toEqual([]);
});

test('Otros roles: sin enlaces, rutas redirigidas y BFF con 403', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  const fixture = await createStore(request, 'Roles', false);
  const accountant = await createAccount(request, 'CONTADOR', null);
  const worker = await createAccount(request, 'TRABAJADOR', fixture.storeId);
  // SPRINT-4A-T23: el CONTADOR sí lee los reportes y su detalle (se prueba
  // en «Voucher»); panel, calendario e importación siguen negados.
  const reportPages = [
    '/admin/reportes-ventas',
    '/admin/reportes-ventas/operaciones/' + randomUUID(),
  ];
  for (const [email, home] of [
    [fixture.supervisorEmail, '/dashboard'],
    [accountant.email, '/dashboard'],
    [worker.email, '/portal'],
  ] as const) {
    const isAccountant = email === accountant.email;
    const pages = [
      '/admin/panel-ventas',
      '/admin/calendario-locales',
      '/admin/importacion-ventas',
      '/admin/panel-ventas/operaciones/' + randomUUID(),
      ...(isAccountant ? [] : reportPages),
    ];
    await login(context, baseURL!, email, password);
    await page.goto(home);
    for (const name of ['Panel de ventas', 'Calendario de locales'])
      await expect(page.getByRole('link', { name })).toHaveCount(0);
    if (!isAccountant)
      await expect(
        page.getByRole('link', { name: 'Reportes de ventas' }),
      ).toHaveCount(0);
    for (const path of pages) {
      await page.goto(path);
      await expect(page).toHaveURL(
        new RegExp(home.replace('/', '\\/') + '\\?reason=forbidden'),
      );
    }
    const calendar = '/api/operating-calendars/' + fixture.storeId;
    expect((await context.request.get(calendar)).status()).toBe(403);
    expect(
      (
        await context.request.put(calendar, {
          headers: { Origin: baseURL! },
          data: { weekdays: [1], trackingStartDate: '2026-11-01' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post(calendar + '/closures', {
          headers: { Origin: baseURL! },
          data: { date: '2026-12-25', reason: 'Navidad' },
        })
      ).status(),
    ).toBe(403);
  }
  // Sin sesión tampoco hay datos: el BFF responde 401.
  await context.clearCookies();
  expect(
    (
      await context.request.get('/api/operating-calendars/' + fixture.storeId)
    ).status(),
  ).toBe(401);
});
