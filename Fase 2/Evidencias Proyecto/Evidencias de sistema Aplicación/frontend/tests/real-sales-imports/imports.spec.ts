import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import writeXlsxFile from 'write-excel-file/node';

// Importación de ventas con API y PostgreSQL reales (SPRINT-4R-T11). Los
// Excel son ficticios y se generan aquí; cada proyecto usa su propio local.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3343';
const password = 'Importacion-test-2026!';
let adminEmail = '';
let adminPassword = '';
let adminToken = '';
let supervisorEmail = '';
let storeId = '';
let storeName = '';
let storeCode = '';
const accountIds: string[] = [];

type Cell = string | number | null;
interface ReportOptions {
  store?: string;
  cash?: number;
  debit?: number;
  declaredTotal?: number;
}
function row(cells: Record<number, Cell>): Cell[] {
  return Array.from({ length: 7 }, (_, index) => cells[index] ?? null);
}
// Misma estructura del Informe de Ventas Diario, con datos inventados.
async function report(options: ReportOptions = {}): Promise<Buffer> {
  const cash = options.cash ?? 150_000;
  const debit = options.debit ?? 400_000;
  const total = cash + debit;
  const declared = options.declaredTotal ?? total;
  const rows: Cell[][] = [
    row({ 4: 'Fecha 15/03/2026 - 09:30:00' }),
    row({ 0: 'Informe de Ventas Diario 14/03/2026 - 14/03/2026' }),
    row({
      0: ` - Todas las Empresas  - Todos los puntos de venta - Local: ${options.store ?? storeCode} - Todos los Sectores  - Toda la banda horaria  - Todos los comprobantes`,
    }),
    row({}),
    row({}),
    row({ 0: 'Período:', 1: '14/03/2026 al 14/03/2026' }),
    row({ 0: 'Horario:', 1: '00:00:00 a 23:59:59' }),
    row({ 0: 'Ventas', 5: declared }),
    row({ 0: 'Medios de pago', 5: declared, 6: 'Porcentaje' }),
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
const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function login(
  context: BrowserContext,
  baseURL: string,
  email: string,
  secret: string,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: secret },
      })
    ).status(),
  ).toBe(200);
}
async function upload(
  page: Page,
  name: string,
  buffer: Buffer,
  mimeType = XLSX,
): Promise<undefined> {
  await page.getByLabel('Archivo Excel').setInputFiles({
    name,
    mimeType,
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

test.beforeAll(async ({ request }, info) => {
  adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
  adminPassword =
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';
  const admin = await request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  expect(admin.status()).toBe(200);
  adminToken = ((await admin.json()) as { accessToken: string }).accessToken;
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID();
  storeName = 'Importación ' + suffix;
  const store = await request.post(backend + '/stores', {
    headers,
    data: { name: storeName, city: 'Melipilla', address: 'Av. Pruebas 1100' },
  });
  expect(store.status()).toBe(201);
  storeId = idOf(await store.json());
  supervisorEmail = 'supervisor-' + suffix + '@example.test';
  const supervisor = await request.post(backend + '/users', {
    headers,
    data: {
      email: supervisorEmail,
      password,
      firstName: 'Sofia',
      lastName: 'Prueba T11',
      roleCode: 'SUPERVISOR',
      storeId,
    },
  });
  expect(supervisor.status()).toBe(201);
  accountIds.push(idOf(await supervisor.json()));
  // Las equivalencias de locales no tienen API: se crean directo en la base.
  storeCode = `${randomInt(100, 999)} - ${randomInt(10_000, 99_999)}`;
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? 'sprint4r-t11',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c "$1"',
      '--',
      `INSERT INTO store_external_codes (system, external_code, store_id, updated_at) VALUES ('MRCOMANDA', '${storeCode}', '${storeId}', now());`,
    ],
    { stdio: 'pipe' },
  );
});
test.afterAll(async ({ request }) => {
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const id of accountIds)
    await request.patch(backend + '/users/' + id + '/deactivate', { headers });
  if (storeId)
    await request.patch(backend + '/stores/' + storeId + '/deactivate', {
      headers,
    });
});

test('Administrador: inválidos, sin resolver, confirmación, duplicado y corrección', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!, adminEmail, adminPassword);
  await page.goto('/admin/importacion-ventas');
  await expect(
    page.getByRole('heading', { name: 'Subir Excel de MrComanda' }),
  ).toBeVisible();
  // Este estado solo desaparece tras hidratar: evita perder el primer archivo.
  await expect(page.getByText('Consultando importaciones…')).toHaveCount(0);
  const main = page.getByRole('main');
  const confirmButton = page.getByRole('button', {
    name: 'Confirmar importación',
  });

  // Formato inválido: se rechaza en el navegador.
  await upload(page, 'ventas.csv', Buffer.from('a,b'), 'text/csv');
  await expect(main.getByText('formato .xlsx')).toBeVisible();

  // Con extensión .xlsx pero sin contenido válido: lo rechaza el servidor.
  await upload(page, 'dañado.xlsx', Buffer.from('no es un excel'));
  await expect(main.getByRole('alert').first()).toBeVisible();
  await expect(confirmButton).toHaveCount(0);

  // El total no cuadra: el mensaje explica el problema y no permite confirmar.
  await upload(
    page,
    'ventas-15-03-2026.xlsx',
    await report({ declaredTotal: 999 }),
  );
  await expect(main.getByRole('alert').first()).toContainText(/total|suma/i);
  await expect(confirmButton).toHaveCount(0);

  // Local desconocido: explica cómo resolverlo y no guarda nada.
  await upload(
    page,
    'ventas-15-03-2026.xlsx',
    await report({ store: '000 - 00000' }),
  );
  await expect(main.getByText('no se guardó nada')).toBeVisible();
  await expect(main.getByText('Sin configurar (000 - 00000)')).toBeVisible();
  await expect(confirmButton).toHaveCount(0);
  await noOverflow(page);

  // Válido: muestra local, fecha, emisión, medios, total y la fecha del nombre.
  const first = await report();
  await upload(page, 'ventas-15-03-2026.xlsx', first);
  const preview = page.getByRole('region', {
    name: 'Medios de pago del archivo',
  });
  await expect(preview).toContainText('$400.000');
  await expect(preview).toContainText('$150.000');
  await expect(preview).toContainText('$550.000');
  await expect(main.getByText(storeName).first()).toBeVisible();
  await expect(main.getByText('14-03-2026').first()).toBeVisible();
  await expect(
    main.getByText('El nombre del archivo indica 15-03-2026', { exact: false }),
  ).toBeVisible();
  await noOverflow(page);
  await confirmButton.click();
  await expect(main.getByText('Importación confirmada')).toBeVisible();
  const detail = page.locator('section', {
    has: page.getByRole('heading', { name: 'Detalle de la importación' }),
  });
  await expect(detail).toContainText('ventas-15-03-2026.xlsx');
  await expect(detail).toContainText('Vigente');

  // Duplicado idéntico: informa y no crea otra versión.
  await upload(page, 'ventas-15-03-2026.xlsx', first);
  await expect(
    main.getByText('Este archivo ya estaba importado'),
  ).toBeVisible();
  await expect(confirmButton).toHaveCount(0);

  // Corrección: muestra diferencias y exige aceptar el reemplazo.
  await upload(page, 'ventas-14-03-2026.xlsx', await report({ cash: 160_000 }));
  const differences = page.getByRole('region', {
    name: 'Diferencias contra la versión vigente',
  });
  await expect(differences).toContainText('$150.000');
  await expect(differences).toContainText('$160.000');
  await expect(differences).toContainText('+$10.000');
  await expect(
    main.getByText('El nombre del archivo indica', { exact: false }),
  ).toHaveCount(0);
  const correct = page.getByRole('button', { name: 'Confirmar corrección' });
  await expect(correct).toBeDisabled();
  await noOverflow(page);
  await page.getByRole('checkbox', { name: /Revisé las diferencias/ }).check();
  await correct.click();
  await expect(main.getByText('La versión 2 quedó vigente')).toBeVisible();
  await expect(detail).toContainText('ventas-14-03-2026.xlsx');
  await expect(detail).toContainText('Reemplazada');
  await noOverflow(page);
  const folder = 'output/playwright/sales-imports/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/importacion.png',
    fullPage: true,
    scale: 'css',
  });

  // Descartar una vista previa no registra ventas.
  await upload(page, 'ventas-14-03-2026.xlsx', await report({ cash: 170_000 }));
  await expect(
    page.getByRole('button', { name: 'Confirmar corrección' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Descartar' }).click();
  await expect(main.getByText('No se registraron ventas')).toBeVisible();
});

test('Otros roles: sin enlace, ruta directa redirigida y BFF con 403', async ({
  page,
  context,
  baseURL,
}) => {
  await login(context, baseURL!, supervisorEmail, password);
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Importar ventas' })).toHaveCount(
    0,
  );
  await page.goto('/admin/importacion-ventas');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden/);
  expect((await context.request.get('/api/sales-imports')).status()).toBe(403);
  expect(
    (
      await context.request.post('/api/sales-imports/preview', {
        headers: { Origin: baseURL! },
        multipart: {
          file: { name: 'a.xlsx', mimeType: XLSX, buffer: await report() },
        },
      })
    ).status(),
  ).toBe(403);
});
