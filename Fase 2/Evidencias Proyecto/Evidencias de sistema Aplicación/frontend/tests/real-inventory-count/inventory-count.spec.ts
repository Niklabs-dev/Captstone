import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';
import { tipBusinessDate } from '../../src/lib/tips';

// Toma de inventario del supervisor con API y PostgreSQL reales
// (SPRINT-5-T07). Cada proyecto crea su local, su supervisor y tres
// productos con nombres propios en filas libres de la plantilla; al terminar
// desactiva los productos, el supervisor y el local. Las tomas no se pueden
// borrar (la base las protege): quedan en el local desactivado de la base
// exclusiva de pruebas.
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3347';
const password = 'Inventario-test-2026!';
let adminToken = '';
let storeId = '';
let supervisor = { id: '', email: '' };
const productIds: string[] = [];
let pendingSection = '';
let names = { fajita: '', bebida: '', lechuga: '', pending: '', suffix: '' };

function id(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
function chileDate(offsetDays = 0): string {
  return tipBusinessDate(new Date(Date.now() + offsetDays * 86_400_000));
}
function display(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}
async function login(
  context: BrowserContext,
  baseURL: string,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email: supervisor.email, password },
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
async function ready(page: Page): Promise<undefined> {
  await expect(page.getByText('Cargando la toma de inventario…')).toHaveCount(
    0,
    { timeout: 30_000 },
  );
}
test.describe.configure({ mode: 'serial' });

// Avance «Contados X de Y» del encabezado de la toma.
async function progress(
  page: Page,
  counted: number,
  total: number,
): Promise<undefined> {
  const bar = page.getByRole('progressbar', { name: 'Avance de la toma' });
  await expect(bar).toHaveAttribute('aria-valuenow', String(counted));
  await expect(bar).toHaveAttribute('aria-valuemax', String(total));
  await expect(
    page.getByText(`Contados ${counted} de ${total}`).first(),
  ).toBeVisible();
}
function card(page: Page, name: string): Locator {
  return page.getByRole('article', { name, exact: true });
}
async function shot(page: Page, project: string, name: string) {
  const folder = 'output/playwright/inventory-count/' + project;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: `${folder}/${name}.png`,
    fullPage: true,
    scale: 'css',
  });
}
async function bff(
  request: APIRequestContext,
  baseURL: string,
  method: 'POST' | 'PUT',
  path: string,
  data?: unknown,
) {
  return request.fetch('/api/inventory-counts' + path, {
    method,
    headers: { Origin: baseURL },
    ...(data === undefined ? {} : { data }),
  });
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
  const suffix = `${info.project.name}-${randomUUID().slice(0, 6)}`;
  const store = await request.post(backend + '/stores', {
    headers,
    data: {
      name: 'Inventario ' + suffix,
      city: 'Melipilla',
      address: 'Dirección sintética 7',
    },
  });
  expect(store.status()).toBe(201);
  storeId = id(await store.json());
  const email = `inventario-${suffix}@example.test`;
  const account = await request.post(backend + '/users', {
    headers,
    data: {
      firstName: 'Supervisora',
      lastName: 'Inventario',
      email,
      password,
      roleCode: 'SUPERVISOR',
      storeId,
    },
  });
  expect(account.status()).toBe(201);
  supervisor = { id: id(await account.json()), email };

  // Tres formatos en filas libres de la plantilla: caja y bolsa en kg,
  // packs en unidades y solo cantidad suelta.
  const template = (await (
    await request.get(backend + '/products/template', { headers })
  ).json()) as {
    id: string;
    kind: string;
    section: string;
    product: unknown;
  }[];
  const free = template.filter(
    (row) => row.kind === 'ITEM' && row.product === null,
  );
  expect(free.length).toBeGreaterThanOrEqual(4);
  // El cuarto, que queda sin contar, va en otra sección: la vista agrupa.
  // La base se reutiliza entre corridas: se elige una sección que todavía
  // tenga tres filas libres.
  const bySection = new Map<string, typeof free>();
  for (const row of free)
    bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
  const first = [...bySection.values()].find((rows) => rows.length >= 3) ?? [];
  const otherSection = free.find((row) => row.section !== first[0]?.section);
  expect(first.length).toBeGreaterThanOrEqual(3);
  expect(otherSection).toBeDefined();
  const rows = [...first.slice(0, 3), otherSection!];
  pendingSection = otherSection!.section;
  names = {
    fajita: `Carne Fajita E2E ${suffix}`,
    bebida: `Lata E2E ${suffix}`,
    lechuga: `Lechuga E2E ${suffix}`,
    pending: `Pendiente E2E ${suffix}`,
    suffix,
  };
  const products = [
    {
      name: names.fajita,
      sku: `E2E-${randomUUID().slice(0, 8)}`,
      alternativeNames: [`Beef Steak ${suffix}`, `Carne Queso ${suffix}`],
      unit: 'KG',
      packageName: 'bolsa',
      packagesPerBox: 2,
      packageContent: '2.5',
      boxContent: '5',
      looseOnly: false,
    },
    {
      name: names.bebida,
      sku: null,
      alternativeNames: [],
      unit: 'UNIT',
      packageName: 'pack',
      packagesPerBox: null,
      packageContent: '6',
      boxContent: null,
      looseOnly: false,
    },
    {
      name: names.lechuga,
      sku: null,
      alternativeNames: [],
      unit: 'KG',
      packageName: null,
      packagesPerBox: null,
      packageContent: null,
      boxContent: null,
      looseOnly: true,
    },
    {
      name: names.pending,
      sku: null,
      alternativeNames: [],
      unit: 'L',
      packageName: null,
      packagesPerBox: null,
      packageContent: null,
      boxContent: null,
      looseOnly: true,
    },
  ];
  for (const [index, product] of products.entries()) {
    const created = await request.post(backend + '/products', {
      headers,
      data: {
        ...product,
        section: rows[index].section,
        templateRowId: rows[index].id,
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    productIds.push(id(await created.json()));
  }
});

test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const productId of productIds)
    expect(
      (
        await request.patch(`${backend}/products/${productId}/deactivate`, {
          headers,
        })
      ).status(),
    ).toBe(200);
  if (supervisor.id)
    expect(
      (
        await request.patch(`${backend}/users/${supervisor.id}/deactivate`, {
          headers,
        })
      ).status(),
    ).toBe(200);
  if (storeId)
    expect(
      (
        await request.patch(`${backend}/stores/${storeId}/deactivate`, {
          headers,
        })
      ).status(),
    ).toBe(200);
});

test('Supervisor: inicia, cuenta con total en vivo, reintenta sin red, retoma en otro dispositivo y finaliza', async ({
  page,
  context,
  browser,
  baseURL,
}, info) => {
  const origin = baseURL!;
  const today = chileDate();
  await login(context, origin);

  // El menú del supervisor ofrece «Inventario» junto a «Operación diaria».
  await page.goto('/dashboard');
  await page
    .getByRole('link', { name: 'Inventario', exact: true })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/inventario$/);
  await ready(page);
  await expect(
    page
      .getByRole('link', { name: 'Inventario', exact: true })
      .filter({ visible: true })
      .first(),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('heading', { name: 'Iniciar toma de inventario' }),
  ).toBeVisible();
  await expect(page.getByLabel('Fecha de la toma')).toHaveValue(today);
  await expect(
    page.getByText('Tu local todavía no tiene tomas finalizadas.'),
  ).toBeVisible();
  await noOverflow(page);
  await shot(page, info.project.name, '1-iniciar');

  // Otro dispositivo abre la vista antes de que exista la toma.
  const other = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Santiago',
  });
  await login(other, origin);
  const second = await other.newPage();
  await second.goto('/inventario');
  await ready(second);

  await page.getByRole('button', { name: 'Iniciar toma' }).click();
  await expect(
    page.getByText(`Toma del ${display(today)} iniciada.`),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: `Toma del ${display(today)}` }),
  ).toBeVisible();
  await expect(page.getByText('En curso', { exact: true })).toBeVisible();

  // Iniciar desde el otro dispositivo responde 409 y retoma la misma toma.
  await second.getByRole('button', { name: 'Iniciar toma' }).click();
  await expect(
    second.getByText(
      `Ya había una toma en curso del ${display(today)}: la retomas donde quedó.`,
    ),
  ).toBeVisible();
  const list = await context.request.get('/api/inventory-counts?status=OPEN');
  expect(list.status()).toBe(200);
  const [open] = (await list.json()) as { id: string; countDate: string }[];
  expect(open.countDate).toBe(today);
  const conflict = await bff(context.request, origin, 'POST', '', {
    countDate: today,
  });
  expect(conflict.status()).toBe(409);
  expect(await conflict.json()).toMatchObject({ existingCountId: open.id });

  // Avance, secciones y búsqueda por nombre alternativo o SKU.
  const detail = (await (
    await context.request.get('/api/inventory-counts/' + open.id)
  ).json()) as {
    totalProducts: number;
    items: { product: { sku: string | null; section: string | null } }[];
  };
  const total = detail.totalProducts;
  await progress(page, 0, total);
  const fajita = card(page, names.fajita);
  await expect(fajita).toContainText('Caja 5 kg · bolsa 2,5 kg');
  const search = page.getByLabel('Buscar producto');
  await search.fill(`beef steak ${names.suffix}`.toUpperCase());
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(fajita).toBeVisible();
  await search.fill(`carne queso ${names.suffix}`);
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(fajita).toBeVisible();
  const sku = detail.items.find((item) => item.product.sku?.startsWith('E2E-'))
    ?.product.sku;
  await search.fill(sku!.toLowerCase());
  await expect(fajita).toBeVisible();
  await search.fill(names.suffix);
  await expect(page.getByRole('article')).toHaveCount(4);
  // Cada sección con su encabezado, en el orden de la plantilla.
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: pendingSection,
      exact: true,
    }),
  ).toBeVisible();

  // Carne Fajita: cajas, bolsas y suelto en kg, con teclado numérico.
  const boxes = fajita.getByLabel('Cajas', { exact: true });
  const bags = fajita.getByLabel('Bolsas', { exact: true });
  const loose = fajita.getByLabel('Suelto (kg)', { exact: true });
  await expect(boxes).toHaveAttribute('inputmode', 'numeric');
  await expect(bags).toHaveAttribute('inputmode', 'numeric');
  await expect(loose).toHaveAttribute('inputmode', 'decimal');
  await boxes.fill('1');
  await bags.fill('3');
  await loose.fill('2,450');
  await expect(fajita).toContainText('Total 14,950 kg');
  await expect(fajita).toContainText('Sin guardar');
  await loose.fill('2.450');
  await expect(fajita).toContainText('Total 14,950 kg');
  await shot(page, info.project.name, '2-contando');

  // Sin red: lo escrito se conserva y se reintenta.
  await page.route('**/api/inventory-counts/*/lines/*', (route) =>
    route.abort('internetdisconnected'),
  );
  await fajita.getByRole('button', { name: `Guardar ${names.fajita}` }).click();
  await expect(fajita.getByRole('alert')).toContainText(
    'Lo que escribiste se conserva',
  );
  await expect(boxes).toHaveValue('1');
  await expect(loose).toHaveValue('2.450');
  await noOverflow(page);
  await shot(page, info.project.name, '3-sin-red');
  await page.unroute('**/api/inventory-counts/*/lines/*');
  await fajita
    .getByRole('button', { name: `Reintentar guardar ${names.fajita}` })
    .click();
  await expect(fajita).toContainText(/Guardado \d{2}:\d{2}/);
  await expect(fajita).toContainText('Contado');
  await expect(fajita).toContainText('Total 14,950 kg');
  await expect(loose).toHaveValue('2,450');
  await progress(page, 1, total);
  const saved = (await (
    await context.request.get('/api/inventory-counts/' + open.id)
  ).json()) as {
    items: {
      product: { id: string };
      line: { countedQuantity: string } | null;
    }[];
  };
  expect(
    saved.items.find((item) => item.product.id === productIds[0])?.line
      ?.countedQuantity,
  ).toBe('14.950');

  // Packs en unidades: sin cajas y con enteros.
  const bebida = card(page, names.bebida);
  await expect(bebida).toContainText('Pack 6 u.');
  await expect(bebida.getByLabel('Cajas', { exact: true })).toHaveCount(0);
  await expect(bebida.getByLabel('Suelto (u.)')).toHaveAttribute(
    'inputmode',
    'numeric',
  );
  await bebida.getByLabel('Packs', { exact: true }).fill('2');
  await bebida.getByLabel('Suelto (u.)').fill('2,5');
  await bebida.getByRole('button', { name: `Guardar ${names.bebida}` }).click();
  await expect(bebida.getByText(/entero/)).toBeVisible();
  await bebida.getByLabel('Suelto (u.)').fill('3');
  await expect(bebida).toContainText('Total 15 u.');
  await bebida.getByLabel('Suelto (u.)').press('Enter');
  await expect(bebida).toContainText(/Guardado \d{2}:\d{2}/);

  // Solo cantidad suelta.
  const lechuga = card(page, names.lechuga);
  await expect(lechuga).toContainText('Solo cantidad suelta (kg)');
  await expect(lechuga.getByRole('textbox')).toHaveCount(1);
  await lechuga.getByLabel('Suelto (kg)').fill('0.5');
  await expect(lechuga).toContainText('Total 0,500 kg');
  await lechuga
    .getByRole('button', { name: `Guardar ${names.lechuga}` })
    .click();
  await expect(lechuga).toContainText(/Guardado \d{2}:\d{2}/);
  await progress(page, 3, total);

  // Al recargar y en el otro dispositivo aparece lo guardado.
  await page.reload();
  await ready(page);
  await page.getByLabel('Buscar producto').fill(names.suffix);
  await expect(card(page, names.fajita).getByLabel('Cajas')).toHaveValue('1');
  await expect(card(page, names.fajita).getByLabel('Suelto (kg)')).toHaveValue(
    '2,450',
  );
  await expect(card(page, names.lechuga).getByLabel('Suelto (kg)')).toHaveValue(
    '0,500',
  );
  await progress(page, 3, total);
  await second.reload();
  await ready(second);
  await expect(
    card(second, names.bebida).getByLabel('Packs', { exact: true }),
  ).toHaveValue('2');
  await expect(card(second, names.fajita)).toContainText('Total 14,950 kg');
  await other.close();

  // «Sin contar» deja solo lo pendiente.
  await page.getByLabel('Mostrar').selectOption('pending');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(card(page, names.pending)).toBeVisible();
  await page.getByLabel('Mostrar').selectOption('all');
  await page.getByLabel('Buscar producto').fill('');
  await noOverflow(page);
  await shot(page, info.project.name, '4-guardado');

  // Finalizar: confirmación con contados y sin contar.
  await page.getByRole('button', { name: 'Finalizar inventario' }).click();
  const dialog = page.getByRole('dialog', { name: 'Finalizar inventario' });
  await expect(dialog).toContainText(`Toma del ${display(today)}`);
  await expect(dialog.getByRole('definition').first()).toHaveText('3');
  await expect(dialog.getByRole('definition').nth(1)).toHaveText(
    String(total - 3),
  );
  await dialog.getByText('Ver los productos sin contar').click();
  await expect(dialog.getByRole('listitem')).toContainText([names.pending]);
  await noOverflow(page);
  await shot(page, info.project.name, '5-confirmar');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Finalizar inventario' }).click();
  await dialog.getByRole('button', { name: 'Confirmar y finalizar' }).click();
  await expect(
    page.getByText(
      `Inventario finalizado: 3 productos contados y ${total - 3} sin contar.`,
    ),
  ).toBeVisible();
  await expect(page.getByText('Finalizado', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: `Toma del ${display(today)}` }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Cajas' })).toHaveCount(0);
  await page.getByLabel('Buscar producto').fill(names.suffix);
  await expect(card(page, names.fajita)).toContainText(
    '1 caja + 3 bolsas + 2,450 kg',
  );
  await expect(card(page, names.fajita)).toContainText('Total 14,950 kg');
  await expect(card(page, names.bebida)).toContainText('Total 15 u.');
  await noOverflow(page);
  await shot(page, info.project.name, '6-finalizada');

  // 409: ya finalizada, para finalizar y para guardar.
  const again = await bff(
    context.request,
    origin,
    'POST',
    `/${open.id}/finalize`,
  );
  expect(again.status()).toBe(409);
  expect(((await again.json()) as { message: string }).message).toMatch(
    /ya estaba finalizada/,
  );
  expect(
    (
      await bff(
        context.request,
        origin,
        'PUT',
        `/${open.id}/lines/${productIds[2]}`,
        { looseQuantity: '1' },
      )
    ).status(),
  ).toBe(409);

  // Toma nueva de ayer: la fecha que se muestra es la de la API. Sin
  // productos contados, finalizar responde 400 con un mensaje claro.
  const yesterday = chileDate(-1);
  await page.getByRole('button', { name: 'Iniciar una toma nueva' }).click();
  await ready(page);
  await expect(
    page.getByRole('button', { name: `Ver toma del ${display(today)}` }),
  ).toBeVisible();
  await page.getByLabel('Fecha de la toma').fill(yesterday);
  await page.getByRole('button', { name: 'Iniciar toma' }).click();
  await expect(
    page.getByRole('heading', { name: `Toma del ${display(yesterday)}` }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finalizar inventario' }).click();
  await expect(dialog.getByRole('definition').first()).toHaveText('0');
  await dialog.getByRole('button', { name: 'Confirmar y finalizar' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'La toma no tiene productos contados',
  );
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(
    page.getByRole('heading', { name: `Toma del ${display(yesterday)}` }),
  ).toBeVisible();
});

test('Supervisor: estado de error con reintento y BFF acotado', async ({
  page,
  context,
  baseURL,
}, info) => {
  const origin = baseURL!;
  await login(context, origin);
  // Error al cargar: mensaje y reintento.
  const listing = (url: URL): boolean =>
    url.pathname === '/api/inventory-counts';
  await page.route(listing, (route) =>
    route.fulfill({ status: 503, json: { message: 'x' } }),
  );
  await page.goto('/inventario');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'No se pudo conectar con el servicio' }),
  ).toBeVisible();
  await noOverflow(page);
  await shot(page, info.project.name, '7-error');
  await page.unroute(listing);
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await ready(page);
  await expect(page.getByRole('heading', { name: /^Toma del / })).toBeVisible();

  // Carga: el estado se anuncia mientras responde la API.
  let release: () => undefined = () => undefined;
  const held = new Promise<undefined>((resolve) => {
    release = (): undefined => {
      resolve(undefined);
    };
  });
  await page.route(listing, async (route) => {
    await held;
    await route.continue();
  });
  await page.reload();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Cargando la toma de inventario…' }),
  ).toBeVisible();
  await shot(page, info.project.name, '8-cargando');
  release();
  await ready(page);
  await page.unroute(listing);

  // Vacío: una toma sin productos en la plantilla.
  const detailPath = (url: URL): boolean =>
    /^\/api\/inventory-counts\/[0-9a-f-]{36}$/.test(url.pathname);
  await page.route(detailPath, async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...body,
        items: [],
        totalProducts: 0,
        pendingProducts: 0,
        countedProducts: 0,
      },
    });
  });
  await page.reload();
  await ready(page);
  await expect(
    page.getByText('No hay productos activos en la plantilla de inventario.'),
  ).toBeVisible();
  await noOverflow(page);
  await shot(page, info.project.name, '9-vacio');
  await page.unroute(detailPath);

  // El BFF exige mismo origen, valida el cuerpo y no expone otras rutas.
  const [open] = (await (
    await context.request.get('/api/inventory-counts?status=OPEN')
  ).json()) as { id: string }[];
  expect(
    (
      await context.request.post('/api/inventory-counts', {
        data: {},
      })
    ).status(),
  ).toBe(403);
  for (const [path, data] of [
    [`/${open.id}/lines/${productIds[0]}`, { boxes: -1 }],
    [`/${open.id}/lines/${productIds[0]}`, { looseQuantity: '2,450' }],
    [`/${open.id}/lines/${productIds[0]}`, { countedQuantity: '1.000' }],
  ] as const)
    expect(
      (await bff(context.request, origin, 'PUT', path, data)).status(),
    ).toBe(400);
  expect(
    (
      await bff(context.request, origin, 'POST', '', {
        countDate: '2026-11-10',
        storeId,
      })
    ).status(),
  ).toBe(400);
  expect((await context.request.get('/api/inventory-counts')).status()).toBe(
    400,
  );
  expect(
    (
      await context.request.get(`/api/inventory-counts/${open.id}/export`)
    ).status(),
  ).toBe(404);
  // Lo que no aplica al formato se rechaza con su error por campo.
  const wrong = await bff(
    context.request,
    origin,
    'PUT',
    `/${open.id}/lines/${productIds[2]}`,
    { boxes: 1, looseQuantity: '1' },
  );
  expect(wrong.status()).toBe(400);
  expect(((await wrong.json()) as { errors: object }).errors).toHaveProperty(
    'boxes',
  );
});
