import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import writeXlsxFile from 'write-excel-file/node';

// SPRINT-4A-T19: la vista previa permite elegir a mano el local y los medios
// que no se identificaron, con API y PostgreSQL reales. Los Excel sintéticos
// usan un ID Subway y etiquetas propias de cada proyecto. Con
// MRCOMANDA_SAMPLE_XLSX (el informe real del 05/11, que no se versiona) se
// prueba además el caso del PO: Santa María sin ID Subway, «N.de Créd.» en 0
// omitida y 873.260 confirmados.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3343';
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
let adminEmail = '';
let adminPassword = '';
let adminToken = '';
let storeId = '';
let storeName = '';

type Cell = string | number | null;
function row(cells: Record<number, Cell>): Cell[] {
  return Array.from({ length: 7 }, (_, index) => cells[index] ?? null);
}
function letters(length: number): string {
  return Array.from({ length }, () =>
    String.fromCharCode(65 + randomInt(0, 26)),
  ).join('');
}
// Informe con dos medios sin alias: un vale con monto y una nota en 0.
async function report(
  subwayStoreId: string,
  voucher: string,
  note: string,
  debit = 400_000,
): Promise<Buffer> {
  const total = debit + 200_000;
  const rows: Cell[][] = [
    row({ 4: 'Fecha 15/03/2026 - 09:30:00' }),
    row({ 0: 'Informe de Ventas Diario 14/03/2026 - 14/03/2026' }),
    row({
      0: ` - Todas las Empresas  - Todos los puntos de venta - Local: 208 - ${subwayStoreId} - Todos los Sectores  - Toda la banda horaria  - Todos los comprobantes`,
    }),
    row({}),
    row({}),
    row({ 0: 'Período:', 1: '14/03/2026 al 14/03/2026' }),
    row({ 0: 'Horario:', 1: '00:00:00 a 23:59:59' }),
    row({ 0: 'Ventas', 5: total }),
    row({ 0: 'Medios de pago', 5: total, 6: 'Porcentaje' }),
    row({ 0: 'T. DEBITO           ', 5: debit, 6: 50 }),
    row({ 0: 'EFECTIVO            ', 5: 150_000, 6: 25 }),
    row({ 0: voucher, 5: 50_000, 6: 25 }),
    row({ 0: note, 5: 0, 6: 0 }),
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

async function login(
  context: BrowserContext,
  baseURL: string,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email: adminEmail, password: adminPassword },
      })
    ).status(),
  ).toBe(200);
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
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function openImports(page: Page): Promise<undefined> {
  await page.goto('/admin/importacion-ventas');
  // Este estado solo desaparece tras hidratar: evita perder el archivo.
  await expect(page.getByText('Consultando importaciones…')).toHaveCount(0);
}

test.beforeAll(async ({ request }, info) => {
  adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
  adminPassword =
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
  const admin = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(admin.status()).toBe(200);
  adminToken = ((await admin.json()) as { accessToken: string }).accessToken;
  storeName = `Resolución ${info.project.name} ${randomUUID().slice(0, 8)}`;
  // Local activo sin ID Subway: el que se elige a mano.
  const store = await request.post(backend + '/stores', {
    headers: { Authorization: 'Bearer ' + adminToken },
    data: { name: storeName, city: 'Melipilla', address: 'Av. Pruebas 1900' },
  });
  expect(store.status()).toBe(201);
  storeId = ((await store.json()) as { id: string }).id;
});
test.afterAll(async ({ request }) => {
  if (storeId)
    await request.patch(backend + '/stores/' + storeId + '/deactivate', {
      headers: { Authorization: 'Bearer ' + adminToken },
    });
});

test('Elige el local y los medios no identificados, omite la línea en 0 y recuerda la elección', async ({
  page,
  context,
  baseURL,
}, info) => {
  const subwayStoreId = String(randomInt(1_000_000_000, 9_999_999_999));
  const voucher = `VALE ${letters(6)}`;
  const note = `NOTA ${letters(6)}`;
  await login(context, baseURL!);
  await openImports(page);
  const main = page.getByRole('main');
  const confirm = page.getByRole('button', { name: 'Confirmar importación' });

  await upload(
    page,
    'ventas-14-03-2026.xlsx',
    await report(subwayStoreId, voucher, note),
  );
  await expect(
    main.getByText('Hay datos que el sistema no identificó'),
  ).toBeVisible();
  // El rojo «No se puede confirmar» queda para errores reales del archivo.
  await expect(main.getByText('No se puede confirmar')).toHaveCount(0);
  await expect(confirm).toBeDisabled();
  await noOverflow(page);

  const storeSelect = page.getByLabel(
    `Local del archivo (ID Subway ${subwayStoreId})`,
  );
  await storeSelect.selectOption({ label: storeName });
  const rememberStore = page
    .getByRole('checkbox', { name: /Recordar para próximas cargas/ })
    .first();
  await expect(rememberStore).toBeChecked();

  const voucherSelect = page.getByLabel(`Medio de pago para «${voucher}»`);
  await expect(
    voucherSelect.locator('option', { hasText: 'Omitir' }),
  ).toHaveCount(0);
  await voucherSelect.selectOption({ label: 'Transferencia' });
  await expect(confirm).toBeDisabled();
  const noteSelect = page.getByLabel(`Medio de pago para «${note}»`);
  await noteSelect.selectOption({ label: 'Omitir (monto 0)' });
  await expect(confirm).toBeEnabled();

  const lines = page.getByRole('region', {
    name: 'Medios de pago del archivo',
  });
  await expect(lines).toContainText('Transferencia');
  await expect(lines).toContainText('Omitida (monto 0)');
  await expect(lines).toContainText('$600.000');
  await noOverflow(page);
  await confirm.click();
  await expect(main.getByText('Importación confirmada')).toBeVisible();
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: 'Detalle de la importación' }),
  });
  await expect(detail).toContainText(storeName);
  await expect(detail).toContainText('Elegido a mano');
  await expect(detail).toContainText('Resuelto a mano por');
  await expect(detail).toContainText('Omitida (monto 0)');
  await expect(detail).toContainText('Vigente');

  // La siguiente carga del mismo local ya identifica local y vale; la nota
  // omitida no se recuerda y vuelve a pedirse.
  await upload(
    page,
    'ventas-14-03-2026.xlsx',
    await report(subwayStoreId, voucher, note, 410_000),
  );
  await expect(main.getByText(storeName).first()).toBeVisible();
  await expect(page.getByLabel(/Local del archivo/)).toHaveCount(0);
  await expect(page.getByLabel(`Medio de pago para «${voucher}»`)).toHaveCount(
    0,
  );
  await page
    .getByLabel(`Medio de pago para «${note}»`)
    .selectOption({ label: 'Omitir (monto 0)' });
  const correct = page.getByRole('button', { name: 'Confirmar corrección' });
  await expect(correct).toBeDisabled();
  await page.getByRole('checkbox', { name: /Revisé las diferencias/ }).check();
  await expect(correct).toBeEnabled();
  await noOverflow(page);
  const folder = 'output/playwright/sales-imports/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/resolucion-manual.png',
    fullPage: true,
    scale: 'css',
  });
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(main.getByText('No se registraron ventas')).toBeVisible();
});

test('Informe real del 05/11: Santa María, N.de Créd. omitida y 873.260', async ({
  page,
  context,
  baseURL,
}) => {
  const sample = process.env.MRCOMANDA_SAMPLE_XLSX;
  test.skip(!sample, 'Requiere MRCOMANDA_SAMPLE_XLSX con el informe real.');
  test.skip(
    !process.env.COMPOSE_PROJECT_NAME,
    'Requiere COMPOSE_PROJECT_NAME del stack de pruebas.',
  );
  // Reproduce el caso del PO: el local base no tiene asignado su ID Subway.
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? '',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"',
      '--',
      "UPDATE stores SET subway_store_id = NULL WHERE subway_store_id = '72597';",
    ],
    { stdio: 'pipe' },
  );
  await login(context, baseURL!);
  await openImports(page);
  const main = page.getByRole('main');
  await upload(page, 'ventas-06-11-2026.xlsx', await readFile(sample ?? ''));
  await expect(
    main.getByText('Hay datos que el sistema no identificó'),
  ).toBeVisible();
  await page
    .getByLabel('Local del archivo (ID Subway 72597)')
    .selectOption({ label: 'Santa María' });
  // Sin recordar, para que cada proyecto reproduzca el mismo caso.
  await page
    .getByRole('checkbox', { name: /Recordar para próximas cargas/ })
    .first()
    .uncheck();
  await page
    .getByLabel('Medio de pago para «N.de Créd.»')
    .selectOption({ label: 'Omitir (monto 0)' });
  const lines = page.getByRole('region', {
    name: 'Medios de pago del archivo',
  });
  await expect(lines).toContainText('$873.260');
  await noOverflow(page);
  // Si otro proyecto ya lo confirmó, Santa María tiene una vigente para el
  // 05/11: el reemplazo se acepta de forma explícita (y el mismo archivo es
  // idempotente en el servidor).
  const replace = page.getByRole('checkbox', {
    name: /Revisé las diferencias/,
  });
  if (await page.getByText('Corrección de la versión vigente').isVisible())
    await replace.check();
  await page.getByRole('button', { name: /^Confirmar/ }).click();
  await expect(main.getByText(/confirmada/)).toBeVisible();
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: 'Detalle de la importación' }),
  });
  await expect(detail).toContainText('Santa María');
  await expect(detail).toContainText('$873.260');
  await expect(detail).toContainText('N.de Créd.');
});
