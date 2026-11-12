import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// Administración de productos de inventario con API y PostgreSQL reales
// (SPRINT-5-T04). La plantilla (SPRINT-5-T02) carga solo las filas, así que
// los artículos parten pendientes de crear. Cada proyecto crea productos con
// nombres propios. SPRINT-5-T15 agrega corregir el texto de las filas sin
// producto y liberar la fila de un producto desactivado.
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
interface Row {
  id: string;
  position: number;
  kind: string;
  printedText: string | null;
  section: string;
  isEmptyRow: boolean;
  product: { id: string; name: string } | null;
}
async function template(context: BrowserContext): Promise<Row[]> {
  const response = await context.request.get('/api/products/template');
  expect(response.status()).toBe(200);
  return (await response.json()) as Row[];
}
// Escrituras por el BFF con la cookie del administrador (mismo origen).
async function patch(
  context: BrowserContext,
  baseURL: string,
  path: string,
  data?: unknown,
) {
  return context.request.patch('/api/products' + path, {
    headers: { Origin: baseURL },
    ...(data === undefined ? {} : { data }),
  });
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

test('Administrador: corrige el texto de filas sin producto y libera la fila de un desactivado', async ({
  page,
  context,
  baseURL,
}, info) => {
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const origin = baseURL!;
  await login(context, origin);
  await ready(page);
  const visible = (name: string | RegExp) =>
    page.getByRole('button', { name }).filter({ visible: true }).first();

  // Fila pendiente: el texto se valida en el navegador y la posición no
  // cambia al corregirlo.
  const fixButton = visible(/^Corregir texto de la fila \d+, (?!<Vacío>)/);
  const [, position, printed] =
    /^Corregir texto de la fila (\d+), (.+)$/.exec(
      (await fixButton.getAttribute('aria-label')) ?? '',
    ) ?? [];
  await fixButton.click();
  const fix = page.getByRole('dialog', { name: 'Corregir texto de la fila' });
  const text = fix.getByLabel('Texto de la fila (columna ARTÍCULO)');
  await expect(text).toHaveValue(printed);
  await expect(fix).toContainText(`Fila ${position} de «`);
  await text.fill('   ');
  await fix.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(fix.getByText(/Ingresa el texto de la fila/)).toBeVisible();
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  const renamed = `Artículo E2E ${suffix}`;
  await text.fill(renamed);
  await noOverflow(page);
  await fix.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(
    page.getByText(`Fila ${position} corregida: «${renamed}».`),
  ).toBeVisible();
  const row = (await template(context)).find(
    (item) => item.printedText === renamed,
  );
  expect(row?.position).toBe(Number(position));
  await expect(
    page
      .getByRole('article', { name: renamed })
      .or(page.getByRole('row').filter({ hasText: renamed }))
      .filter({ visible: true }),
  ).toContainText('Pendiente de crear');

  // 409: otro administrador ocupó la fila mientras se corregía. El error va
  // junto al campo y lo escrito se conserva.
  await visible(`Corregir texto de la fila ${position}, ${renamed}`).click();
  await text.fill(`${renamed} bis`);
  const occupied = await context.request.post('/api/products', {
    headers: { Origin: origin },
    data: {
      name: `Ocupa fila E2E ${suffix}`,
      section: row!.section,
      templateRowId: row!.id,
      unit: 'KG',
    },
  });
  expect(occupied.status()).toBe(201);
  await fix.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(fix.getByText(/La fila tiene un producto/)).toBeVisible();
  await expect(text).toHaveAttribute('aria-invalid', 'true');
  await expect(text).toHaveValue(`${renamed} bis`);
  await fix.getByRole('button', { name: 'Cancelar' }).click();

  // Fila <Vacío>: se lista en su propio estado; se corrige y vuelve a
  // quedar libre escribiendo «vacío».
  await page.getByLabel('Estado').selectOption('empty');
  const emptyButton = visible(/^Corregir texto de la fila \d+, <Vacío>$/);
  const emptyPosition = /fila (\d+),/.exec(
    (await emptyButton.getAttribute('aria-label')) ?? '',
  )?.[1];
  await expect(
    page
      .getByText('Fila libre', { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await emptyButton.click();
  await expect(text).toHaveValue('<Vacío>');
  const reused = `Fila E2E ${suffix}`;
  await text.fill(reused);
  await fix.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(
    page.getByText(`Fila ${emptyPosition} corregida: «${reused}».`),
  ).toBeVisible();
  await page.getByLabel('Estado').selectOption('pending');
  await visible(
    `Corregir texto de la fila ${emptyPosition}, ${reused}`,
  ).click();
  await text.fill('vacío');
  await fix.getByRole('button', { name: 'Guardar texto' }).click();
  await expect(
    page.getByText(new RegExp(`La fila ${emptyPosition} de .+ quedó libre`)),
  ).toBeVisible();
  expect(
    (await template(context)).find(
      (item) => item.position === Number(emptyPosition),
    )?.isEmptyRow,
  ).toBe(true);

  // Liberar la fila de un producto desactivado, con confirmación.
  const name = `Liberar E2E ${suffix}`;
  const free = (await template(context)).find(
    (item) => item.kind === 'ITEM' && item.product === null,
  )!;
  const createdResponse = await context.request.post('/api/products', {
    headers: { Origin: origin },
    data: { name, section: free.section, templateRowId: free.id, unit: 'KG' },
  });
  expect(createdResponse.status()).toBe(201);
  const product = (await createdResponse.json()) as { id: string };
  await ready(page);
  await page.getByLabel('Buscar por nombre o SKU').fill(name);
  const card = page
    .getByRole('article', { name })
    .or(page.getByRole('row').filter({ hasText: name }))
    .filter({ visible: true });
  await expect(card).toContainText('Activo');
  await expect(
    card.getByRole('button', { name: `Liberar la fila de ${name}` }),
  ).toHaveCount(0);
  expect(
    (await patch(context, origin, `/${product.id}/deactivate`)).status(),
  ).toBe(200);
  await ready(page);
  await page.getByLabel('Buscar por nombre o SKU').fill(name);
  await page.getByLabel('Estado').selectOption('inactive');
  await card
    .getByRole('button', { name: `Liberar la fila de ${name}` })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Liberar fila' });
  await expect(confirm).toContainText(
    `La fila ${free.position} de «${free.section}» quedará libre`,
  );
  await noOverflow(page);

  // 409: lo reactivaron mientras se confirmaba. El motivo va en la
  // confirmación.
  expect(
    (await patch(context, origin, `/${product.id}/reactivate`)).status(),
  ).toBe(200);
  await confirm.getByRole('button', { name: 'Liberar fila' }).click();
  await expect(confirm.getByRole('alert')).toContainText(
    `Desactiva «${name}» antes de liberar su fila`,
  );
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  expect(
    (await patch(context, origin, `/${product.id}/deactivate`)).status(),
  ).toBe(200);
  await ready(page);
  await page.getByLabel('Buscar por nombre o SKU').fill(name);
  await page.getByLabel('Estado').selectOption('inactive');
  await card
    .getByRole('button', { name: `Liberar la fila de ${name}` })
    .click();
  await confirm.getByRole('button', { name: 'Liberar fila' }).click();
  await expect(
    page.getByText(
      `Fila ${free.position} liberada. «${name}» quedó en «Sin fila en la plantilla».`,
    ),
  ).toBeVisible();
  await page.getByLabel('Buscar por nombre o SKU').fill(name);
  await page.getByLabel('Estado').selectOption('inactive');
  await expect(
    page.getByRole('region', { name: 'Sin fila en la plantilla', exact: true }),
  ).toContainText(name);
  await expect(
    card.getByRole('button', { name: `Liberar la fila de ${name}` }),
  ).toHaveCount(0);
  expect(
    (await template(context)).find((item) => item.id === free.id)?.product,
  ).toBeNull();
  await noOverflow(page);

  // El BFF solo expone las dos rutas, con mismo origen y lista blanca.
  const rows = `/template/rows/${free.id}`;
  for (const [data, status] of [
    [{ printedText: '' }, 400],
    [{ printedText: 'x'.repeat(121) }, 400],
    [{ printedText: 'Lata', position: 1 }, 400],
  ] as const)
    expect((await patch(context, origin, rows, data)).status()).toBe(status);
  expect(
    (
      await context.request.patch('/api/products' + rows, {
        data: { printedText: 'Lata' },
      })
    ).status(),
  ).toBe(403);
  expect((await patch(context, origin, rows + '/other', {})).status()).toBe(
    404,
  );
  expect(
    (await patch(context, origin, '/template/rows/no-uuid/release')).status(),
  ).toBe(404);
  expect(
    (
      await context.request.post('/api/products' + rows + '/release', {
        headers: { Origin: origin },
      })
    ).status(),
  ).toBe(404);

  const folder = 'output/playwright/products/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/productos-sin-fila.png',
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
  // Tampoco corrige el texto ni libera filas de la plantilla (SPRINT-5-T15).
  const [first] = await template(context);
  expect(
    (
      await patch(context, baseURL!, `/template/rows/${first.id}`, {
        printedText: 'Supervisor',
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await patch(context, baseURL!, `/template/rows/${first.id}/release`)
    ).status(),
  ).toBe(403);

  await context.request.post('/api/auth/logout', {
    headers: { Origin: baseURL! },
  });
  await page.goto('/admin/productos');
  await expect(page).toHaveURL(/\/login|session-expired/);
});
