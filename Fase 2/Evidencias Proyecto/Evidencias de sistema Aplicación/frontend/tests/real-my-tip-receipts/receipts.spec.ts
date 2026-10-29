import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
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
let ownId = '';
let peerId = '';
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
  }
  // Solo pacto y horas son antecedentes SQL en esta base exclusiva. Los estados,
  // pagos, constancias y descargas se generan por las operaciones reales de T13.
  const sql =
    "INSERT INTO tip_agreements (name,rule,valid_from,valid_to,store_id,created_by_id,updated_at) VALUES ('Pacto T16','PROPORTIONAL_TO_HOURS','2026-01-01','2026-12-31',:'store_id',:'supervisor',now()); INSERT INTO work_hours_records (period_start,period_end,hours_worked,store_id,worker_id,recorded_by_id,updated_at) SELECT p.start_date::date,p.end_date::date,w.hours,:'store_id',w.worker::uuid,:'supervisor',now() FROM (VALUES ('2026-01-05','2026-01-11'),('2026-01-12','2026-01-18'),('2026-01-19','2026-01-25')) AS p(start_date,end_date) CROSS JOIN (VALUES (:'worker',40),(:'peer',20)) AS w(worker,hours);";
  execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? 'sprint3-t16',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v store_id="$1" -v worker="$2" -v peer="$3" -v supervisor="$4"',
      '--',
      store.id,
      worker.id,
      peer.id,
      supervisor.id,
    ],
    { input: sql, encoding: 'utf8', timeout: 30000 },
  );
  const supAuth = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  expect(supAuth.status()).toBe(200);
  const supToken = (await supAuth.json()).accessToken as string;
  const accAuth = await request.post(backend + '/auth/login', {
    data: { email: accountant.email, password },
  });
  expect(accAuth.status()).toBe(200);
  const accToken = (await accAuth.json()).accessToken as string;
  const accHeaders = { Authorization: 'Bearer ' + accToken };
  for (const [index, start, end] of [
    [0, '2026-01-05', '2026-01-11'],
    [1, '2026-01-12', '2026-01-18'],
    [2, '2026-01-19', '2026-01-25'],
  ] as const) {
    expect(
      (
        await request.post(backend + '/tips', {
          headers: { Authorization: 'Bearer ' + supToken },
          data: {
            storeId: store.id,
            businessDate: start,
            paymentMethod: 'CASH',
            amount: 25000,
          },
        })
      ).status(),
    ).toBe(201);
    const preview = await request.post(backend + '/tip-pools/preview', {
      headers: accHeaders,
      data: { storeId: store.id, periodStart: start, periodEnd: end },
    });
    expect(preview.status()).toBe(201);
    const pool = (await preview.json()) as { id: string; version: number };
    if (index === 2) continue;
    const confirm = await request.post(
      backend + '/tip-pools/' + pool.id + '/confirm',
      { headers: accHeaders, data: { expectedVersion: pool.version } },
    );
    expect(confirm.status()).toBe(200);
    if (index === 1) continue;
    const confirmed = (await confirm.json()) as { version: number };
    expect(
      (
        await request.post(backend + '/tip-pools/' + pool.id + '/pay', {
          headers: accHeaders,
          data: {
            expectedVersion: confirmed.version,
            paymentDate: '2026-01-12',
          },
        })
      ).status(),
    ).toBe(200);
    const receipts = await request.get(
      backend + '/tip-pools/' + pool.id + '/receipts',
      { headers: accHeaders },
    );
    expect(receipts.status()).toBe(200);
    for (const r of (await receipts.json()) as {
      id: string;
      userId: string;
    }[]) {
      if (r.userId === worker.id) ownId = r.id;
      if (r.userId === peer.id) peerId = r.id;
    }
  }
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
  const mobile = await page
    .getByText('Menú principal', { exact: true })
    .isVisible();
  if (mobile) await page.getByText('Menú principal', { exact: true }).click();
  await page.getByRole('link', { name: 'Mis propinas', exact: true }).click();
  await expect(page).toHaveURL(/\/portal\/propinas$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mis propinas' }),
  ).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('main')).toContainText('$16.667');
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
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('main')).toContainText('$8.333');
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
  await expect(page.getByRole('listitem')).toHaveCount(1);
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
  await expect(page.getByRole('listitem')).toHaveCount(1);
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
  await expect(page.getByRole('listitem')).toHaveCount(1);
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

test('Sesión, roles, parámetros de identidad y operaciones de escritura rechazados', async ({
  context,
  baseURL,
  page,
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
  for (const account of [supervisor, accountant]) {
    await context.clearCookies();
    await login(context, baseURL!, account.email);
    expect((await context.request.get('/api/my-tip-receipts')).status()).toBe(
      403,
    );
    await page.goto('/portal/propinas');
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
    const auth = await request.post(backend + '/auth/login', {
      data: { email: account.email, password },
    });
    expect(
      (
        await request.get(backend + '/my-tip-receipts', {
          headers: {
            Authorization: 'Bearer ' + (await auth.json()).accessToken,
          },
        })
      ).status(),
    ).toBe(403);
  }
  await context.clearCookies();
  await login(
    context,
    baseURL!,
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  );
  expect((await context.request.get('/api/my-tip-receipts')).status()).toBe(
    403,
  );
});
