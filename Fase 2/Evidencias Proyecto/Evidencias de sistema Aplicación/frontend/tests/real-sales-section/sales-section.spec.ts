import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isRecord } from '../../src/lib/auth';
import { reportVariant } from './real-report';

// SPRINT-4A-T12: verificación de la sección de ventas con el Informe de
// Ventas Diario REAL de Santa María del 05/11/2026 (archivo
// ventas-06-11-2026.xlsx, que nunca se versiona: se pasa con
// MRCOMANDA_SAMPLE_XLSX). Recorre por la UI, con API y PostgreSQL reales, la
// navegación del administrador, la identificación por ID Subway, la vista
// previa, la confirmación sin duplicados, el medio con valor no reconocido,
// el calendario, el panel, los reportes y la revisión del contador.
// Escritorio (1440) y móvil (390) comparten el stack: lo que ya dejó el
// primer proyecto (importación del 05/11, operación diaria) se reutiliza y
// se verifica igual. Las capturas y el resumen con los montos observados
// quedan en output/playwright/sales-section/<proyecto>/ (ignorado por git).
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const sample = process.env.MRCOMANDA_SAMPLE_XLSX ?? '';
test.skip(!sample, 'Requiere MRCOMANDA_SAMPLE_XLSX con el informe real.');
test.describe.configure({ mode: 'serial' });

const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3611';
const password = 'Seccion-ventas-T12-2026!';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
// Datos del informe real (criterios de la tarea).
const BUSINESS_DATE = '2026-11-05';
const FILE_NAME = 'ventas-06-11-2026.xlsx';
const SUBWAY_STORE_ID = '72597';
const STORE = 'Santa María';
const DEBIT = 633_670;
const CASH = 159_450;
const CREDIT = 80_140;
const TOTAL = 873_260;
// Operación diaria ficticia de Santa María ese día (la misma en cada
// proyecto, para que el reintento sea idempotente).
const CARD_TIP = 12_000;
const CASH_TIP = 4_500;
const DIFFERENCE = -2_300;
const REASON = 'Vuelto entregado de más (QA SPRINT-4A-T12)';
// Medio con valor no reconocido: «N.de Créd.» del real pasa a «GIFT CARD».
const GIFT_LABEL = 'GIFT CARD';
const GIFT_AMOUNT = 25_000;
// PNG 1x1 ficticio para el voucher.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let adminEmail = '';
let adminPassword = '';
let adminToken = '';
let storeId = '';
let operationId = '';
const accountIds: string[] = [];

function money(amount: number): string {
  return (
    (amount < 0 ? '-' : '') +
    '$' +
    new Intl.NumberFormat('es-CL').format(Math.abs(amount))
  );
}
function display(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}
function auth(token = adminToken): Record<string, string> {
  return { Authorization: 'Bearer ' + token };
}
function idOf(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function itemsOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.items)) return value.items;
  return [];
}
// Variante por proyecto en otra fecha, para no tocar las ventas del 05/11.
function giftDate(project: string): string {
  return project === 'desktop' ? '2026-11-04' : '2026-11-03';
}

// --- Evidencia -------------------------------------------------------------------
function folder(project: string): string {
  return 'output/playwright/sales-section/' + project;
}
async function note(project: string, line: string): Promise<undefined> {
  await mkdir(folder(project), { recursive: true });
  await appendFile(join(folder(project), 'resumen.md'), line + '\n');
  return undefined;
}
async function capture(page: Page, name: string): Promise<undefined> {
  const project = test.info().project.name;
  await mkdir(folder(project), { recursive: true });
  await page.screenshot({
    path: join(folder(project), name + '.png'),
    fullPage: true,
    scale: 'css',
  });
  return undefined;
}
async function observed(
  project: string,
  label: string,
  locator: Locator,
): Promise<undefined> {
  const text = (await locator.innerText()).replace(/\s+/g, ' ').trim();
  await note(project, `- ${label}: ${text}`);
  return undefined;
}

// --- API (preparación) -----------------------------------------------------------
async function createAccount(
  request: APIRequestContext,
  role: 'SUPERVISOR' | 'TRABAJADOR' | 'CONTADOR',
  store: string | null,
): Promise<{ id: string; email: string }> {
  const email = `t12-${role.toLowerCase()}-${randomUUID()}@example.test`;
  const response = await request.post(backend + '/users', {
    headers: auth(),
    data: {
      email,
      password,
      firstName: role === 'TRABAJADOR' ? 'Tomas' : 'Sofia',
      lastName: 'Prueba T12',
      roleCode: role,
      ...(store ? { storeId: store } : {}),
    },
  });
  expect(response.status()).toBe(201);
  const id = idOf(await response.json());
  accountIds.push(id);
  return { id, email };
}
// La operación del 05/11 se registra una sola vez; si otro proyecto ya la
// creó, se reutiliza.
async function ensureOperation(request: APIRequestContext): Promise<string> {
  const existing = await request.get(
    `${backend}/daily-operations?storeId=${storeId}&businessDate=${BUSINESS_DATE}`,
    { headers: auth() },
  );
  expect(existing.status()).toBe(200);
  const found = itemsOf(await existing.json());
  if (found.length > 0) return idOf(found[0]);
  const supervisor = await createAccount(request, 'SUPERVISOR', storeId);
  const worker = await createAccount(request, 'TRABAJADOR', storeId);
  const login = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  expect(login.status()).toBe(200);
  const session: unknown = await login.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string')
    throw Error('Login de supervisor inválido.');
  const created = await request.post(backend + '/daily-operations', {
    headers: auth(session.accessToken),
    multipart: {
      storeId,
      businessDate: BUSINESS_DATE,
      cardTipAmount: String(CARD_TIP),
      cashTipAmount: String(CASH_TIP),
      cashDifference: String(DIFFERENCE),
      differenceReason: REASON,
      participantIds: worker.id,
      voucher: {
        name: 'voucher-ficticio.png',
        mimeType: 'image/png',
        buffer: png,
      },
    },
  });
  expect(created.status()).toBe(201);
  return idOf(await created.json());
}
// Quita el alias «GIFT CARD» que haya dejado otro proyecto, para que la
// línea vuelva a llegar sin identificar.
async function forgetGiftCardAlias(
  request: APIRequestContext,
): Promise<undefined> {
  const aliases = await request.get(backend + '/payment-method-aliases', {
    headers: auth(),
  });
  expect(aliases.status()).toBe(200);
  for (const alias of itemsOf(await aliases.json()))
    if (isRecord(alias) && alias.normalizedLabel === GIFT_LABEL)
      expect(
        (
          await request.delete(
            `${backend}/payment-method-aliases/${idOf(alias)}`,
            { headers: auth() },
          )
        ).status(),
      ).toBe(200);
  return undefined;
}

// --- Navegador -------------------------------------------------------------------
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
function isDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1024;
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  return undefined;
}
function section(page: Page, title: string): Locator {
  return page.locator('section', {
    has: page.getByRole('heading', { name: title, exact: true }),
  });
}
// Fila de un medio de pago con su monto dentro de una tabla.
function methodRow(region: Locator, name: string): Locator {
  return region.getByRole('row').filter({
    has: region.page().getByRole('rowheader', { name: new RegExp('^' + name) }),
  });
}
async function openImports(page: Page): Promise<undefined> {
  await page.goto('/admin/importacion-ventas');
  // Este estado solo desaparece tras hidratar: evita perder el archivo.
  await expect(page.getByText('Consultando importaciones…')).toHaveCount(0);
  return undefined;
}
async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
): Promise<undefined> {
  await page.getByLabel('Archivo Excel').setInputFiles({
    name,
    mimeType: XLSX,
    buffer,
  });
  await page.getByRole('button', { name: 'Ver vista previa' }).click();
  await expect(
    page.getByRole('heading', { name: 'Vista previa de la importación' }),
  ).toBeVisible();
  return undefined;
}

test.beforeAll(async ({ request }, info) => {
  adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
  adminPassword =
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
  const admin = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(admin.status()).toBe(200);
  const session: unknown = await admin.json();
  if (!isRecord(session) || typeof session.accessToken !== 'string')
    throw Error('Login de administrador inválido.');
  adminToken = session.accessToken;
  const stores = await request.get(backend + '/stores', { headers: auth() });
  const santaMaria = itemsOf(await stores.json()).find(
    (store) => isRecord(store) && store.name === STORE,
  );
  storeId = idOf(santaMaria);
  await mkdir(folder(info.project.name), { recursive: true });
  await writeFile(
    join(folder(info.project.name), 'resumen.md'),
    `# Sección de ventas con el Excel real · ${info.project.name}\n\n` +
      `Archivo: ${FILE_NAME} (no versionado). Ejecución: ${new Date().toISOString()}.\n\n`,
  );
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  for (const id of accountIds)
    await request.patch(`${backend}/users/${id}/deactivate`, {
      headers: auth(),
    });
});

test('Navegación del administrador: importación, panel, reportes y calendario', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/dashboard');
  let menu: Locator = page.getByRole('navigation');
  if (!isDesktop(page)) {
    await page.getByRole('button', { name: 'Menú principal' }).click();
    menu = page.getByRole('dialog');
  }
  const links = [
    ['Importar ventas', '/admin/importacion-ventas'],
    ['Panel de ventas', '/admin/panel-ventas'],
    ['Reportes de ventas', '/admin/reportes-ventas'],
    ['Calendario de locales', '/admin/calendario-locales'],
  ] as const;
  for (const [name, href] of links)
    await expect(
      menu.getByRole('link', { name, exact: true }).first(),
    ).toHaveAttribute('href', href);
  await capture(page, '01-navegacion-administrador');
  await note(
    info.project.name,
    '## Navegación\n\n- Menú del administrador: ' +
      links.map(([name]) => name).join(', ') +
      '.',
  );
  for (const [name, href] of links) {
    await page.goto('/dashboard');
    if (!isDesktop(page))
      await page.getByRole('button', { name: 'Menú principal' }).click();
    await (
      isDesktop(page) ? page.getByRole('navigation') : page.getByRole('dialog')
    )
      .getByRole('link', { name, exact: true })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(href + '$'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noOverflow(page);
  }
});

test('Santa María tiene el ID Subway 72597 y el Excel real se identifica por él', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/admin/locales');
  const store = isDesktop(page)
    ? page.getByRole('row').filter({ hasText: STORE })
    : page.getByRole('article', { name: STORE });
  await expect(store).toContainText(SUBWAY_STORE_ID);
  await noOverflow(page);
  await capture(page, '02-locales-id-subway');
  await note(
    info.project.name,
    `\n## Local\n\n- ${STORE} figura en Locales con ID Subway ${SUBWAY_STORE_ID}.`,
  );

  await openImports(page);
  const main = page.getByRole('main');
  await upload(page, FILE_NAME, await readFile(sample));
  // Si otro proyecto ya lo confirmó, el mismo archivo no se duplica.
  const already = main.getByText('Este archivo ya estaba importado');
  const firstUpload = !(await already.isVisible());
  // Identificado por el ID Subway: sin selectores manuales.
  await expect(main.getByText(STORE).first()).toBeVisible();
  await expect(page.getByLabel(/^Local del archivo/)).toHaveCount(0);
  await expect(
    main.getByText('Hay datos que el sistema no identificó'),
  ).toHaveCount(0);
  const preview = section(page, 'Vista previa de la importación');
  await expect(preview).toContainText(display(BUSINESS_DATE));
  await expect(
    main.getByText('El nombre del archivo indica 06-11-2026', {
      exact: false,
    }),
  ).toBeVisible();
  const lines = page.getByRole('region', {
    name: 'Medios de pago del archivo',
  });
  await expect(methodRow(lines, 'Tarjeta de débito')).toContainText(
    money(DEBIT),
  );
  await expect(methodRow(lines, 'Efectivo')).toContainText(money(CASH));
  await expect(methodRow(lines, 'Tarjeta de crédito')).toContainText(
    money(CREDIT),
  );
  // SPRINT-4A-T21: «N.de Créd.» en 0 y sin alias se omite sola.
  await expect(methodRow(lines, 'N.de Créd.')).toContainText(
    'Omitida sola (monto 0, sin medio reconocido)',
  );
  await expect(lines.getByRole('row').last()).toContainText(money(TOTAL));
  await noOverflow(page);
  await capture(page, '03-vista-previa-excel-real');
  await note(info.project.name, '\n## Vista previa del Excel real\n');
  await observed(info.project.name, 'Datos', preview.locator('dl').first());
  await observed(info.project.name, 'Medios de pago', lines);

  if (firstUpload) {
    await page.getByRole('button', { name: 'Confirmar importación' }).click();
    await expect(main.getByText('Importación confirmada')).toBeVisible();
    await note(info.project.name, '- Confirmada en este proyecto.');
  } else
    await note(
      info.project.name,
      '- Ya estaba confirmada por el proyecto anterior: la primera carga ya informa «ya estaba importado».',
    );
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: /Detalle de la importación/ }),
  });
  await expect(detail).toContainText(STORE);
  await expect(detail).toContainText('Vigente');
  await expect(detail).toContainText(money(TOTAL));
  await expect(detail).toContainText('N.de Créd.');

  // Reimportar el mismo archivo no duplica.
  await upload(page, FILE_NAME, await readFile(sample));
  await expect(already).toBeVisible();
  await expect(page.getByRole('button', { name: /^Confirmar/ })).toHaveCount(0);
  await noOverflow(page);
  await capture(page, '04-reimportacion-sin-duplicado');
  // Una sola versión, vigente, para Santa María el 05/11.
  const imports = await context.request.get(
    `${backend}/sales-imports?storeId=${storeId}&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
    { headers: auth() },
  );
  expect(imports.status()).toBe(200);
  const sameDay = itemsOf(await imports.json()).filter(
    (item) =>
      isRecord(item) &&
      item.businessDate === BUSINESS_DATE &&
      isRecord(item.store) &&
      item.store.id === storeId,
  );
  expect(sameDay).toHaveLength(1);
  expect(isRecord(sameDay[0]) && sameDay[0].status).toBe('ACTIVE');
  await note(
    info.project.name,
    `- Reimportación: «Este archivo ya estaba importado y es la versión vigente»; la API lista ${sameDay.length} importación del ${display(BUSINESS_DATE)} (ACTIVE, versión 1).`,
  );
});

test('Medio con valor no reconocido: se elige un medio o se crea uno nuevo', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  await forgetGiftCardAlias(request);
  const date = giftDate(info.project.name);
  const variant = await reportVariant(sample, {
    sourceDate: BUSINESS_DATE,
    targetDate: date,
    replacedLabel: 'N.de Créd.',
    label: GIFT_LABEL,
    amount: GIFT_AMOUNT,
  });
  // Copia ficticia fuera del repo, como evidencia del archivo usado.
  const fileName = `ventas-gift-card-${date}.xlsx`;
  await writeFile(join(tmpdir(), fileName), variant);
  const methodName = `Gift card ${info.project.name}`;

  await login(context, baseURL!, adminEmail, adminPassword);
  await openImports(page);
  const main = page.getByRole('main');
  await upload(page, fileName, variant);
  await expect(
    main.getByText('Hay datos que el sistema no identificó'),
  ).toBeVisible();
  await expect(main.getByText('No se puede confirmar')).toHaveCount(0);
  // El local se sigue identificando por el ID Subway.
  await expect(page.getByLabel(/^Local del archivo/)).toHaveCount(0);
  const confirm = page.getByRole('button', { name: 'Confirmar importación' });
  await expect(confirm).toBeDisabled();
  const select = page.getByLabel(
    `Medio de pago para «${GIFT_LABEL}» (${money(GIFT_AMOUNT)})`,
  );
  // Con valor no se puede omitir.
  await expect(select.locator('option', { hasText: 'Omitir' })).toHaveCount(0);
  const lines = page.getByRole('region', {
    name: 'Medios de pago del archivo',
  });

  // a) Elegir un medio existente.
  await select.selectOption({ label: 'Transferencia' });
  await expect(confirm).toBeEnabled();
  await expect(methodRow(lines, 'Transferencia')).toContainText(
    money(GIFT_AMOUNT),
  );
  await expect(methodRow(lines, 'Transferencia')).toContainText(
    `«${GIFT_LABEL}» · elegido a mano`,
  );
  await expect(lines.getByRole('row').last()).toContainText(
    money(TOTAL + GIFT_AMOUNT),
  );
  await noOverflow(page);
  await capture(page, '05-gift-card-elegir-medio');

  // b) Crear un medio nuevo desde la vista previa.
  await select.selectOption({ label: `Crear medio de pago «${GIFT_LABEL}»` });
  await page.getByLabel('Nombre del medio nuevo').fill(methodName);
  await expect(methodRow(lines, methodName)).toContainText(
    'medio nuevo, se crea al confirmar',
  );
  await expect(confirm).toBeEnabled();
  await noOverflow(page);
  await capture(page, '06-gift-card-crear-medio');
  await confirm.click();
  await expect(main.getByText('Importación confirmada')).toBeVisible();
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: /Detalle de la importación/ }),
  });
  await expect(detail).toContainText(display(date));
  await expect(methodRow(detail, methodName)).toContainText(money(GIFT_AMOUNT));
  await expect(detail).toContainText(money(TOTAL + GIFT_AMOUNT));
  await note(
    info.project.name,
    `\n## Medio con valor no reconocido (copia ficticia del real, ${display(date)})\n\n` +
      `- «N.de Créd.» reemplazada por «${GIFT_LABEL}» ${money(GIFT_AMOUNT)}; total ${money(TOTAL + GIFT_AMOUNT)}. Archivo: ${join(tmpdir(), fileName)}.\n` +
      `- Sin opción «Omitir»; elegir «Transferencia» habilita confirmar; se confirmó creando «${methodName}».`,
  );
  await observed(
    info.project.name,
    'Detalle confirmado',
    detail.getByRole('region').first(),
  );
  // El medio creado queda en el catálogo y recuerda la etiqueta.
  await page.goto('/admin/medios-pago');
  await expect(page.getByRole('main')).toContainText(methodName);
});

test('Calendario de locales: Santa María abre todos los días y el panel marca los días con ventas', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/admin/calendario-locales');
  const select = page.getByRole('combobox', { name: /^Local a revisar/ });
  await expect(async () => {
    await select.selectOption({ label: STORE });
    await expect(
      page.getByRole('heading', { name: 'Configuración semanal · ' + STORE }),
    ).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
  const weekly = section(page, 'Configuración semanal · ' + STORE);
  for (const day of [
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
    'Domingo',
  ])
    await weekly.getByRole('checkbox', { name: day }).check();
  await weekly.getByLabel('Exigir ventas importadas desde').fill('2026-11-01');
  await weekly.getByRole('button', { name: 'Guardar calendario' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Calendario semanal guardado.' }),
  ).toBeVisible();
  await expect(weekly).toContainText('Configurado');
  await expect(weekly).toContainText(display('2026-11-01'));
  await noOverflow(page);
  await capture(page, '07-calendario-santa-maria');

  // Con el calendario, el panel distingue el 05/11 importado de los días
  // que faltan (el calendario en sí no lista días con ventas u operación).
  await page.goto('/admin/panel-ventas');
  const missing = section(page, 'Ventas sin importar');
  const missingRow = (date: string): Locator =>
    missing
      .getByRole('row')
      .filter({ hasText: STORE })
      .filter({ hasText: display(date) });
  await expect(missingRow('2026-11-01')).toContainText('Atrasado');
  await expect(missingRow(BUSINESS_DATE)).toHaveCount(0);
  await expect(missingRow(giftDate('desktop'))).toHaveCount(0);
  await noOverflow(page);
  await capture(page, '08-panel-ventas-sin-importar');
  await note(
    info.project.name,
    `\n## Calendario\n\n- ${STORE}: todos los días, ventas exigidas desde 01-11-2026; guardado y «Configurado».\n` +
      `- Panel «Ventas sin importar»: 01-11-2026 Atrasado; ${display(BUSINESS_DATE)} y ${display(giftDate('desktop'))} no figuran (importados).\n` +
      '- /admin/calendario-locales no muestra qué días tienen ventas u operación (ver defectos).',
  );
});

test('Panel y reportes: ventas del 05/11 separadas de propinas y diferencia', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  operationId = await ensureOperation(request);
  await login(context, baseURL!, adminEmail, adminPassword);

  // Panel del 05/11.
  await page.goto('/admin/panel-ventas?date=' + BUSINESS_DATE);
  await expect(
    page.getByRole('heading', {
      name: 'Resumen del ' + display(BUSINESS_DATE),
    }),
  ).toBeVisible();
  const panel = section(page, 'Resumen por local');
  const summary = isDesktop(page)
    ? panel.getByRole('row').filter({ hasText: STORE })
    : panel.getByRole('article', { name: STORE });
  await expect(summary).toContainText('Importado');
  await expect(summary).toContainText(money(TOTAL));
  await expect(summary).toContainText(money(CARD_TIP));
  await expect(summary).toContainText(money(CASH_TIP));
  await expect(summary).toContainText(money(DIFFERENCE));
  await expect(summary).toContainText(REASON);
  const methods = section(page, 'Ventas por medio de pago')
    .getByRole('row')
    .filter({ hasText: STORE });
  for (const amount of [DEBIT, CASH, CREDIT, TOTAL])
    await expect(methods).toContainText(money(amount));
  // Las propinas no se suman a las ventas.
  await expect(methods).not.toContainText(money(TOTAL + CARD_TIP));
  const differences = section(page, 'Diferencias de efectivo')
    .getByRole('row')
    .filter({ hasText: STORE });
  await expect(differences).toContainText(money(DIFFERENCE));
  await expect(differences).toContainText(REASON);
  await noOverflow(page);
  await capture(page, '09-panel-ventas-05-11');
  await note(
    info.project.name,
    `\n## Panel de ventas ${display(BUSINESS_DATE)}\n`,
  );
  await observed(info.project.name, 'Resumen Santa María', summary);
  await observed(info.project.name, 'Ventas por medio', methods);
  await observed(info.project.name, 'Diferencia', differences);

  // Reportes del 05/11 para Santa María, desde el formulario.
  await page.goto('/admin/reportes-ventas');
  await page.getByLabel('Desde').fill(BUSINESS_DATE);
  await page.getByLabel('Hasta').fill(BUSINESS_DATE);
  await page
    .getByRole('combobox', { name: /^Local/ })
    .selectOption({ label: STORE });
  await page.getByRole('button', { name: 'Generar reporte' }).click();
  const period = `Totales del ${display(BUSINESS_DATE)} al ${display(BUSINESS_DATE)} · ${STORE}`;
  await expect(page.getByRole('heading', { name: period })).toBeVisible();
  const tiles = section(page, period);
  await expect(tiles).toContainText(money(TOTAL));
  await expect(tiles).toContainText(money(CARD_TIP + CASH_TIP));
  const reportMethods = section(page, 'Ventas por medio de pago');
  const reportRow = reportMethods.getByRole('row').filter({ hasText: STORE });
  for (const amount of [DEBIT, CASH, CREDIT, TOTAL])
    await expect(reportRow).toContainText(money(amount));
  await expect(reportMethods).not.toContainText(/propina/i);
  const tips = section(page, 'Propinas y diferencias por local')
    .getByRole('row')
    .filter({ hasText: STORE });
  await expect(tips).toContainText(money(CARD_TIP));
  await expect(tips).toContainText(money(CASH_TIP));
  await expect(tips).toContainText(money(DIFFERENCE));
  const day = section(page, 'Detalle por día')
    .getByRole('row')
    .filter({ hasText: display(BUSINESS_DATE) });
  await expect(day).toContainText('Importado');
  await expect(day).toContainText(money(TOTAL));
  await expect(day).toContainText('Con voucher');
  await expect(
    section(page, 'Diferencias de efectivo')
      .getByRole('row')
      .filter({ hasText: REASON }),
  ).toContainText('Faltante');
  await expect(page.getByRole('main')).not.toContainText(/mercado pago/i);
  await noOverflow(page);
  await capture(page, '10-reportes-ventas-05-11');
  await note(
    info.project.name,
    `\n## Reportes de ventas ${display(BUSINESS_DATE)}\n`,
  );
  await observed(info.project.name, 'Totales', tiles);
  await observed(info.project.name, 'Ventas por medio', reportRow);
  await observed(info.project.name, 'Propinas y diferencias', tips);
  await observed(info.project.name, 'Detalle por día', day);
});

test('Contador: reportes en solo lectura y detalle con voucher, diferencia y ventas del día', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  if (!operationId) operationId = await ensureOperation(request);
  const accountant = await createAccount(request, 'CONTADOR', null);
  await login(context, baseURL!, accountant.email, password);
  await page.goto('/dashboard');
  // Menú lateral en escritorio; barra inferior en móvil.
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Reportes de ventas' })
    .first()
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reportes de ventas' }),
  ).toBeVisible();
  await page.goto(
    `/admin/reportes-ventas?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}&storeId=${storeId}`,
  );
  const days = section(page, 'Detalle por día');
  const day = days.getByRole('row').filter({
    hasText: display(BUSINESS_DATE),
  });
  await expect(day).toContainText(money(TOTAL));
  await expect(day).toContainText('Con voucher');
  await expect(
    days.getByRole('link', { name: /^Ver importación/ }),
  ).toHaveCount(0);
  await noOverflow(page);
  await capture(page, '11-contador-reportes');
  await day.getByRole('link', { name: /^Ver operación diaria/ }).click();
  await expect(page).toHaveURL(
    new RegExp('/admin/reportes-ventas/operaciones/' + operationId + '$'),
  );
  await expect(
    page.getByRole('heading', {
      name: `Operación diaria · ${STORE} · ${display(BUSINESS_DATE)}`,
    }),
  ).toBeVisible();
  const voucher = page.getByRole('img', { name: /^Foto del voucher/ });
  await expect(voucher).toHaveAttribute(
    'src',
    '/api/daily-operations/' + operationId + '/voucher',
  );
  await expect
    .poll(() =>
      voucher.evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  const contrast = section(page, 'Diferencia de efectivo y ventas del día');
  await expect(contrast).toContainText(money(DIFFERENCE));
  await expect(contrast).toContainText('Faltante');
  await expect(contrast).toContainText(REASON);
  for (const amount of [DEBIT, CASH, CREDIT, TOTAL])
    await expect(contrast).toContainText(money(amount));
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
  await noOverflow(page);
  await capture(page, '12-contador-detalle-operacion');
  await note(
    info.project.name,
    `\n## Contador (solo lectura)\n\n- Menú «Reportes de ventas» → ${display(BUSINESS_DATE)} ${STORE}: sin enlace a la importación; detalle /admin/reportes-ventas/operaciones/${operationId} con foto del voucher y sin botones.`,
  );
  await observed(info.project.name, 'Diferencia y ventas del día', contrast);
  for (const path of [
    '/admin/panel-ventas',
    '/admin/importacion-ventas',
    '/admin/calendario-locales',
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  }
});
