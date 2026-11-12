import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// Administración de productos de inventario con API y PostgreSQL reales
// (SPRINT-5-T04). La plantilla (SPRINT-5-T02) carga solo las filas, así que
// los artículos parten pendientes de crear. Cada proyecto crea productos con
// nombres propios.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3011';
const adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
const adminPassword =
  process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';

async function login(
  context: BrowserContext,
  baseURL: string,
  email = adminEmail,
  password = adminPassword,
) {
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
async function ready(page: Page) {
  await page.goto('/admin/productos');
  await expect(page.getByText('Cargando productos…')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(page.getByText(/Productos creados: \d+ de \d+/)).toBeVisible();
}

test('Administrador: pendientes, crear desde una fila, sugerencia, formato, errores, SKU y desactivar', async ({
  page,
  context,
  baseURL,
}, info) => {
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const name = `Producto E2E ${suffix}`;
  const sku = `E2E-${randomUUID().slice(0, 8)}`;
  await login(context, baseURL!);
  await ready(page);

  // Artículos de la plantilla pendientes de crear, en su sección.
  await expect(
    page.getByRole('heading', { name: 'COSTO DE BEBIDAS' }),
  ).toBeVisible();
  await expect(
    page.getByText('Pendiente de crear').filter({ visible: true }).first(),
  ).toBeVisible();
  await noOverflow(page);

  // Crear desde una fila pendiente: nombre y fila quedan preseleccionados.
  const pendingButton = page
    .getByRole('button', { name: /^Crear producto en la fila \d+/ })
    .filter({ visible: true })
    .first();
  const label = (await pendingButton.getAttribute('aria-label')) ?? '';
  const [, rowNumber, printed] =
    /^Crear producto en la fila (\d+), (.+)$/.exec(label) ?? [];
  await pendingButton.click();
  const fromRow = page.getByRole('dialog', { name: 'Crear producto' });
  await expect(fromRow.getByLabel('Nombre', { exact: true })).toHaveValue(
    printed,
  );
  await expect(
    fromRow.getByLabel('Fila de la plantilla').locator('option:checked'),
  ).toHaveText(new RegExp(`^Fila ${rowNumber} `));
  await fromRow.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(
    page.getByText(new RegExp(`creado en la fila ${rowNumber} `)),
  ).toBeVisible();

  // Crear con la sugerencia de la API y caja y paquete por separado, en una
  // sección que todavía tenga una fila <Vacío> libre (la base se reutiliza
  // entre proyectos y corridas).
  const template = (await (
    await context.request.get('/api/products/template')
  ).json()) as { section: string; isEmptyRow: boolean; product: unknown }[];
  const section = template.find(
    (row) => row.isEmptyRow && row.product === null,
  )?.section;
  expect(section).toBeDefined();
  await page
    .getByRole('button', { name: 'Crear producto', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Crear producto' });
  await dialog.getByLabel('Nombre', { exact: true }).fill(name);
  await dialog
    .getByLabel('Nombres alternativos (separados por coma)')
    .fill(`Alias ${suffix}`);
  await dialog.getByLabel('Sección').selectOption(section!);
  await expect(dialog.getByText(/Sugerida: fila \d+/)).toBeVisible();
  await dialog.getByLabel('Contenido por caja').fill('5');
  await dialog.getByLabel('Nombre del paquete').selectOption('bolsa');
  await dialog.getByLabel('Contenido por paquete').fill('2,5');
  await dialog.getByLabel('Paquetes por caja').fill('3');
  await expect(dialog.getByLabel('Contenido por caja')).toHaveValue('5');
  await expect(dialog).toContainText(
    'Ejemplo: 1 caja + 3 bolsas + 2,450 kg = 14,950 kg',
  );
  await noOverflow(page);
  await dialog.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText(`Producto «${name}» creado`)).toBeVisible();
  const created = page
    .getByRole('article', { name })
    .or(page.getByRole('row').filter({ hasText: name }))
    .filter({ visible: true });
  await expect(created).toContainText('Caja 5 kg · 3 bolsas de 2,5 kg');

  // Nombre repetido: el error va junto al campo y se conserva lo escrito.
  await page
    .getByRole('button', { name: 'Crear producto', exact: true })
    .click();
  const again = page.getByRole('dialog', { name: 'Crear producto' });
  await again.getByLabel('Nombre', { exact: true }).fill(name.toUpperCase());
  await again.getByLabel('Sección').selectOption(section!);
  await again.getByLabel('Contenido por paquete').fill('1,25');
  await again.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(again.getByText(/Ya existe un producto llamado/)).toBeVisible();
  await expect(again.getByLabel('Nombre', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(again.getByLabel('Contenido por paquete')).toHaveValue('1,25');
  await again.getByRole('button', { name: 'Cancelar' }).click();

  // Editar: SKU del proveedor; se busca por SKU y sale del filtro «Sin SKU».
  await created.getByRole('button', { name: `Editar ${name}` }).click();
  const edit = page.getByRole('dialog', { name: 'Editar producto' });
  await expect(edit.getByLabel('Contenido por paquete')).toHaveValue('2,5');
  await edit.getByLabel('SKU del proveedor (opcional)').fill(sku);
  await edit.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByText(`Producto «${name}» actualizado.`)).toBeVisible();
  await page.getByLabel('Buscar por nombre o SKU').fill(sku.toLowerCase());
  await expect(created).toHaveCount(1);
  await page.getByLabel(/Sin SKU/).check();
  await expect(created).toHaveCount(0);
  await page.getByLabel(/Sin SKU/).uncheck();

  // Desactivar con confirmación.
  await created.getByRole('button', { name: `Desactivar ${name}` }).click();
  const confirm = page.getByRole('dialog', { name: 'Desactivar producto' });
  await expect(confirm).toContainText('dejará de aparecer en las tomas nuevas');
  await confirm
    .getByRole('button', { name: 'Desactivar', exact: true })
    .click();
  await expect(page.getByText(`Producto «${name}» desactivado.`)).toBeVisible();
  await page.getByLabel('Buscar por nombre o SKU').fill(sku);
  await expect(created).toHaveCount(0);
  await page.getByLabel('Estado').selectOption('inactive');
  await expect(created).toContainText('Inactivo');
  await noOverflow(page);

  const folder = 'output/playwright/products/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.getByLabel('Buscar por nombre o SKU').fill('');
  await page.getByLabel('Estado').selectOption('active');
  await page.screenshot({
    path: folder + '/productos.png',
    fullPage: true,
    scale: 'css',
  });
});

test('El supervisor no ve ni usa la administración de productos', async ({
  page,
  context,
  baseURL,
}) => {
  // Supervisor sintético creado por la API con el administrador.
  const admin = await context.request.post(backend + '/auth/login', {
    data: { email: adminEmail, password: adminPassword },
  });
  const { accessToken } = (await admin.json()) as { accessToken: string };
  const headers = { Authorization: `Bearer ${accessToken}` };
  const stores = (await (
    await context.request.get(backend + '/stores', { headers })
  ).json()) as { id: string }[];
  const email = `supervisor-${randomUUID()}@e2e.invalid`;
  const password = `Clave-${randomUUID().slice(0, 12)}`;
  expect(
    (
      await context.request.post(backend + '/users', {
        headers,
        data: {
          email,
          password,
          firstName: 'Supervisor',
          lastName: 'E2E',
          roleCode: 'SUPERVISOR',
          storeId: stores[0].id,
        },
      })
    ).status(),
  ).toBe(201);

  await login(context, baseURL!, email, password);
  await page.goto('/admin/productos');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden/);
  await expect(page.getByRole('link', { name: 'Productos' })).toHaveCount(0);
  expect(
    (
      await context.request.post('/api/products', {
        headers: { Origin: baseURL! },
        data: { name: 'X', section: 'Y', unit: 'KG' },
      })
    ).status(),
  ).toBe(403);
  expect((await context.request.get('/api/products')).status()).toBe(200);

  await context.request.post('/api/auth/logout', {
    headers: { Origin: baseURL! },
  });
  await page.goto('/admin/productos');
  await expect(page).toHaveURL(/\/login|session-expired/);
});
