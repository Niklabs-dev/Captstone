import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import type { DtAlert } from '../../src/lib/dt-alerts';

const overdue: DtAlert = {
  id: '10000000-0000-4000-8000-000000000211',
  documentId: '20000000-0000-4000-8000-000000000211',
  contractTitle: 'Contrato de prueba Camila',
  worker: { id: '30000000-0000-4000-8000-000000000211', name: 'Camila Prueba' },
  store: {
    id: '40000000-0000-4000-8000-000000000211',
    name: 'Local de prueba Centro',
  },
  deadline: '2026-10-13',
  daysRemaining: -1,
  status: 'OVERDUE',
  revision: 'revision-1',
  canRegister: true,
};
const upcoming: DtAlert = {
  ...overdue,
  id: '11000000-0000-4000-8000-000000000211',
  documentId: '21000000-0000-4000-8000-000000000211',
  contractTitle: 'Contrato de prueba Diego',
  worker: { ...overdue.worker, name: 'Diego Prueba' },
  store: {
    id: '41000000-0000-4000-8000-000000000211',
    name: 'Local de prueba Norte',
  },
  deadline: '2026-10-16',
  daysRemaining: 2,
  status: 'UPCOMING',
};
async function simulate(page: Page) {
  const state = {
    items: [overdue, upcoming],
    error: 0,
    malformed: false,
    posts: 0,
    postError: 0,
    wrongConfirmation: false,
    delayedPost: false,
  };
  await page.route('**/api/dt-alerts**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST') {
      state.posts++;
      if (state.delayedPost)
        await new Promise((resolve) => setTimeout(resolve, 600));
      if (state.postError) {
        await route.fulfill({
          status: state.postError,
          json: { message: 'private-error' },
        });
        return;
      }
      const id = new URL(request.url()).pathname.split('/')[3];
      const item = state.items.find((candidate) => candidate.id === id);
      if (!item) throw new Error('Alerta de prueba no encontrada.');
      expect(request.postDataJSON()).toEqual({
        documentId: item.documentId,
        revision: item.revision,
      });
      if (!state.wrongConfirmation)
        state.items = state.items.filter((candidate) => candidate.id !== id);
      await route.fulfill({
        json: {
          alertId: item.id,
          documentId: state.wrongConfirmation
            ? upcoming.documentId
            : item.documentId,
          status: 'REGISTERED',
          registeredAt: '2026-10-14T15:01:00Z',
        },
      });
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
        calculatedAt: '2026-10-14T15:00:00Z',
      },
    });
  });
  return state;
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-dt-admin',
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});

test('Prioridad, días, filtros por local/trabajador/estado y pantalla adaptable', async ({
  page,
}, info) => {
  await simulate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/alertas-dt');
  const list = page.getByRole('list', { name: 'Alertas de contratos' });
  await expect(list.getByRole('heading').first()).toHaveText('Camila Prueba');
  await expect(
    page.getByText('Vencido hace 1 día', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Quedan 2 días', { exact: true })).toBeVisible();
  await expect(page.getByText('13-10-2026', { exact: true })).toBeVisible();
  await page.getByLabel('Estado', { exact: true }).selectOption('UPCOMING');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list.getByRole('heading')).toHaveText('Diego Prueba');
  await page
    .getByLabel('Local', { exact: true })
    .selectOption(overdue.store.id);
  await expect(
    page.getByRole('heading', { name: 'Sin resultados para estos filtros' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await page.getByLabel('Buscar trabajador o contrato').fill('cAmIlA');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByLabel('Buscar trabajador o contrato').fill('');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  await mkdir('output/playwright/dt-alerts', { recursive: true });
  await page.screenshot({
    path: 'output/playwright/dt-alerts/' + info.project.name + '.png',
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test('Confirmación explícita, cancelación, foco y registro persistido sin doble envío', async ({
  page,
}) => {
  const state = await simulate(page);
  state.delayedPost = true;
  await page.goto('/admin/alertas-dt');
  const action = page
    .getByRole('button', { name: 'Marcar como registrado' })
    .first();
  await action.click();
  const dialog = page.getByRole('dialog', {
    name: 'Marcar como registrado en la DT',
  });
  await expect(
    dialog.getByRole('button', { name: 'Confirmar registro' }),
  ).toBeDisabled();
  await expect(
    dialog.getByText('Camila Prueba', { exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(action).toBeFocused();
  expect(state.posts).toBe(0);
  await action.click();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar registro' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Guardando…' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('status')).toContainText(
    'Registro confirmado para Camila Prueba',
  );
  expect(state.posts).toBe(1);
  await expect(
    page
      .getByRole('list', { name: 'Alertas de contratos' })
      .getByRole('listitem'),
  ).toHaveCount(1);
  await page.getByRole('button', { name: 'Actualizar alertas' }).click();
  await expect(
    page
      .getByRole('list', { name: 'Alertas de contratos' })
      .getByRole('heading'),
  ).toHaveText('Diego Prueba');
});
test('Conflicto y respuesta ajena no eliminan alertas ni anuncian éxito', async ({
  page,
}) => {
  const state = await simulate(page);
  state.postError = 409;
  await page.goto('/admin/alertas-dt');
  await page
    .getByRole('button', { name: 'Marcar como registrado' })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Confirmar registro' }).click();
  await expect(dialog.getByRole('alert')).toContainText('El contrato cambió');
  await expect(
    page
      .getByRole('list', { name: 'Alertas de contratos' })
      .getByRole('listitem'),
  ).toHaveCount(2);
  state.postError = 0;
  state.wrongConfirmation = true;
  await dialog.getByRole('button', { name: 'Confirmar registro' }).click();
  await expect(dialog.getByRole('alert')).toContainText('no pudo verificarse');
  await expect(page.getByRole('status')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  state.items = [{ ...overdue, canRegister: false }];
  await page.getByRole('button', { name: 'Actualizar alertas' }).click();
  await expect(
    page.getByRole('button', { name: 'Marcar como registrado' }),
  ).toBeDisabled();
  await expect(page.getByText(/Solo consulta:/)).toBeVisible();
});
test('Errores recuperables, contrato inválido y vacío no equivalen a cero alertas', async ({
  page,
}) => {
  const state = await simulate(page);
  state.error = 503;
  await page.goto('/admin/alertas-dt');
  const alert = page.locator('main').getByRole('alert');
  await expect(alert).toContainText(
    'servicio de alertas DT aún no está disponible',
  );
  await expect(page.getByText('0 pendientes en total')).toHaveCount(0);
  await expect(page.getByText('private-error')).toHaveCount(0);
  state.error = 0;
  state.malformed = true;
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(alert).toContainText('no pudo verificarse');
  state.malformed = false;
  state.items = [];
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sin contratos pendientes de registro' }),
  ).toBeVisible();
  await expect(page.getByText('0 pendientes en total')).toBeVisible();
});
test('Sin simulación DT: sesión activa, roles, origen, métodos y servicio pendiente', async ({
  page,
  context,
  baseURL,
}) => {
  const list = await context.request.get('/api/dt-alerts');
  expect(list.status()).toBe(503);
  expect(list.headers()['cache-control']).toContain('no-store');
  expect(
    (
      await context.request.post('/api/dt-alerts/x/registration', {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(503);
  expect(
    (
      await context.request.post('/api/dt-alerts/x/registration', {
        headers: { Origin: 'https://other.example.test' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await context.request.delete('/api/dt-alerts/x')).status()).toBe(405);
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'Abrir alertas DT' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'servicio de alertas DT aún no está disponible',
  );
  for (const [token, destination] of [
    ['test-dt-worker', '/portal'],
    ['test-dt-supervisor', '/dashboard'],
    ['test-dt-accountant', '/dashboard'],
  ]) {
    await context.clearCookies();
    await context.addCookies([
      { name: 'mf_access', value: token, url: baseURL!, httpOnly: true },
    ]);
    expect((await context.request.get('/api/dt-alerts')).status()).toBe(403);
    await page.goto('/admin/alertas-dt');
    await expect(page).toHaveURL(
      new RegExp(destination + '\\?reason=forbidden'),
    );
    await expect(
      page.getByRole('link', { name: 'Abrir alertas DT' }),
    ).toHaveCount(0);
  }
  await context.clearCookies();
  expect((await context.request.get('/api/dt-alerts')).status()).toBe(401);
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-dt-inactive',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  await page.goto('/admin/alertas-dt');
  await expect(page).toHaveURL(/\/login\?reason=session/);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === 'mf_access'),
  ).toBe(false);
});
