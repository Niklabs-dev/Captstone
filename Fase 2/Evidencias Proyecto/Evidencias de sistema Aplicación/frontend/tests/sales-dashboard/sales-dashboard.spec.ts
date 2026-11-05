import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { navigateTo } from '../helpers/navigation';

// Recorre el panel completo a través de los Route Handlers reales de Next.js;
// solo el backend NestJS está simulado (tests/sales-dashboard/backend.mjs).

async function signIn(
  context: BrowserContext,
  baseURL: string | undefined,
  token: string,
): Promise<undefined> {
  await context.addCookies([
    {
      name: 'mf_access',
      value: token,
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

async function expectNoHorizontalScroll(page: Page): Promise<undefined> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

function storeCard(page: Page, name: string) {
  return page
    .getByRole('list', { name: 'Resumen por local' })
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test('El administrador ve el consolidado por local con estados de cuadre', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL, 'test-panel-admin');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dashboard');
  await navigateTo(page, 'Panel consolidado');
  await expect(page).toHaveURL(/\/admin\/panel$/);

  const totals = page.getByRole('list', {
    name: 'Totales de todos los locales',
  });
  await expect(totals).toContainText('$975.530');
  await expect(totals).toContainText('$43.602');
  await expect(totals).toContainText('No se suma a las ventas');

  const centro = storeCard(page, 'Local de prueba Centro');
  await expect(centro).toContainText('No cuadrado');
  await expect(centro).toContainText('Tarjeta de débito');
  await expect(centro).toContainText('$511.730');
  await expect(centro).toContainText('Descuadre de vouchers: +$1.600');
  await expect(centro).toContainText('1 vencidas');

  const norte = storeCard(page, 'Local de prueba Norte');
  await expect(norte).toContainText('No cuadrado');
  await expect(norte).toContainText(
    'Hay medios descuadrados que se compensan entre sí.',
  );

  const calera = storeCard(page, 'Local de prueba Calera');
  await expect(calera).toContainText('Sin cierres');
  await expect(calera).not.toContainText('Diferencias pendientes');

  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});

test('El detalle identifica las líneas compensadas y el descuadre de vouchers', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL, 'test-panel-admin');
  await page.goto('/admin/panel');

  await storeCard(page, 'Local de prueba Norte')
    .getByRole('button', { name: /Ver detalle/ })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Detalle del cierre de caja',
  });
  await expect(dialog).toContainText('No cuadrado');
  await expect(dialog).toContainText('Rosa Supervisora');
  const lines = dialog.getByRole('table');
  await expect(
    lines
      .getByRole('row', { name: /Efectivo/ })
      .getByRole('cell')
      .last(),
  ).toHaveText('−$500');
  await expect(
    lines
      .getByRole('row', { name: /Tarjeta de débito/ })
      .getByRole('cell')
      .last(),
  ).toHaveText('+$500');
  await expect(dialog.getByRole('note')).toContainText(
    'el cierre sigue sin cuadrar',
  );
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await storeCard(page, 'Local de prueba Centro')
    .getByRole('button', { name: /Ver detalle/ })
    .click();
  await expect(dialog).toContainText('Propina incluida (PROPINAS)');
  await expect(dialog).toContainText('$31.602');
  await expect(dialog).toContainText('Venta neta Mercado Pago$557.130');
  await expect(dialog).toContainText('Descuadre de vouchers+$1.600');
  await dialog.getByRole('button', { name: 'Cerrar detalle' }).click();
  await expect(dialog).toBeHidden();
});

test('El filtro de fecha consulta el día elegido y rechaza fechas futuras', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL, 'test-panel-admin');
  await page.goto('/admin/panel');
  await expect(
    page.getByRole('list', { name: 'Resumen por local' }),
  ).toBeVisible();

  const request = page.waitForRequest((candidate) =>
    candidate.url().endsWith('/api/sales-dashboard?date=2026-11-03'),
  );
  await page.getByLabel('Día de negocio').fill('2026-11-03');
  await request;
  await expect(
    page.getByRole('heading', { name: 'Resumen del día 03-11-2026' }),
  ).toBeVisible();

  await page.getByLabel('Día de negocio').fill('2099-01-01');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'No se pueden consultar días futuros.' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Resumen del día 03-11-2026' }),
  ).toBeVisible();
});

test('Un error del servicio muestra un mensaje seguro y permite reintentar', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL, 'test-panel-error');
  await page.goto('/admin/panel');
  // Next.js agrega su propio anunciador de rutas con role="alert".
  const alert = page
    .getByRole('alert')
    .filter({ hasText: 'No se pudo cargar el panel' });
  await expect(alert).toBeVisible();
  await expect(alert).not.toContainText('private-error');
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

for (const [token, role] of [
  ['test-panel-supervisor', 'supervisor'],
  ['test-panel-accountant', 'contador'],
] as const)
  test(`El ${role} no ve el panel ni accede por URL o API`, async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL, token);
    await page.goto('/admin/panel');
    await expect(page).toHaveURL(/\/dashboard\?reason=forbidden$/);
    await expect(
      page.getByText('Tu cuenta no tiene acceso a la página solicitada.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Panel consolidado', exact: true }),
    ).toHaveCount(0);
    const response = await page.request.get(
      '/api/sales-dashboard?date=2026-11-04',
    );
    expect(response.status()).toBe(403);
  });
