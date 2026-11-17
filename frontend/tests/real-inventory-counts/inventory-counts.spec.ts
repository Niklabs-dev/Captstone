import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { readXlsx } from '../helpers/xlsx';

// Revisión y descarga de tomas de inventario con API y PostgreSQL reales
// (SPRINT-5-T09). Cada proyecto crea su local, su supervisor y dos productos
// (uno que se cuenta y otro que queda «Sin contar»), porque un local admite
// una sola toma En curso y la prueba no depende del catálogo que ya tenga la
// base: pasa igual en la primera corrida sobre una base limpia
// (SPRINT-5-T18). Al terminar desactiva los productos, los usuarios y el
// local que creó, como la suite de SPRINT-5-T07. Las tomas no se pueden
// borrar (la base las protege): quedan en el local desactivado de la base
// exclusiva de pruebas.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3011';
const adminEmail = process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl';
const adminPassword =
  process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion';

// Lo que creó la prueba en curso, para desactivarlo al terminar.
interface Created {
  admin: Record<string, string> | null;
  productIds: string[];
  userIds: string[];
  storeId: string | null;
}
const nothingCreated = (): Created => ({
  admin: null,
  productIds: [],
  userIds: [],
  storeId: null,
});
let created = nothingCreated();

// Primero los productos y los usuarios: un local con usuarios activos no se
// puede desactivar.
test.afterEach(async ({ request }) => {
  const { admin, productIds, userIds, storeId } = created;
  created = nothingCreated();
  if (!admin) return;
  const deactivate = async (path: string) => {
    const response = await request.patch(`${backend}${path}/deactivate`, {
      headers: admin,
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  for (const productId of productIds)
    await deactivate(`/products/${productId}`);
  for (const userId of userIds) await deactivate(`/users/${userId}`);
  if (storeId) await deactivate(`/stores/${storeId}`);
});

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
async function token(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<Record<string, string>> {
  const response = await request.post(backend + '/auth/login', {
    data: { email, password },
  });
  expect(response.status()).toBe(200);
  const { accessToken } = (await response.json()) as { accessToken: string };
  return { Authorization: `Bearer ${accessToken}` };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function createUser(
  request: APIRequestContext,
  admin: Record<string, string>,
  roleCode: string,
  storeId?: string,
): Promise<{ email: string; password: string }> {
  const email = `${roleCode.toLowerCase()}-${randomUUID()}@e2e.invalid`;
  const password = `Clave-${randomUUID().slice(0, 12)}`;
  const response = await request.post(backend + '/users', {
    headers: admin,
    data: {
      email,
      password,
      firstName: roleCode === 'SUPERVISOR' ? 'Sofía' : 'Persona',
      lastName: 'E2E',
      roleCode,
      ...(storeId ? { storeId } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  created.userIds.push(((await response.json()) as { id: string }).id);
  return { email, password };
}
interface Row {
  id: string;
  kind: string;
  section: string;
  isEmptyRow: boolean;
  product: { id: string } | null;
}
async function createProduct(
  request: APIRequestContext,
  admin: Record<string, string>,
  row: Row,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await request.post(backend + '/products', {
    headers: admin,
    data: {
      sku: null,
      alternativeNames: [],
      ...data,
      section: row.section,
      templateRowId: row.id,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { id } = (await response.json()) as { id: string };
  created.productIds.push(id);
  return id;
}

test('Administrador: filtra, revisa una toma en curso y descarga la finalizada', async ({
  page,
  context,
  baseURL,
}, info) => {
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const { request } = context;
  const admin = await token(request, adminEmail, adminPassword);
  created.admin = admin;

  // Local, supervisor y productos propios de este proyecto.
  const storeName = `Local Inventario ${suffix}`;
  const storeResponse = await request.post(backend + '/stores', {
    headers: admin,
    data: { name: storeName, city: 'Melipilla', address: 'Calle E2E 123' },
  });
  expect(storeResponse.status(), await storeResponse.text()).toBe(201);
  const store = (await storeResponse.json()) as { id: string };
  created.storeId = store.id;
  const supervisor = await createUser(request, admin, 'SUPERVISOR', store.id);
  const rows = (await (
    await request.get(backend + '/products/template', { headers: admin })
  ).json()) as Row[];
  const free = rows.filter(
    (row) => row.kind === 'ITEM' && row.isEmptyRow && !row.product,
  );
  expect(
    free.length,
    'La plantilla necesita dos filas <Vacío> libres',
  ).toBeGreaterThanOrEqual(2);
  const productName = `Carne E2E ${suffix}`;
  const productId = await createProduct(request, admin, free[0], {
    name: productName,
    unit: 'KG',
    packageName: 'bolsa',
    packagesPerBox: 2,
    packageContent: '2.500',
    boxContent: '5.000',
    looseOnly: false,
  });
  // Producto propio que nadie cuenta: la prueba no depende de otros
  // productos activos de la base para mostrar «Sin contar».
  const pendingName = `Pendiente E2E ${suffix}`;
  await createProduct(request, admin, free[1], {
    name: pendingName,
    unit: 'KG',
    packageName: null,
    packagesPerBox: null,
    packageContent: null,
    boxContent: null,
    looseOnly: true,
  });

  // El supervisor inicia la toma y cuenta 1 caja + 3 bolsas + 2,450 kg.
  const sup = await token(request, supervisor.email, supervisor.password);
  const started = await request.post(backend + '/inventory-counts', {
    headers: sup,
    data: {},
  });
  expect(started.status(), await started.text()).toBe(201);
  const count = (await started.json()) as { id: string; countDate: string };
  expect(
    (
      await request.put(
        `${backend}/inventory-counts/${count.id}/lines/${productId}`,
        {
          headers: sup,
          data: { boxes: 1, packages: 3, looseQuantity: '2.450' },
        },
      )
    ).status(),
  ).toBe(200);

  await login(context, baseURL!);
  await page.goto('/admin/inventarios');
  await expect(
    page.getByRole('heading', { name: 'Tomas de inventario', level: 1 }),
  ).toBeVisible();
  // En escritorio el enlace está en la barra lateral; en móvil, bajo «Más».
  if (info.project.name === 'desktop')
    await expect(
      page.getByRole('link', { name: 'Inventarios', exact: true }),
    ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Filtrar tomas' }),
  ).toBeVisible();

  // Filtrar por el local: la toma aparece En curso.
  await page.locator('#count-store').selectOption(store.id);
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(new RegExp(`storeId=${store.id}`));
  const [year, month, day] = count.countDate.split('-');
  const title = `${storeName}, ${day}-${month}-${year}`;
  const card = page.getByRole('article', { name: title });
  const tableRow = page.getByRole('row').filter({ hasText: storeName });
  const entry = card.or(tableRow).filter({ visible: true });
  await expect(entry).toContainText('En curso');
  await expect(entry).toContainText('Sofía E2E');
  await noOverflow(page);

  // El filtro de estado Finalizado la deja fuera: estado vacío.
  await page.goto(`/admin/inventarios?storeId=${store.id}&status=CONFIRMED`);
  await expect(
    page.getByText('No hay tomas de inventario con estos filtros.'),
  ).toBeVisible();
  // Un rango invertido no consulta y lo explica.
  await page.goto('/admin/inventarios?from=2026-11-30&to=2026-11-01');
  await expect(
    page.getByRole('alert').filter({ hasText: 'posterior' }),
  ).toBeVisible();

  // Detalle en curso: avance, sin descarga; el BFF también responde 409.
  await page.goto(`/admin/inventarios/${count.id}`);
  await expect(
    page.getByRole('heading', { name: storeName, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText(/^1 de \d+ productos? contados?$/).first(),
  ).toBeVisible();
  await expect(page.getByText('La toma sigue en curso')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Descargar Excel' }),
  ).toHaveCount(0);
  expect(
    (await request.get(`/api/inventory-counts/${count.id}/export`)).status(),
  ).toBe(409);
  await noOverflow(page);

  // El supervisor finaliza; el administrador ve lo contado y descarga.
  const finalized = await request.post(
    `${backend}/inventory-counts/${count.id}/finalize`,
    { headers: sup },
  );
  expect(finalized.status(), await finalized.text()).toBe(200);
  await page.reload();
  await expect(
    page.getByText('Finalizado').filter({ visible: true }).first(),
  ).toBeVisible();
  const line = page
    .getByRole('article', { name: productName })
    .or(page.getByRole('row').filter({ hasText: productName }))
    .filter({ visible: true });
  await expect(line).toContainText('1 caja');
  await expect(line).toContainText('3 bolsas');
  await expect(line).toContainText('2,450 kg');
  await expect(line).toContainText('14,950 kg');
  const pendingLine = page
    .getByRole('article', { name: pendingName })
    .or(page.getByRole('row').filter({ hasText: pendingName }))
    .filter({ visible: true });
  await expect(pendingLine).toContainText('Sin contar');
  await expect(pendingLine).not.toContainText('kg');
  await noOverflow(page);

  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar Excel' }).click();
  const file = await pending;
  expect(file.suggestedFilename()).toBe(
    `inventario-local-inventario-${suffix.toLowerCase()}-${day}-${month}-${year}.xlsx`,
  );
  const folder = `output/playwright/inventory-counts/${info.project.name}`;
  await mkdir(folder, { recursive: true });
  const saved = `${folder}/${file.suggestedFilename()}`;
  await file.saveAs(saved);
  const [sheet] = readXlsx(await readFile(saved));
  expect(sheet.name).toBe('Inventario');
  const counted = sheet.rows.find((row) => row[0] === productName);
  expect(counted, 'El producto contado está en el Excel').toBeTruthy();
  // B cajas, C cajas × caja, D paquetes, E paquetes × paquete, F suelta, G total.
  expect(counted!.slice(1, 7)).toEqual([1, 5, 3, 7.5, 2.45, 14.95]);
  await expect(
    page.getByRole('status').filter({ hasText: 'Se descargó' }),
  ).toBeVisible();
});

test('Supervisor, contador y trabajador no entran a la revisión de inventarios', async ({
  page,
  context,
  baseURL,
}) => {
  const { request } = context;
  const admin = await token(request, adminEmail, adminPassword);
  created.admin = admin;
  // Un local activo: los de corridas anteriores quedan desactivados.
  const stores = (await (
    await request.get(backend + '/stores?isActive=true', { headers: admin })
  ).json()) as { id: string }[];
  const someId = randomUUID();
  for (const role of ['SUPERVISOR', 'CONTADOR', 'TRABAJADOR']) {
    const user = await createUser(
      request,
      admin,
      role,
      role === 'CONTADOR' ? undefined : stores[0].id,
    );
    await login(context, baseURL!, user.email, user.password);
    for (const path of ['/admin/inventarios', `/admin/inventarios/${someId}`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/reason=forbidden/);
    }
    await expect(page.getByRole('link', { name: 'Inventarios' })).toHaveCount(
      0,
    );
    expect(
      (await request.get(`/api/inventory-counts/${someId}/export`)).status(),
    ).toBe(403);
    await context.clearCookies();
  }
});
