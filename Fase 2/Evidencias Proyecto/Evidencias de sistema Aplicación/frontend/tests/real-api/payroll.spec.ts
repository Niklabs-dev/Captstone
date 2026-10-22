import { formatCalendarDate } from '../../src/lib/display-date';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { payrollBusinessDate } from '../../src/lib/payroll';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Requiere NestJS/PostgreSQL reales en un entorno exclusivo.',
);

test('API real: PDF con tildes, firma explícita, publicación persistente y administrador de consulta', async ({
  page,
  context,
  baseURL,
}, info) => {
  const fixtures: { worker: { id: string }; accountant: { email: string } } =
    JSON.parse(readFileSync('output/real-api/fixtures.json', 'utf8'));
  const login = async (email: string, password: string): Promise<void> => {
    expect(
      (
        await context.request.post('/api/auth/login', {
          headers: { Origin: baseURL! },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
  };
  await login(fixtures.accountant.email, 'Integration-test-2026!');
  const listed = await context.request.get('/api/payroll');
  expect(listed.status()).toBe(200);
  const original: { items: { worker: { id: string }; period: string }[] } =
    await listed.json();
  let month = 1;
  while (
    original.items.some(
      (item) =>
        item.worker.id === fixtures.worker.id &&
        item.period === `2010-${String(month).padStart(2, '0')}`,
    )
  )
    month++;
  const period = `2010-${String(month).padStart(2, '0')}`;
  await page.goto('/liquidaciones');
  await page
    .getByRole('button', { name: 'Subir liquidación', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Trabajador', { exact: true })
    .selectOption(fixtures.worker.id);
  await dialog.getByLabel('Período', { exact: true }).fill(period);
  await dialog.getByLabel('Archivo PDF', { exact: true }).setInputFiles({
    name: 'liquidación septiembre.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(
      `%PDF-1.7\nLiquidación real ${info.project.name} ${Date.now()}\n%%EOF`,
    ),
  });
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/payroll') &&
      response.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'Guardar pendiente de firma' })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const record: { id: string; fileName: string; signedAt: string | null } =
    await created.json();
  expect(record.signedAt).toBeNull();
  await expect(dialog).toHaveCount(0);
  const row = page
    .getByRole('row')
    .filter({
      hasText:
        period === '2010-01'
          ? 'enero de 2010'
          : new Intl.DateTimeFormat('es-CL', {
              month: 'long',
              year: 'numeric',
              timeZone: 'UTC',
            }).format(new Date(period + '-01T12:00:00Z')),
    })
    .filter({ hasText: record.fileName })
    .first();
  await row.getByRole('button', { name: 'Publicar', exact: true }).click();
  const signedAt = payrollBusinessDate();
  await dialog.getByLabel('Fecha de firma', { exact: true }).fill(signedAt);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Publicar liquidación' }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(row).toContainText(formatCalendarDate(signedAt));
  await expect(row).toContainText('Publicada');
  await expect(
    row.getByRole('button', { name: 'Publicar', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath('payroll-real.png'),
    fullPage: true,
  });
  await login(
    process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  );
  await page.goto('/liquidaciones');
  await expect(page.getByText(/Acceso de consulta/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Subir liquidación' }),
  ).toHaveCount(0);
  expect(
    (
      await context.request.post(`/api/payroll/${record.id}/publish`, {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(403);
});
