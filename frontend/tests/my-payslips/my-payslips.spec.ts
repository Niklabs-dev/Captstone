import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { OwnPayslip } from '../../src/lib/my-payslips';
const workerId = '30000000-0000-4000-8000-000000000217';
const otherWorker = '31000000-0000-4000-8000-000000000217';
const pdf = Buffer.from('%PDF-1.7\nseptiembre sintetico\n%%EOF');
const oldPdf = Buffer.from('%PDF-1.7\nagosto sintetico\n%%EOF');
const otherPdf = Buffer.from('%PDF-1.7\ncuenta B sintetica\n%%EOF');
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const first: OwnPayslip = {
  id: '10000000-0000-4000-8000-000000000217',
  versionId: '20000000-0000-4000-8000-000000000217',
  workerId,
  period: '2026-09',
  fileName: 'liquidacion-2026-09.pdf',
  mime: 'application/pdf',
  size: pdf.length,
  sha256: sha(pdf),
  status: 'PUBLISHED',
  publishedAt: '2026-10-15T12:00:00Z',
  signedAt: '2026-10-14',
};
const older: OwnPayslip = {
  ...first,
  id: '11000000-0000-4000-8000-000000000217',
  versionId: '21000000-0000-4000-8000-000000000217',
  period: '2026-08',
  fileName: 'liquidacion-2026-08.pdf',
  size: oldPdf.length,
  sha256: sha(oldPdf),
};
const accountB: OwnPayslip = {
  ...first,
  id: '12000000-0000-4000-8000-000000000217',
  versionId: '22000000-0000-4000-8000-000000000217',
  workerId: otherWorker,
  period: '2026-07',
  fileName: 'liquidacion-cuenta-b.pdf',
  size: otherPdf.length,
  sha256: sha(otherPdf),
};
async function simulate(page: Page) {
  const state = {
    items: [older, first] as unknown[],
    error: 0,
    malformed: false,
    mismatch: false,
    tampered: false,
    downloads: 0,
    delay: 0,
  };
  await page.route('**/api/my-payroll**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.method()).toBe('GET');
    expect(url.search).toBe('');
    expect(request.headers()['authorization']).toBeUndefined();
    if (state.error) {
      await route.fulfill({
        status: state.error,
        json: { message: 'private-secret' },
      });
      return;
    }
    if (url.pathname === '/api/my-payroll') {
      await route.fulfill({
        json: state.malformed ? { items: 'bad' } : { items: state.items },
      });
      return;
    }
    const item = [first, older, accountB].find(
      (item) => item.id === url.pathname.split('/')[3],
    );
    if (!item) throw new Error('Liquidación de prueba no encontrada.');
    if (url.pathname.endsWith('/integrity')) {
      await route.fulfill({
        json: {
          payslipId: item.id,
          versionId: item.versionId,
          workerId: item.workerId,
          valid: !state.mismatch,
          status: state.mismatch ? 'ALTERED' : 'VALID',
          expectedHash: item.sha256,
          actualHash: state.mismatch ? 'b'.repeat(64) : item.sha256,
          checkedAt: '2026-10-15T13:00:00Z',
        },
      });
      return;
    }
    if (url.pathname.endsWith('/download')) {
      state.downloads++;
      if (state.delay)
        await new Promise((resolve) => setTimeout(resolve, state.delay));
      const bytes = state.tampered
        ? Buffer.alloc(item.size, 65)
        : item.id === first.id
          ? pdf
          : item.id === older.id
            ? oldPdf
            : otherPdf;
      await route.fulfill({ contentType: 'application/pdf', body: bytes });
      return;
    }
    throw new Error('Ruta no esperada en la simulación.');
  });
  return state;
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-my-worker',
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});
test('Desde el portal consulta por período y descarga con hash recibido verificado', async ({
  page,
}, info) => {
  const state = await simulate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/portal');
  await page
    .getByRole('link', { name: 'Mis liquidaciones', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Mis liquidaciones', exact: true }),
  ).toBeVisible();
  const list = page.getByRole('list', { name: 'Mis liquidaciones publicadas' });
  await expect(list.getByRole('heading').first()).toHaveText(
    'septiembre de 2026',
  );
  await page.getByLabel('Período', { exact: true }).selectOption('2026-08');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('heading')).toHaveText('agosto de 2026');
  await page.getByLabel('Período', { exact: true }).selectOption('');
  await expect(
    list.getByText(new RegExp('· ' + pdf.length + ' B$')),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Subir|Publicar|Editar|Eliminar/ }),
  ).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('button', {
      name: 'Descargar liquidación de septiembre de 2026',
    })
    .click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe(first.fileName);
  const stream = await downloaded.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(sha(Buffer.concat(chunks))).toBe(first.sha256);
  expect(state.downloads).toBe(1);
  await expect(page.getByRole('status')).toContainText('Descarga verificada');
  await list.getByText('Ver datos del archivo').first().click();
  await expect(list.getByText(first.sha256, { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  await mkdir('output/playwright/my-payslips', { recursive: true });
  await page.screenshot({
    path: 'output/playwright/my-payslips/' + info.project.name + '.png',
    fullPage: true,
  });
  await expect(
    page.getByRole('link', { name: 'Inicio', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test('Bloquea integridad fallida y bytes alterados; evita doble descarga mientras verifica', async ({
  page,
}) => {
  const state = await simulate(page);
  state.mismatch = true;
  let events = 0;
  page.on('download', () => {
    events++;
  });
  await page.goto('/portal/liquidaciones');
  const action = page.getByRole('button', {
    name: 'Descargar liquidación de septiembre de 2026',
  });
  await action.click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Archivo alterado',
  );
  expect(state.downloads).toBe(0);
  expect(events).toBe(0);
  state.mismatch = false;
  state.tampered = true;
  state.delay = 600;
  await action.click();
  await expect(action).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Actualizar listado' }),
  ).toBeDisabled();
  await expect(action).toBeEnabled();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Archivo alterado',
  );
  expect(state.downloads).toBe(1);
  expect(events).toBe(0);
  await expect(
    page.getByText('Archivo recibido verificado con SHA-256.'),
  ).toHaveCount(0);
});
test('No muestra respuestas mezcladas con otro trabajador o pendiente de firma', async ({
  page,
}) => {
  const state = await simulate(page);
  state.items = [
    first,
    { ...older, workerId: otherWorker, fileName: 'privado-otro.pdf' },
  ];
  await page.goto('/portal/liquidaciones');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText('no pudo verificarse');
  await expect(page.getByText('privado-otro.pdf')).toHaveCount(0);
  await expect(page.getByText(first.fileName)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Descargar liquidación/ }),
  ).toHaveCount(0);
  state.items = [
    first,
    {
      ...older,
      status: 'PENDING_SIGNATURE',
      fileName: 'pendiente-privada.pdf',
    },
  ];
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(alert).toContainText('no pudo verificarse');
  await expect(page.getByText('pendiente-privada.pdf')).toHaveCount(0);
  state.items = [first];
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Mis liquidaciones publicadas' })
      .getByRole('listitem'),
  ).toHaveCount(1);
});
test('Error, respuesta inválida y vacío se distinguen y permiten reintentar', async ({
  page,
}) => {
  const state = await simulate(page);
  state.error = 503;
  await page.goto('/portal/liquidaciones');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText(
    'servicio de liquidaciones aún no está disponible',
  );
  await expect(page.getByText('Disponibles en tu cuenta: 0')).toHaveCount(0);
  await expect(page.getByText('private-secret')).toHaveCount(0);
  state.error = 0;
  state.malformed = true;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(alert).toContainText('no pudo verificarse');
  state.malformed = false;
  state.items = [];
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Aún no tienes liquidaciones publicadas',
    }),
  ).toBeVisible();
  await expect(page.getByText('Disponibles en tu cuenta: 0')).toBeVisible();
});
test('Cambiar de cuenta no reutiliza liquidaciones del trabajador anterior', async ({
  page,
  context,
  baseURL,
}) => {
  const state = await simulate(page);
  await page.goto('/portal/liquidaciones');
  await expect(page.getByText(first.fileName, { exact: true })).toBeVisible();
  await context.clearCookies();
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-my-other',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  state.items = [accountB];
  await page.reload();
  await expect(
    page.getByText(accountB.fileName, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(first.fileName, { exact: true })).toHaveCount(0);
  await expect(page.getByText(older.fileName, { exact: true })).toHaveCount(0);
});
test('Sin simular liquidaciones: rol, sesión, solo lectura y rechazo de parámetros de trabajador', async ({
  page,
  context,
  baseURL,
}) => {
  const paths = [
    '/api/my-payroll',
    '/api/my-payroll/' + first.id + '/integrity',
    '/api/my-payroll/' + first.id + '/download',
  ];
  for (const path of paths) {
    const response = await context.request.get(path);
    expect(response.status()).toBe(path === '/api/my-payroll' ? 200 : 404);
    expect(response.headers()['cache-control']).toContain('no-store');
  }
  expect(
    (
      await context.request.get('/api/my-payroll?workerId=' + otherWorker)
    ).status(),
  ).toBe(400);
  expect(
    (await context.request.get(paths[2] + '?workerId=' + otherWorker)).status(),
  ).toBe(400);
  expect((await context.request.get('/api/my-payroll/unknown')).status()).toBe(
    404,
  );
  expect(
    (await context.request.post('/api/my-payroll', { data: {} })).status(),
  ).toBe(405);
  await page.goto('/portal/liquidaciones');
  await expect(page.getByRole('heading', { name: 'Aún no tienes liquidaciones publicadas' })).toBeVisible();
  for (const token of [
    'test-my-admin',
    'test-my-accountant',
  ]) {
    await context.clearCookies();
    await context.addCookies([
      { name: 'mf_access', value: token, url: baseURL!, httpOnly: true },
    ]);
    for (const path of paths)
      expect((await context.request.get(path)).status()).toBe(403);
    await page.goto('/portal/liquidaciones');
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden/);
  }
  await context.clearCookies();
  expect((await context.request.get('/api/my-payroll')).status()).toBe(401);
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'expired-test-token',
      url: baseURL!,
      httpOnly: true,
    },
    {
      name: 'mf_refresh',
      value: 'expired-test-refresh',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  expect((await context.request.get('/api/my-payroll')).status()).toBe(401);
  expect(
    (await context.cookies()).some((cookie) =>
      ['mf_access', 'mf_refresh'].includes(cookie.name),
    ),
  ).toBe(false);
  await page.goto('/portal/liquidaciones');
  await expect(page).toHaveURL(/\/login\?reason=session/);
});

// Regresión del layout y de los controles compartidos tras actualizar con main.
test('Diseño compartido: una cabecera, un menú y controles accesibles', async ({ page }, info) => {
  await page.goto('/portal/liquidaciones');
  await expect(page.getByRole('heading', { level: 1, name: 'Mis liquidaciones' })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.getByText('Mi sesión', { exact: true })).toHaveCount(1);
  const active = page.locator('nav [aria-current="page"]');
  await expect(active).toHaveAttribute('href', '/portal/liquidaciones');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.screenshot({ path: info.outputPath('design.png'), fullPage: true });
});
