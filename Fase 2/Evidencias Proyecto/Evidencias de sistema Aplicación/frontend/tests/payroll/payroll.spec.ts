import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Payroll, PayrollWorker } from '../../src/lib/payroll';

const pdf = Buffer.from('%PDF-1.7\nliquidacion sintetica\n%%EOF');
const hash = createHash('sha256').update(pdf).digest('hex');
const camila: PayrollWorker = {
  id: '30000000-0000-4000-8000-000000000216',
  name: 'Camila Prueba',
  isActive: true,
  store: {
    id: '40000000-0000-4000-8000-000000000216',
    name: 'Local de prueba Centro',
  },
};
const diego: PayrollWorker = {
  ...camila,
  id: '31000000-0000-4000-8000-000000000216',
  name: 'Diego Prueba',
  store: {
    id: '41000000-0000-4000-8000-000000000216',
    name: 'Local de prueba Norte',
  },
};
const inactive: PayrollWorker = {
  ...camila,
  id: '32000000-0000-4000-8000-000000000216',
  name: 'Trabajador Inactivo',
  isActive: false,
};
const pending: Payroll = {
  id: '10000000-0000-4000-8000-000000000216',
  worker: camila,
  period: '2026-09',
  fileName: 'liquidacion.pdf',
  size: pdf.length,
  sha256: hash,
  createdAt: '2026-10-14T12:00:00Z',
  publishedAt: null,
  status: 'PENDING_SIGNATURE',
  revision: 'revision-1',
  canPublish: true,
};
const second: Payroll = {
  ...pending,
  id: '11000000-0000-4000-8000-000000000216',
  worker: diego,
};
const published: Payroll = {
  ...pending,
  id: '12000000-0000-4000-8000-000000000216',
  period: '2026-08',
  status: 'PUBLISHED',
  publishedAt: '2026-10-14T13:00:00Z',
  canPublish: false,
};
async function simulate(page: Page) {
  const state = {
    items: [pending, second, published],
    workers: [camila, diego, inactive],
    policy: {
      maxBytes: 1048576,
      allowedMimes: ['application/pdf'],
      canUpload: true,
    },
    error: 0,
    malformed: false,
    postError: 0,
    wrongPublication: false,
    uploads: 0,
    publications: 0,
    delayed: false,
  };
  await page.route('**/api/payroll**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST') {
      if (state.delayed)
        await new Promise((resolve) => setTimeout(resolve, 700));
      if (state.postError) {
        await route.fulfill({
          status: state.postError,
          json: { message: 'private-error' },
        });
        return;
      }
      if (url.pathname.endsWith('/publish')) {
        state.publications++;
        const item = state.items.find(
          (item) => item.id === url.pathname.split('/')[3],
        );
        if (!item) throw new Error('Registro de prueba no encontrado.');
        expect(request.postDataJSON()).toEqual({ revision: item.revision });
        const result: Payroll = {
          ...item,
          status: 'PUBLISHED',
          publishedAt: '2026-10-14T15:00:00Z',
          revision: 'revision-2',
          canPublish: false,
          sha256: state.wrongPublication ? 'b'.repeat(64) : item.sha256,
        };
        if (!state.wrongPublication)
          state.items = state.items.map((previous) =>
            previous.id === result.id ? result : previous,
          );
        await route.fulfill({ json: result });
        return;
      }
      const form = await new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': request.headers()['content-type'] },
        body: new Uint8Array(request.postDataBuffer() ?? Buffer.alloc(0)),
      }).formData();
      const file = form.get('file');
      if (!file || typeof file === 'string')
        throw new Error('Falta PDF de prueba.');
      const person = state.workers.find(
        (worker) => worker.id === form.get('workerId'),
      );
      if (!person) throw new Error('Falta trabajador de prueba.');
      const result: Payroll = {
        ...pending,
        id: '13000000-0000-4000-8000-000000000216',
        worker: person,
        period: String(form.get('period')),
        fileName: file.name,
        size: file.size,
        sha256: createHash('sha256')
          .update(Buffer.from(await file.arrayBuffer()))
          .digest('hex'),
      };
      state.uploads++;
      state.items = [result, ...state.items];
      await route.fulfill({ status: 201, json: result });
      return;
    }
    if (state.error) {
      await route.fulfill({
        status: state.error,
        json: { message: 'private-error' },
      });
      return;
    }
    await route.fulfill({
      json: {
        items: state.malformed ? 'bad' : state.items,
        workers: state.workers,
        policy: state.policy,
      },
    });
  });
  return state;
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-payroll-accountant',
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});

test('Listado, estados, metadatos y filtros por local, período y estado en escritorio/móvil', async ({
  page,
}, info) => {
  await simulate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/liquidaciones');
  const list = page.getByRole('list', { name: 'Liquidaciones', exact: true });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await page.getByLabel('Local', { exact: true }).selectOption(diego.store.id);
  await expect(list.getByRole('heading')).toHaveText('Diego Prueba');
  await page.getByLabel('Período', { exact: true }).fill('2026-08');
  await expect(
    page.getByRole('heading', { name: 'Sin resultados para estos filtros' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByLabel('Estado', { exact: true }).selectOption('PUBLISHED');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(
    list.getByRole('button', { name: 'Publicar', exact: true }),
  ).toHaveCount(0);
  await expect(
    list.getByText(
      'Visible para su trabajador. No se puede editar ni eliminar.',
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel('Estado', { exact: true }).selectOption('');
  await list.getByText('Ver metadatos').first().click();
  await expect(list.getByText(hash, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Editar|Eliminar/ }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  await mkdir('output/playwright/payroll', { recursive: true });
  await page.screenshot({
    path: 'output/playwright/payroll/' + info.project.name + '.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('Carga valida cabecera PDF, trabajador activo y duplicados; guarda solo pendiente', async ({
  page,
}) => {
  const state = await simulate(page);
  await page.goto('/liquidaciones');
  await page.getByRole('button', { name: 'Subir liquidación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Subir liquidación' });
  await expect(
    dialog.getByRole('option', { name: /Trabajador Inactivo/ }),
  ).toHaveCount(0);
  await dialog
    .getByLabel('Trabajador', { exact: true })
    .selectOption(camila.id);
  await dialog.getByLabel('Período', { exact: true }).fill('2026-09');
  await dialog.getByLabel('Archivo PDF', { exact: true }).setInputFiles({
    name: 'liquidacion.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await dialog
    .getByRole('button', { name: 'Guardar pendiente de firma' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('Ya existe');
  expect(state.uploads).toBe(0);
  await dialog.getByLabel('Período', { exact: true }).fill('2026-10');
  await dialog.getByLabel('Archivo PDF', { exact: true }).setInputFiles({
    name: 'bad.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('bad'),
  });
  await dialog
    .getByRole('button', { name: 'Guardar pendiente de firma' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('formato PDF');
  await dialog.getByLabel('Archivo PDF', { exact: true }).setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('bad'),
  });
  await dialog
    .getByRole('button', { name: 'Guardar pendiente de firma' })
    .click();
  await expect(dialog.getByRole('alert')).toContainText('cabecera PDF');
  expect(state.uploads).toBe(0);
  await dialog.getByLabel('Archivo PDF', { exact: true }).setInputFiles({
    name: 'liquidacion.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await dialog
    .getByRole('button', { name: 'Guardar pendiente de firma' })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText('pendiente de firma');
  await expect(
    page
      .getByRole('list', { name: 'Liquidaciones', exact: true })
      .getByRole('listitem'),
  ).toHaveCount(4);
  expect(state.uploads).toBe(1);
});
test('Publicación exige confirmar, restaura foco al cancelar y bloquea doble envío', async ({
  page,
}) => {
  const state = await simulate(page);
  state.delayed = true;
  await page.goto('/liquidaciones');
  const first = page
    .getByRole('button', { name: 'Publicar', exact: true })
    .first();
  await first.click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar publicación' });
  await expect(
    dialog.getByText('Camila Prueba', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText('septiembre de 2026', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Publicar liquidación' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(first).toBeFocused();
  expect(state.publications).toBe(0);
  await first.click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Publicar liquidación' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Guardando…' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Liquidación publicada para Camila Prueba',
  );
  expect(state.publications).toBe(1);
  await page.getByRole('button', { name: 'Actualizar listado' }).click();
  await expect(
    page.getByRole('button', { name: 'Publicar', exact: true }),
  ).toHaveCount(1);
});
test('Conflicto o contenido cambiado no anuncian publicación y conservan pendiente', async ({
  page,
}) => {
  const state = await simulate(page);
  state.postError = 409;
  await page.goto('/liquidaciones');
  await page
    .getByRole('button', { name: 'Publicar', exact: true })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Publicar liquidación' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'La liquidación cambió',
  );
  await expect(
    page.getByRole('button', { name: 'Publicar', exact: true }),
  ).toHaveCount(2);
  state.postError = 0;
  state.wrongPublication = true;
  await dialog.getByRole('button', { name: 'Publicar liquidación' }).click();
  await expect(dialog.getByRole('alert')).toContainText('no pudo verificarse');
  await expect(page.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
});
test('Recupera error, contrato inválido y vacío; respeta políticas de carga/publicación', async ({
  page,
}) => {
  const state = await simulate(page);
  state.error = 503;
  await page.goto('/liquidaciones');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText(
    'servicio de liquidaciones aún no está disponible',
  );
  await expect(
    page.getByText('Pendientes de firma: 0 · Publicadas: 0'),
  ).toHaveCount(0);
  await expect(page.getByText('private-error')).toHaveCount(0);
  state.error = 0;
  state.malformed = true;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(alert).toContainText('no pudo verificarse');
  state.malformed = false;
  state.items = [{ ...pending, canPublish: false }];
  state.policy.canUpload = false;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(
    page.getByRole('button', { name: 'Subir liquidación' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Publicar', exact: true }),
  ).toBeDisabled();
  state.items = [];
  await page.getByRole('button', { name: 'Actualizar listado' }).click();
  await expect(
    page.getByRole('heading', { name: 'Aún no hay liquidaciones' }),
  ).toBeVisible();
});
test('BFF autoriza lectura/escritura por rol y origen; administrador solo consulta', async ({
  page,
  context,
  baseURL,
}) => {
  expect((await context.request.get('/api/payroll')).status()).toBe(503);
  expect(
    (
      await context.request.post('/api/payroll', {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await context.request.post('/api/payroll/x/publish', {
        headers: { Origin: 'https://other.example.test' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await context.request.delete('/api/payroll/x')).status()).toBe(405);
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Abrir liquidaciones' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'servicio de liquidaciones aún no está disponible',
  );
  await context.clearCookies();
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-payroll-admin',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  expect((await context.request.get('/api/payroll')).status()).toBe(503);
  for (const path of [
    '/api/payroll',
    '/api/payroll/' + pending.id + '/publish',
  ])
    expect(
      (
        await context.request.post(path, {
          headers: { Origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(403);
  await simulate(page);
  await page.goto('/liquidaciones');
  await expect(page.getByText(/Acceso de consulta/)).toBeVisible();
  await expect(
    page
      .getByRole('list', { name: 'Liquidaciones', exact: true })
      .getByRole('listitem'),
  ).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Subir liquidación' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Publicar', exact: true }),
  ).toHaveCount(0);
  await page.unroute('**/api/payroll**');
  for (const [token, destination] of [
    ['test-payroll-worker', '/portal'],
    ['test-payroll-supervisor', '/dashboard'],
  ]) {
    await context.clearCookies();
    await context.addCookies([
      { name: 'mf_access', value: token, url: baseURL!, httpOnly: true },
    ]);
    expect((await context.request.get('/api/payroll')).status()).toBe(403);
    expect(
      (
        await context.request.post('/api/payroll', {
          headers: { Origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(403);
    await page.goto('/liquidaciones');
    await expect(page).toHaveURL(
      new RegExp(destination + '\\?reason=forbidden'),
    );
  }
  await context.clearCookies();
  expect((await context.request.get('/api/payroll')).status()).toBe(401);
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-payroll-expired',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  expect((await context.request.get('/api/payroll')).status()).toBe(401);
  await page.goto('/liquidaciones');
  await expect(page).toHaveURL(/\/login\?reason=session/);
});
