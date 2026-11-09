import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isRecord } from '../../src/lib/auth';

test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra backend y base exclusivos con datos sintéticos.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3339';
const password = 'Operacion-test-2026!';
const date = '2026-10-26';
let adminToken = '';
let storeId = '';
let otherStoreId = '';
const accounts: { id: string; email: string; role: string }[] = [];
let supervisor: { id: string; email: string };
const workerName = 'Bruno Prueba de operación';
// PNG 1x1 real para el voucher.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function id(value: unknown): string {
  if (!isRecord(value) || typeof value.id !== 'string')
    throw Error('La respuesta no incluye un ID.');
  return value.id;
}
// Multipart con soporte de campos repetidos (participantIds del contrato).
function multipartBody(
  fields: Record<string, string | string[]>,
  file?: { name: string; filename: string; type: string; data: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = '----OperacionDiariaE2E';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields))
    for (const item of Array.isArray(value) ? value : [value])
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${item}\r\n`,
        ),
      );
  if (file)
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from('\r\n'),
    );
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
async function login(
  context: BrowserContext,
  baseURL: string,
  email = supervisor.email,
  accountPassword = password,
): Promise<undefined> {
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: accountPassword },
      })
    ).status(),
  ).toBe(200);
}
// El título de la consulta sale del estado de React: si muestra la fecha, la
// página ya hidrató y el input controlado no vuelve a la fecha inicial.
async function registerDate(page: Page, value = date): Promise<undefined> {
  const input = page.getByLabel(/Fecha de operación/);
  const [year, month, day] = value.split('-');
  const title = page.getByRole('heading', {
    name: `Operación registrada · ${day}-${month}-${year}`,
  });
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value, { timeout: 1000 });
    await expect(title).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30000 });
  await expect(input).toHaveValue(value);
  await expect(
    page.getByRole('button', { name: 'Guardar operación', exact: true }),
  ).toBeEnabled();
}
async function fillOperation(
  page: Page,
  values: {
    card?: string;
    cash?: string;
    difference?: string;
    reason?: string;
  } = {},
): Promise<undefined> {
  if (values.card !== undefined)
    await page
      .getByRole('textbox', { name: /Propina con tarjeta/ })
      .fill(values.card);
  if (values.cash !== undefined)
    await page
      .getByRole('textbox', { name: /Propina en efectivo/ })
      .fill(values.cash);
  if (values.difference !== undefined)
    await page
      .getByRole('textbox', { name: /Diferencia de efectivo/ })
      .fill(values.difference);
  if (values.reason !== undefined)
    await page
      .getByRole('textbox', { name: /Motivo de la diferencia/ })
      .fill(values.reason);
}
async function noOverflow(page: Page): Promise<undefined> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
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
  const suffix = info.project.name + '-' + randomUUID();
  for (const name of ['Centro ', 'Norte ']) {
    const response = await request.post(backend + '/stores', {
      headers,
      data: {
        name: 'Operación ' + name + suffix,
        city: 'Melipilla',
        address: 'Av. Pruebas 311',
      },
    });
    expect(response.status()).toBe(201);
    if (!storeId) storeId = id(await response.json());
    else otherStoreId = id(await response.json());
  }
  for (const [key, role, assignedStore, firstName] of [
    ['supervisor', 'SUPERVISOR', storeId, 'Camila'],
    ['other', 'SUPERVISOR', otherStoreId, 'Oscar'],
    ['worker', 'TRABAJADOR', storeId, 'Bruno'],
    ['worker2', 'TRABAJADOR', storeId, 'Dana'],
    ['accountant', 'CONTADOR', null, 'Ana'],
  ] as const) {
    const email = key + '-' + suffix + '@example.test';
    const response = await request.post(backend + '/users', {
      headers,
      data: {
        email,
        password,
        firstName,
        lastName: 'Prueba de operación',
        roleCode: role,
        ...(assignedStore ? { storeId: assignedStore } : {}),
      },
    });
    expect(response.status()).toBe(201);
    const account = { id: id(await response.json()), email, role };
    accounts.push(account);
    if (key === 'supervisor') supervisor = account;
  }
});
test.afterAll(async ({ request }) => {
  if (!adminToken) return;
  for (const account of accounts)
    expect(
      (
        await request.patch(backend + '/users/' + account.id + '/deactivate', {
          headers: { Authorization: 'Bearer ' + adminToken },
        })
      ).status(),
    ).toBe(200);
  for (const store of [storeId, otherStoreId])
    if (store)
      expect(
        (
          await request.patch(backend + '/stores/' + store + '/deactivate', {
            headers: { Authorization: 'Bearer ' + adminToken },
          })
        ).status(),
      ).toBe(200);
});

test('Supervisor: validación, voucher, registro, reintento idéntico, conflicto consultable y descarga', async ({
  page,
  context,
  request,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/dashboard');
  await page
    .getByRole('link', { name: 'Registrar operación', exact: true })
    .click();
  await expect(page).toHaveURL(/\/propinas\/diarias$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Operación diaria' }),
  ).toBeVisible();
  await registerDate(page);
  await expect(
    page.getByRole('heading', { name: 'No hay operación registrada' }),
  ).toBeVisible();
  const save = page.getByRole('button', {
    name: 'Guardar operación',
    exact: true,
  });
  const card = page.getByRole('textbox', { name: /Propina con tarjeta/ });
  const cash = page.getByRole('textbox', { name: /Propina en efectivo/ });
  const difference = page.getByRole('textbox', {
    name: /Diferencia de efectivo/,
  });
  const voucher = page.getByLabel(/Foto del voucher/);
  // Validación: campos vacíos (la diferencia inicia en 0, valor válido).
  await save.click();
  await expect(card).toHaveAttribute('aria-invalid', 'true');
  await expect(cash).toHaveAttribute('aria-invalid', 'true');
  await expect(difference).toHaveValue('0');
  await expect(difference).toHaveAttribute('aria-invalid', 'false');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Corrige los campos',
  );
  await fillOperation(page, {
    card: '12500',
    cash: '8000',
    difference: '-1500',
  });
  await save.click();
  await expect(voucher).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Adjunta la foto del voucher/)).toBeVisible();
  // El motivo es obligatorio cuando la diferencia no es cero.
  await voucher.setInputFiles({
    name: 'voucher.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await save.click();
  await expect(
    page.getByRole('textbox', { name: /Motivo de la diferencia/ }),
  ).toHaveAttribute('aria-invalid', 'true');
  await fillOperation(page, { reason: 'Vale de caja firmado' });
  for (const invalid of ['-1', '12.500', '10000000000']) {
    await fillOperation(page, { card: invalid });
    await save.click();
    await expect(card).toHaveAttribute('aria-invalid', 'true');
  }
  await fillOperation(page, { card: '12500' });
  await page.getByRole('checkbox', { name: workerName }).check();
  // Doble envío: un único POST gracias al bloqueo en cliente.
  let posts = 0;
  await page.route('**/api/daily-operations', async (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      await new Promise((resolve) => globalThis.setTimeout(resolve, 200));
    }
    await route.continue();
  });
  await page.locator('form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  expect(posts).toBe(1);
  // La operación registrada queda consultable con sus montos y responsable.
  const registered = page.locator('section', {
    has: page.getByRole('heading', { name: /Operación registrada/ }),
  });
  await expect(registered).toContainText('$12.500');
  await expect(registered).toContainText('$8.000');
  await expect(registered).toContainText('$20.500');
  await expect(registered).toContainText('-$1.500');
  await expect(registered).toContainText('Vale de caja firmado');
  await expect(registered).toContainText('Camila Prueba de operación');
  await expect(registered.getByText('Participantes del reparto')).toBeVisible();
  await expect(registered).toContainText(workerName);
  await expect(
    registered.getByText('Registrada', { exact: true }),
  ).toBeVisible();
  // El catálogo acotado solo expone trabajadores activos del propio local,
  // sin datos personales (SPRINT-4R-T03).
  const eligible = await context.request.get(
    '/api/daily-operations/eligible-workers?storeId=' + storeId,
  );
  expect(eligible.status()).toBe(200);
  const eligibleBody: unknown = await eligible.json();
  if (!Array.isArray(eligibleBody)) throw Error('Elegibles no es un arreglo.');
  const eligibleIds = eligibleBody.map((worker) =>
    isRecord(worker) && typeof worker.id === 'string' ? worker.id : '',
  );
  expect(eligibleIds).toContain(accounts[2].id);
  expect(eligibleIds).toContain(accounts[3].id);
  expect(eligibleIds).not.toContain(accounts[0].id);
  expect(eligibleIds).not.toContain(accounts[1].id);
  const eligibleText = JSON.stringify(eligibleBody);
  expect(eligibleText).not.toContain('@');
  expect(eligibleText).not.toContain(password);
  const persisted = await context.request.get(
    '/api/daily-operations?storeId=' + storeId + '&businessDate=' + date,
  );
  expect(persisted.status()).toBe(200);
  const operations: unknown = await persisted.json();
  if (
    !Array.isArray(operations) ||
    operations.length !== 1 ||
    !isRecord(operations[0])
  )
    throw Error('Se esperaba una operación registrada.');
  const operationId = id(operations[0]);
  expect(isRecord(operations[0].voucher)).toBe(true);
  // El voucher privado se descarga autenticado por el BFF.
  const download = await context.request.get(
    '/api/daily-operations/' + operationId + '/voucher',
  );
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('image/');
  expect(Buffer.from(await download.body()).length).toBeGreaterThan(0);
  expect(
    JSON.stringify(
      await (
        await context.request.get('/api/daily-operations/' + operationId)
      ).json(),
    ),
  ).toContain(supervisor.id);
  // Reintento idéntico: mismos montos, voucher e misma selección -> 200.
  const replayParts = multipartBody(
    {
      storeId,
      businessDate: date,
      cardTipAmount: '12500',
      cashTipAmount: '8000',
      cashDifference: '-1500',
      differenceReason: 'Vale de caja firmado',
      participantIds: [accounts[2].id],
    },
    { name: 'voucher', filename: 'voucher.png', type: 'image/png', data: png },
  );
  const replay = await context.request.post('/api/daily-operations', {
    headers: {
      Origin: baseURL!,
      'Content-Type': replayParts.contentType,
    },
    data: replayParts.body,
  });
  expect(replay.status()).toBe(200);
  expect(await replay.text()).not.toContain('accessToken');
  const replayed: unknown = await replay.json();
  expect(isRecord(replayed) && replayed.id).toBe(operationId);
  expect(JSON.stringify(replayed)).toContain(accounts[2].id);
  // Reintento con selección distinta: 409 sin sobrescribir silenciosamente.
  const replayDifferent = multipartBody(
    {
      storeId,
      businessDate: date,
      cardTipAmount: '12500',
      cashTipAmount: '8000',
      cashDifference: '-1500',
      differenceReason: 'Vale de caja firmado',
      participantIds: [accounts[3].id],
    },
    { name: 'voucher', filename: 'voucher.png', type: 'image/png', data: png },
  );
  const different = await context.request.post('/api/daily-operations', {
    headers: {
      Origin: baseURL!,
      'Content-Type': replayDifferent.contentType,
    },
    data: replayDifferent.body,
  });
  expect(different.status()).toBe(409);
  const differentBody: unknown = await different.json();
  if (!isRecord(differentBody)) throw Error('Conflicto sin cuerpo.');
  expect(differentBody.existingOperationId).toBe(operationId);
  // Conflicto con otro contenido: 409 con ID consultable en el BFF.
  const conflictParts = multipartBody(
    {
      storeId,
      businessDate: date,
      cardTipAmount: '13000',
      cashTipAmount: '8000',
      cashDifference: '-1500',
      differenceReason: 'Vale de caja firmado',
      participantIds: [accounts[2].id],
    },
    { name: 'voucher', filename: 'voucher.png', type: 'image/png', data: png },
  );
  const conflict = await context.request.post('/api/daily-operations', {
    headers: {
      Origin: baseURL!,
      'Content-Type': conflictParts.contentType,
    },
    data: conflictParts.body,
  });
  expect(conflict.status()).toBe(409);
  const conflictBody: unknown = await conflict.json();
  if (!isRecord(conflictBody)) throw Error('Conflicto sin cuerpo.');
  expect(conflictBody.existingOperationId).toBe(operationId);
  expect(JSON.stringify(conflictBody)).not.toContain('accessToken');
  // La interfaz muestra el conflicto, conserva los campos y ofrece la registrada.
  await fillOperation(page, {
    card: '13000',
    cash: '8000',
    difference: '-1500',
    reason: 'Vale de caja firmado',
  });
  await voucher.setInputFiles({
    name: 'voucher.png',
    mimeType: 'image/png',
    buffer: png,
  });
  await page.getByRole('checkbox', { name: workerName }).check();
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Ya existe una operación registrada para esta fecha',
  );
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    operationId,
  );
  await expect(registered).toContainText('$12.500');
  await expect(card).toHaveValue('13000');
  // El supervisor ajeno no lee el local de esta supervisora en el backend.
  const directLogin = await request.post(backend + '/auth/login', {
    data: { email: supervisor.email, password },
  });
  const token: unknown = await directLogin.json();
  if (!isRecord(token) || typeof token.accessToken !== 'string')
    throw Error('Falta token de prueba.');
  expect(
    (
      await request.get(
        backend +
          '/daily-operations?storeId=' +
          otherStoreId +
          '&businessDate=' +
          date,
        { headers: { Authorization: 'Bearer ' + token.accessToken } },
      )
    ).status(),
  ).toBe(403);
  await page.keyboard.press('Tab');
  await card.focus();
  await expect(card).toBeFocused();
  expect(
    await card.evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe('2px');
  await noOverflow(page);
  const folder = 'output/playwright/daily-operations/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: folder + '/registro.png', scale: 'css' });
  // Cambiar de fecha vuelve a consultar; los valores se conservan al reintentar.
  await page.getByLabel(/Fecha de operación/).fill('');
  await expect(page.getByLabel(/Fecha de operación/)).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(save).toBeDisabled();
  await registerDate(page, '2026-10-25');
  await expect(
    page.getByRole('heading', { name: 'No hay operación registrada' }),
  ).toBeVisible();
  await registerDate(page);
  await expect(registered).toContainText('$20.500');
  expect(
    (await context.cookies())
      .filter((cookie) => cookie.name.startsWith('mf_'))
      .every((cookie) => cookie.httpOnly),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  // Corrección vía BFF (SPRINT-4R-T03): cambia el efectivo y la selección,
  // conserva el voucher y queda visible en la consulta.
  const correction = multipartBody({
    cashTipAmount: '8100',
    participantIds: [accounts[3].id],
  });
  const corrected = await context.request.patch(
    '/api/daily-operations/' + operationId,
    {
      headers: {
        Origin: baseURL!,
        'Content-Type': correction.contentType,
      },
      data: correction.body,
    },
  );
  expect(corrected.status()).toBe(200);
  const correctedBody: unknown = await corrected.json();
  if (!isRecord(correctedBody)) throw Error('Corrección sin cuerpo.');
  expect(correctedBody.cashTipAmount).toBe(8100);
  expect(correctedBody.tipFundAmount).toBe(20600);
  expect(isRecord(correctedBody.voucher)).toBe(true);
  expect(JSON.stringify(correctedBody.participants)).toContain(accounts[3].id);
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(registered).toContainText('$8.100');
  await expect(registered).toContainText('$20.600');
  await expect(registered).toContainText('Dana Prueba de operación');
});

test('BFF y páginas: sesión, roles, origen, multipart e identidad/local no editables', async ({
  page,
  context,
  baseURL,
}) => {
  expect(
    (
      await context.request.get(
        '/api/daily-operations?storeId=' + storeId + '&businessDate=' + date,
      )
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.get(
        '/api/daily-operations/eligible-workers?storeId=' + storeId,
      )
    ).status(),
  ).toBe(401);
  await login(context, baseURL!);
  const headers = { Origin: baseURL! };
  const file = { name: 'voucher.png', mimeType: 'image/png', buffer: png };
  const valid = {
    storeId,
    businessDate: date,
    cardTipAmount: '12500',
    cashTipAmount: '8000',
    cashDifference: '-1500',
    differenceReason: 'Vale de caja firmado',
    participantIds: accounts[2].id,
  };
  // El catálogo de elegibles exige sesión de supervisor y el propio local.
  expect(
    (
      await context.request.get(
        '/api/daily-operations/eligible-workers?storeId=' + storeId,
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.get(
        '/api/daily-operations/eligible-workers?storeId=' + otherStoreId,
      )
    ).status(),
  ).toBe(400);
  for (const body of [
    { ...valid, storeId: otherStoreId },
    { ...valid, responsibleId: accounts[1].id },
    { ...valid, cardTipAmount: '-1' },
    { ...valid, cashTipAmount: '1.5' },
    { ...valid, cashDifference: 'texto' },
    { ...valid, businessDate: '2026-02-30' },
    { ...valid, cashDifference: '-1500', differenceReason: '' },
  ])
    expect(
      (
        await context.request.post('/api/daily-operations', {
          headers,
          multipart: { ...body, voucher: file },
        })
      ).status(),
    ).toBe(400);
  expect(
    (
      await context.request.post('/api/daily-operations', {
        headers,
        multipart: {
          ...valid,
          voucher: { name: 'v.pdf', mimeType: 'application/pdf', buffer: png },
        },
      })
    ).status(),
  ).toBe(415);
  expect(
    (
      await context.request.get(
        '/api/daily-operations?businessDate=' +
          date +
          '&storeId=' +
          otherStoreId,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.get(
        '/api/daily-operations?businessDate=' +
          date +
          '&businessDate=2026-10-25&storeId=' +
          storeId,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await context.request.post('/api/daily-operations', {
        headers: { Origin: 'https://other.example.test' },
        multipart: { ...valid, voucher: file },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post('/api/daily-operations', {
        multipart: { ...valid, voucher: file },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.patch('/api/daily-operations', {
        headers,
        multipart: { ...valid, voucher: file },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await context.request.patch('/api/daily-operations/' + accounts[1].id, {
        headers,
        multipart: { ...valid, storeId: otherStoreId, voucher: file },
      })
    ).status(),
  ).toBe(400);
  for (const account of accounts.filter((item) => item.role !== 'SUPERVISOR')) {
    await login(context, baseURL!, account.email);
    await page.goto('/propinas/diarias');
    await expect(page).toHaveURL(
      account.role === 'TRABAJADOR'
        ? /\/portal\?reason=forbidden$/
        : /\/dashboard\?reason=forbidden$/,
    );
    expect(
      (
        await context.request.get(
          '/api/daily-operations?storeId=' + storeId + '&businessDate=' + date,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.get(
          '/api/daily-operations/eligible-workers?storeId=' + storeId,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await context.request.post('/api/daily-operations', {
          headers,
          multipart: { ...valid, voucher: file },
        })
      ).status(),
    ).toBe(403);
  }
  await login(
    context,
    baseURL!,
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  );
  await page.goto('/propinas/diarias');
  await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
  expect(
    (
      await context.request.get(
        '/api/daily-operations?storeId=' + storeId + '&businessDate=' + date,
      )
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.get(
        '/api/daily-operations/eligible-workers?storeId=' + storeId,
      )
    ).status(),
  ).toBe(403);
});

test('Participantes: seleccionar todos, vista previa del reparto, foco, corrección sin duplicar y fondo 0 (SPRINT-4R-T05)', async ({
  page,
  context,
  baseURL,
}, info) => {
  const correctionDate = '2026-10-29';
  const secondWorker = 'Dana Prueba de operación';
  await login(context, baseURL!);
  await page.goto('/propinas/diarias');
  await registerDate(page, correctionDate);
  await expect(
    page.getByRole('heading', { name: 'No hay operación registrada' }),
  ).toBeVisible();
  const preview = page.getByRole('region', {
    name: 'Vista previa del reparto del día',
  });
  await expect(preview).toContainText('Ingresa ambas propinas');
  await fillOperation(page, { card: '0', cash: '10001', difference: '0' });
  await expect(preview).toContainText(
    'Fondo de $10.001. Selecciona participantes',
  );

  // Seleccionar todos con contador y control táctil de al menos 44 px.
  const participants = page.getByRole('group', {
    name: 'Trabajadores participantes del reparto',
  });
  await expect(participants).toContainText('0 de 2 seleccionados');
  const toggleAll = participants.getByRole('button', {
    name: 'Seleccionar todos',
  });
  expect((await toggleAll.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
    44,
  );
  await toggleAll.click();
  await expect(participants).toContainText('2 de 2 seleccionados');
  await expect(page.getByRole('checkbox', { name: workerName })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: secondWorker }),
  ).toBeChecked();

  // Vista previa: $10.001 entre 2 da $5.001 y $5.000 con $1 de residuo.
  const shares = preview.getByRole('table');
  await expect(shares).toContainText(workerName);
  await expect(shares).toContainText(secondWorker);
  await expect(shares).toContainText('$5.001');
  await expect(shares).toContainText('$5.000');
  await expect(preview).toContainText('queda $1 de residuo');

  // Sin participantes con fondo: error y foco en la primera casilla.
  await participants.getByRole('button', { name: 'Quitar selección' }).click();
  await expect(participants).toContainText('0 de 2 seleccionados');
  const save = page.getByRole('button', {
    name: 'Guardar operación',
    exact: true,
  });
  await save.click();
  await expect(
    page.getByText(
      'Selecciona al menos un trabajador participante: hay propinas por repartir.',
    ),
  ).toBeVisible();
  const firstWorker = page.getByRole('checkbox', { name: workerName });
  await expect(firstWorker).toBeFocused();
  // Uso con teclado: Espacio marca la casilla enfocada.
  await page.keyboard.press('Space');
  await expect(firstWorker).toBeChecked();
  await page.getByRole('checkbox', { name: secondWorker }).check();
  await save.click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  const registered = page.locator('section', {
    has: page.getByRole('heading', { name: /Operación registrada/ }),
  });
  await expect(registered).toContainText('$10.001');
  await expect(registered.getByRole('table')).toContainText('$5.001');
  await expect(registered.getByRole('table')).toContainText('$5.000');
  const idText = await registered.getByText(/ID de la operación/).innerText();
  const operationId = /[0-9a-f-]{36}/.exec(idText)?.[0] ?? '';
  expect(operationId).not.toBe('');

  // Corrección: precarga, fecha fija, mismo ID y sin duplicar.
  await registered.getByRole('button', { name: 'Corregir operación' }).click();
  await expect(
    page.getByRole('heading', { name: 'Corregir operación diaria' }),
  ).toBeVisible();
  await expect(page.getByLabel(/Fecha de operación/)).toBeDisabled();
  await expect(
    page.getByRole('textbox', { name: /Propina en efectivo/ }),
  ).toHaveValue('10001');
  await expect(participants).toContainText('2 de 2 seleccionados');
  await fillOperation(page, { cash: '9000' });
  await page.getByRole('checkbox', { name: secondWorker }).uncheck();
  await expect(preview.getByRole('table')).not.toContainText(secondWorker);
  await expect(preview).toContainText('$9.000');
  await expect(preview).toContainText('sin residuo');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria corregida correctamente.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Registrar operación diaria' }),
  ).toBeVisible();
  await expect(registered).toContainText('$9.000');
  await expect(registered.getByRole('table')).toContainText(workerName);
  await expect(registered.getByRole('table')).not.toContainText(secondWorker);
  await expect(registered).toContainText(operationId);
  const listed = await context.request.get(
    '/api/daily-operations?storeId=' +
      storeId +
      '&businessDate=' +
      correctionDate,
  );
  expect(listed.status()).toBe(200);
  const listedBody: unknown = await listed.json();
  expect(Array.isArray(listedBody) && listedBody.length).toBe(1);

  // Un trabajador ajeno al local no se puede inyectar por el BFF.
  const injected = multipartBody({
    cashTipAmount: '9000',
    participantIds: [accounts[4].id],
  });
  const injectedResponse = await context.request.patch(
    '/api/daily-operations/' + operationId,
    {
      headers: { Origin: baseURL!, 'Content-Type': injected.contentType },
      data: injected.body,
    },
  );
  expect(injectedResponse.status()).toBeGreaterThanOrEqual(400);
  expect(injectedResponse.status()).toBeLessThan(500);
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(registered.getByRole('table')).toContainText(workerName);

  // Fondo 0: la selección marcada no se envía y el detalle queda sin reparto.
  await registered.getByRole('button', { name: 'Corregir operación' }).click();
  await fillOperation(page, { cash: '0' });
  await expect(firstWorker).toBeChecked();
  await expect(
    page.getByText('Sin propinas no hay reparto: la selección no se guardará.'),
  ).toBeVisible();
  await expect(preview).toContainText('No hay propinas por repartir');
  await page.getByRole('button', { name: 'Guardar corrección' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria corregida correctamente.' }),
  ).toBeVisible();
  await expect(registered).toContainText('Sin reparto');
  await noOverflow(page);
  const folder = 'output/playwright/daily-operations/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/participantes-correccion.png',
    scale: 'css',
  });
});

test('Carga, error, reintento y conservación de campos sobre la API real', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  let release: (() => undefined) | undefined;
  const gate = new Promise<undefined>((resolve) => {
    release = () => {
      resolve(undefined);
      return undefined;
    };
  });
  let failure = false;
  let hold = true;
  await page.route('**/api/daily-operations**', async (route) => {
    if (route.request().method() === 'GET' && hold) await gate;
    if (failure) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"message":"temporary"}',
      });
      return;
    }
    await route.continue();
  });
  await page.goto('/propinas/diarias');
  await expect(
    page.getByText('Consultando la operación del día…', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Guardar operación', exact: true }),
  ).toBeDisabled();
  hold = false;
  release?.();
  await registerDate(page, '2026-10-24');
  failure = true;
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(
    page.getByRole('button', { name: 'Reintentar consulta' }),
  ).toBeVisible();
  const folder = 'output/playwright/daily-operations/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: folder + '/error-consulta.png', scale: 'css' });
  failure = false;
  await page.getByRole('button', { name: 'Reintentar consulta' }).click();
  const save = page.getByRole('button', {
    name: 'Guardar operación',
    exact: true,
  });
  await expect(save).toBeEnabled();
  await fillOperation(page, {
    card: '4500',
    cash: '0',
    difference: '0',
  });
  await page
    .getByLabel(/Foto del voucher/)
    .setInputFiles({ name: 'voucher.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('checkbox', { name: workerName }).check();
  failure = true;
  await save.click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Conservamos los campos',
  );
  await expect(
    page.getByRole('textbox', { name: /Propina con tarjeta/ }),
  ).toHaveValue('4500');
  await expect(save).toBeEnabled();
  failure = false;
  await save.click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Operación diaria registrada correctamente.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Operación registrada/ }),
  ).toBeVisible();
  await noOverflow(page);
});

test('Local desactivado después de abrir la vista: causa clara, monto conservado e historial disponible', async ({
  page,
  context,
  baseURL,
}, info) => {
  await login(context, baseURL!);
  await page.goto('/propinas/diarias');
  await registerDate(page, '2026-10-23');
  const card = page.getByRole('textbox', { name: /Propina con tarjeta/ });
  await fillOperation(page, { card: '7500', cash: '0', difference: '0' });
  await page
    .getByLabel(/Foto del voucher/)
    .setInputFiles({ name: 'voucher.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('checkbox', { name: workerName }).check();
  // La API bloquea la baja si hay usuarios activos. Solo en esta base exclusiva
  // se prepara el estado inactivo con la vista abierta para probar la regresión.
  const changed = execFileSync(
    'docker',
    [
      'compose',
      '-f',
      '../docker-compose.yml',
      '-p',
      process.env.COMPOSE_PROJECT_NAME ?? 'sprint3-t11',
      'exec',
      '-T',
      'db',
      'sh',
      '-c',
      'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v store_id="$1"',
      '--',
      storeId,
    ],
    {
      input:
        "UPDATE stores SET is_active = false, updated_at = now() WHERE id = :'store_id'::uuid AND name LIKE 'Operación %' RETURNING id;",
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  expect(changed).toContain(storeId);
  const response = page.waitForResponse(
    (res) =>
      res.url().endsWith('/api/daily-operations') &&
      res.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Guardar operación', exact: true })
    .click();
  expect((await response).status()).toBe(400);
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Tu local está inactivo. Consulta con el administrador',
  );
  await expect(card).toHaveValue('7500');
  await page.getByRole('button', { name: 'Actualizar consulta' }).click();
  await expect(
    page.getByRole('heading', { name: 'No hay operación registrada' }),
  ).toBeVisible();
  await noOverflow(page);
  const folder = 'output/playwright/daily-operations/' + info.project.name;
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: folder + '/local-desactivado.png',
    fullPage: true,
    scale: 'css',
  });
});
