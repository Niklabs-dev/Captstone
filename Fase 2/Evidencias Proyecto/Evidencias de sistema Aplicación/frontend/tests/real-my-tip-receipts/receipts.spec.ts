import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import {
  navigateTo,
  openNavigation,
  getNavigationSurface,
} from '../helpers/navigation';
import { seedLegacyPools } from '../helpers/legacy-tip-pools';
import { tipBusinessDate } from '../../src/lib/tips';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere sistema exclusivo con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3345';
const password = 'Own-tips-test-2026!';
let adminToken = '';
let store = { id: '', name: '' };
let otherStore = { id: '', name: '' };
const accounts: { id: string; email: string; role: string }[] = [];
let worker = { id: '', email: '' };
let peer = { id: '', email: '' };
let empty = { id: '', email: '' };
let supervisor = { id: '', email: '' };
let accountant = { id: '', email: '' };
let administrator = { id: '', email: '' };
let ownId = '';
let peerId = '';
let supervisorReceiptId = '';
let paidPoolId = '';
async function login(
  context: BrowserContext,
  baseURL: string,
  email = worker.email,
  secret = password,
) {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: secret },
      })
    ).status(),
  ).toBe(200);
}
// Desde SPRINT-4A-T10 «Mis propinas» también lista las propinas diarias: los
// conteos se limitan a la sección de constancias.
function receiptItems(page: Page) {
  return page
    .getByRole('region', { name: 'Mis constancias de propinas' })
    .getByRole('listitem');
}
async function cleanLayout(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
test.beforeAll(async ({ request }, info) => {
  const auth = await request.post(backend + '/auth/login', {
    data: {
      email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
      password:
        process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
    },
  });
  expect(auth.status()).toBe(200);
  adminToken = (await auth.json()).accessToken as string;
  const headers = { Authorization: 'Bearer ' + adminToken };
  const suffix = info.project.name + '-' + randomUUID();
  for (const name of ['Constancias ', 'Historial ']) {
    const res = await request.post(backend + '/stores', {
      headers,
      data: {
        name: name + suffix,
        city: 'Melipilla',
        address: 'Av. Pruebas 316',
      },
    });
    expect(res.status()).toBe(201);
    const value = (await res.json()) as { id: string; name: string };
    if (!store.id) store = value;
    else otherStore = value;
  }
  for (const [key, role, firstName, storeId] of [
    ['worker', 'TRABAJADOR', 'Ana', store.id],
    ['peer', 'TRABAJADOR', 'Bruno', store.id],
    ['empty', 'TRABAJADOR', 'Clara', otherStore.id],
    ['supervisor', 'SUPERVISOR', 'Persona', store.id],
    ['accountant', 'CONTADOR', 'Contador', null],
    ['administrator', 'ADMINISTRADOR', 'Administradora', null],
  ] as const) {
    const res = await request.post(backend + '/users', {
      headers,
      data: {
        email: key + '-' + suffix + '@example.test',
        password,
        firstName,
        lastName: 'Prueba T16',
        roleCode: role,
        ...(storeId ? { storeId } : {}),
      },
    });
    expect(res.status()).toBe(201);
    const account = {
      ...((await res.json()) as { id: string; email: string }),
      role,
    };
    accounts.push(account);
    if (key === 'worker') worker = account;
    if (key === 'peer') peer = account;
    if (key === 'empty') empty = account;
    if (key === 'supervisor') supervisor = account;
    if (key === 'accountant') accountant = account;
    if (key === 'administrator') administrator = account;
  }
  // SPRINT-4A-T08: la API ya no calcula, confirma ni paga repartos por
  // período; los históricos (PAID, CONFIRMED y DRAFT) se siembran en esta
  // base exclusiva y las constancias y descargas se leen por la API real.
  const lines = [
    { userId: worker.id, amount: 12500 },
    { userId: peer.id, amount: 6250 },
    { userId: supervisor.id, amount: 6250 },
  ];
  [paidPoolId] = seedLegacyPools(
    process.env.COMPOSE_PROJECT_NAME ?? 'sprint3-t16',
    [
      ['PAID', '2026-01-05', '2026-01-11'],
      ['CONFIRMED', '2026-01-12', '2026-01-18'],
      ['DRAFT', '2026-01-19', '2026-01-25'],
    ].map(([status, periodStart, periodEnd]) => ({
      storeId: store.id,
      periodStart,
      periodEnd,
      accountantId: accountant.id,
      status: status as 'PAID' | 'CONFIRMED' | 'DRAFT',
      paymentDate: '2026-01-12',
      lines,
    })),
  );
  const accAuth = await request.post(backend + '/auth/login', {
    data: { email: accountant.email, password },
  });
  expect(accAuth.status()).toBe(200);
  const accHeaders = {
    Authorization: 'Bearer ' + ((await accAuth.json()).accessToken as string),
  };
  const receipts = await request.get(
    backend + '/tip-pools/' + paidPoolId + '/receipts',
    { headers: accHeaders },
  );
  expect(receipts.status()).toBe(200);
  for (const r of (await receipts.json()) as {
    id: string;
    userId: string;
  }[]) {
    if (r.userId === worker.id) ownId = r.id;
    if (r.userId === peer.id) peerId = r.id;
    if (r.userId === supervisor.id) supervisorReceiptId = r.id;
  }
  // SPRINT-4A-T10: «Mis propinas» también muestra las propinas diarias. Una
  // operación de hoy para el trabajador y el supervisor comprueba que las
  // constancias se cuentan aparte de esa lista.
  const supAuth = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  expect(supAuth.status()).toBe(200);
  const operation = new FormData();
  for (const [name, value] of [
    ['storeId', store.id],
    ['businessDate', tipBusinessDate()],
    ['cardTipAmount', '0'],
    ['cashTipAmount', '3000'],
    ['cashDifference', '0'],
    ['participantIds', worker.id],
    ['participantIds', supervisor.id],
  ])
    operation.append(name, value);
  expect(
    (
      await request.post(backend + '/daily-operations', {
        headers: {
          Authorization:
            'Bearer ' + ((await supAuth.json()).accessToken as string),
        },
        multipart: operation,
      })
    ).status(),
  ).toBe(201);
  // El historial propio se conserva aunque el trabajador cambie de local.
  expect(
    (
      await request.patch(backend + '/users/' + peer.id, {
        headers,
        data: { storeId: otherStore.id },
      })
    ).status(),
  ).toBe(200);
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  const headers = { Authorization: 'Bearer ' + adminToken };
  for (const account of accounts)
    expect(
      (
        await request.patch(backend + '/users/' + account.id + '/deactivate', {
          headers,
        })
      ).status(),
    ).toBe(200);
  for (const item of [store, otherStore])
    if (item.id)
      expect(
        (
          await request.patch(backend + '/stores/' + item.id + '/deactivate', {
            headers,
          })
        ).status(),
      ).toBe(200);
});

test('Portal: solo PAID propio, navegación, PDF verificado y aislamiento entre dos trabajadores', async ({
  page,
  context,
  baseURL,
  request,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/portal');
  await navigateTo(page, 'Mis propinas');
  await expect(page).toHaveURL(/\/portal\/propinas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mis propinas' }),
  ).toBeVisible();
  await expect(receiptItems(page)).toHaveCount(1);
  // La propina diaria propia figura aparte, en la lista por día.
  const daily = page
    .getByRole('region', { name: /Propinas por día/ })
    .getByRole('listitem');
  await expect(daily).toHaveCount(1);
  await expect(daily).toContainText('$1.500');
  await expect(daily).toContainText('No pagada');
  await expect(page.getByRole('main')).toContainText('$12.500');
  await expect(page.getByRole('main')).toContainText('Contador Prueba T16');
  await expect(page.getByRole('main')).not.toContainText('Bruno');
  await cleanLayout(page);
  const list = await context.request.get('/api/my-tip-receipts');
  expect(list.status()).toBe(200);
  const values = (await list.json()) as {
    id: string;
    userId: string;
    status: string;
  }[];
  expect(values).toHaveLength(1);
  expect(values[0]).toMatchObject({
    id: ownId,
    userId: worker.id,
    status: 'PAID',
  });
  expect(JSON.stringify(values)).not.toContain('detail');
  for (const id of [peerId, randomUUID()])
    expect(
      (
        await context.request.get('/api/my-tip-receipts/' + id + '/download')
      ).status(),
    ).toBe(404);
  const auth = await request.post(backend + '/auth/login', {
    data: { email: worker.email, password },
  });
  const token = (await auth.json()).accessToken as string;
  const direct = await request.get(
    backend + '/my-tip-receipts/' + ownId + '/download',
    { headers: { Authorization: 'Bearer ' + token } },
  );
  expect(direct.status()).toBe(200);
  const bytes = await direct.body();
  expect(direct.headers()['x-content-sha256']).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  expect(
    (
      await request.get(backend + '/my-tip-receipts/' + peerId + '/download', {
        headers: { Authorization: 'Bearer ' + token },
      })
    ).status(),
  ).toBe(404);
  const downloadEvent = page.waitForEvent('download');
  const button = page.getByRole('button', { name: /Descargar constancia del/ });
  await button.click();
  const download = await downloadEvent;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect((await readFile(path!)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(
    page.getByRole('status').filter({ hasText: 'SHA-256 verificada' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar constancias' }).focus();
  await page.keyboard.press('Tab');
  await expect(button).toBeFocused();
  expect(
    await page.evaluate(
      () => getComputedStyle(document.activeElement!).outlineStyle,
    ),
  ).not.toBe('none');
  const folder = 'output/playwright/my-tip-receipts/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/propias.png',
    fullPage: true,
    scale: 'css',
  });
  await context.clearCookies();
  await login(context, baseURL!, peer.email);
  await page.goto('/portal/propinas');
  await expect(receiptItems(page)).toHaveCount(1);
  await expect(page.getByRole('main')).toContainText('$6.250');
  const peerList = await context.request.get('/api/my-tip-receipts');
  expect((await peerList.json())[0].userId).toBe(peer.id);
  expect(
    (
      await context.request.get('/api/my-tip-receipts/' + ownId + '/download')
    ).status(),
  ).toBe(404);
  expect(
    (
      await context.request.get('/api/my-tip-receipts/' + peerId + '/download')
    ).status(),
  ).toBe(200);
  await cleanLayout(page);
});

test('Carga, fallo, reintento, vacío e integridad alterada sin descargar', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  let release: () => undefined = () => undefined;
  const gate = new Promise<undefined>((resolve) => {
    release = () => {
      resolve(undefined);
      return undefined;
    };
  });
  let hold = true;
  let fail = false;
  await page.route('**/api/my-tip-receipts', async (route) => {
    if (hold) await gate;
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"private"}',
      });
    else await route.continue();
  });
  await page.goto('/portal/propinas');
  await expect(
    page.getByRole('status').filter({ hasText: 'Cargando tus constancias' }),
  ).toBeVisible();
  release();
  hold = false;
  await expect(receiptItems(page)).toHaveCount(1);
  fail = true;
  await page.getByRole('button', { name: 'Actualizar constancias' }).click();
  await expect(
    page.getByRole('button', { name: 'Reintentar consulta' }),
  ).toBeVisible();
  await expect(page.getByRole('main').getByRole('alert')).not.toContainText(
    'private',
  );
  fail = false;
  await page.getByRole('button', { name: 'Reintentar consulta' }).click();
  await expect(receiptItems(page)).toHaveCount(1);
  await page.route('**/api/my-tip-receipts/*/download', async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    const bytes = await response.body();
    await route.fulfill({
      response,
      body: Buffer.concat([bytes, Buffer.from('alterado')]),
    });
  });
  await page.getByRole('button', { name: /Descargar constancia del/ }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'No se pudo verificar',
  );
  await expect(receiptItems(page)).toHaveCount(1);
  const folder = 'output/playwright/my-tip-receipts/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/integridad-rechazada.png',
    fullPage: true,
    scale: 'css',
  });
  await context.clearCookies();
  await login(context, baseURL!, empty.email);
  await page.goto('/portal/propinas');
  await expect(
    page.getByRole('heading', {
      name: 'Aún no tienes constancias de propinas',
    }),
  ).toBeVisible();
  await cleanLayout(page);
});

test('Sesión, parámetros de identidad y escrituras rechazados', async ({
  context,
  baseURL,
  request,
}) => {
  expect((await request.get(baseURL + '/api/my-tip-receipts')).status()).toBe(
    401,
  );
  await login(context, baseURL!);
  for (const query of [
    'userId=' + peer.id,
    'storeId=' + otherStore.id,
    'role=ADMINISTRADOR',
  ])
    expect(
      (await context.request.get('/api/my-tip-receipts?' + query)).status(),
    ).toBe(400);
  expect(
    (
      await context.request.post('/api/my-tip-receipts', {
        headers: { Origin: baseURL! },
        data: { userId: peer.id },
      })
    ).status(),
  ).toBe(405);
});

for (const role of [
  'TRABAJADOR',
  'SUPERVISOR',
  'ADMINISTRADOR',
  'CONTADOR',
] as const)
  test(
    role + ': navegación, URL directa y APIs de constancias',
    async ({ page, context, request, baseURL }, info) => {
      const account = {
        TRABAJADOR: worker,
        SUPERVISOR: supervisor,
        ADMINISTRADOR: administrator,
        CONTADOR: accountant,
      }[role];
      const allowed = role === 'TRABAJADOR' || role === 'SUPERVISOR';
      await login(context, baseURL!, account.email);
      await page.goto(role === 'TRABAJADOR' ? '/portal' : '/dashboard');
      await openNavigation(page);
      await expect(
        getNavigationSurface(page).getByRole('link', {
          name: 'Mis propinas',
          exact: true,
        }),
      ).toHaveCount(allowed ? 1 : 0);
      if (!allowed)
        await expect(
          page.getByRole('link', { name: 'Mis propinas', exact: true }),
        ).toHaveCount(0);

      await page.goto('/portal/propinas');
      if (allowed) {
        await expect(page).toHaveURL(/\/portal\/propinas$/);
        await expect(
          page.getByRole('heading', { level: 1, name: 'Mis propinas' }),
        ).toBeVisible();
        await expect(receiptItems(page)).toHaveCount(1);
        const button = page.getByRole('button', {
          name: /Descargar constancia del/,
        });
        const box = await button.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      } else {
        await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
        await expect(page.getByRole('status')).toContainText(
          'Tu cuenta no tiene acceso',
        );
        await expect(
          page.getByRole('link', { name: 'Mis propinas', exact: true }),
        ).toHaveCount(0);
      }

      const auth = await request.post(backend + '/auth/login', {
        data: { email: account.email, password },
      });
      expect(auth.status()).toBe(200);
      const headers = {
        Authorization: 'Bearer ' + (await auth.json()).accessToken,
      };
      const receiptId = role === 'SUPERVISOR' ? supervisorReceiptId : ownId;
      for (const path of ['', '/' + receiptId + '/download']) {
        const bff = await context.request.get('/api/my-tip-receipts' + path);
        const direct = await request.get(backend + '/my-tip-receipts' + path, {
          headers,
        });
        expect(bff.status()).toBe(allowed ? 200 : 403);
        expect(direct.status()).toBe(allowed ? 200 : 403);
        if (allowed && !path) {
          for (const response of [bff, direct])
            expect(await response.json()).toEqual([
              expect.objectContaining({
                id: receiptId,
                userId: account.id,
                status: 'PAID',
              }),
            ]);
        }
        if (allowed && path)
          for (const response of [bff, direct]) {
            const bytes = await response.body();
            expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
            expect(response.headers()['x-content-sha256']).toBe(
              createHash('sha256').update(bytes).digest('hex'),
            );
          }
      }

      if (allowed) {
        for (const id of [peerId, randomUUID()]) {
          expect(
            (
              await context.request.get(
                '/api/my-tip-receipts/' + id + '/download',
              )
            ).status(),
          ).toBe(404);
          expect(
            (
              await request.get(
                backend + '/my-tip-receipts/' + id + '/download',
                {
                  headers,
                },
              )
            ).status(),
          ).toBe(404);
        }
      } else {
        // Los roles de gestión conservan el listado (API) y la descarga de
        // otras personas (API y BFF del histórico, SPRINT-4A-T08).
        const management = '/tip-pools/' + paidPoolId + '/receipts';
        for (const response of [
          await request.get(backend + management, { headers }),
        ]) {
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ userId: worker.id }),
              expect.objectContaining({ userId: peer.id }),
              expect.objectContaining({ userId: supervisor.id }),
            ]),
          );
        }
        const path = management + '/' + worker.id + '/download';
        for (const response of [
          await context.request.get('/api' + path),
          await request.get(backend + path, { headers }),
        ]) {
          expect(response.status()).toBe(200);
          expect((await response.body()).subarray(0, 5).toString()).toBe(
            '%PDF-',
          );
        }
      }
      await cleanLayout(page);
      await page.screenshot({
        path: info.outputPath('permisos-' + role.toLowerCase() + '.png'),
        fullPage: true,
        scale: 'css',
      });
    },
  );
