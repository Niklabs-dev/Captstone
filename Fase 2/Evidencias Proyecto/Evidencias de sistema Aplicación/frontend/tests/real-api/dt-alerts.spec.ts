import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3301';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo con NestJS y PostgreSQL reales en un entorno exclusivo.',
);

test('API real: tipos, registro persistente y conflicto al confirmar una revisión antigua', async ({
  page,
  context,
  baseURL,
}, info) => {
  const fixtures: { worker: { id: string } } = JSON.parse(
    readFileSync('output/real-api/fixtures.json', 'utf8'),
  );
  const credentials = {
    email: process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
    password:
      process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
  };
  const login = await context.request.post(backend + '/auth/login', {
    data: credentials,
  });
  expect(login.status()).toBe(200);
  const auth: { accessToken: string } = await login.json();
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL! },
        data: credentials,
      })
    ).status(),
  ).toBe(200);
  const title = `Anexo real ${info.project.name} ${Date.now()}`;
  async function upload(documentId?: string): Promise<{ id: string }> {
    const response = await context.request.post(backend + '/documents', {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      multipart: {
        workerId: fixtures.worker.id,
        documentTypeCode: 'ANEXO',
        title,
        issuedAt: '2026-10-01',
        ...(documentId ? { documentId } : {}),
        file: {
          name: 'anexo firmado.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(
            `%PDF-1.7\n${title}-${documentId ?? 'inicial'}\n%%EOF`,
          ),
        },
      },
    });
    expect(response.status()).toBe(201);
    return response.json();
  }
  const document = await upload();
  await page.goto('/admin/alertas-dt');
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row).toContainText('Anexo');
  await row.getByRole('button', { name: 'Marcar como registrado' }).click();
  await upload(document.id);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirmar registro' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'cambió',
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar alertas' }).click();
  await row.getByRole('button', { name: 'Marcar como registrado' }).click();
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirmar registro' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(row).toHaveCount(0);
  const listed = await context.request.get('/api/dt-alerts');
  expect(listed.status()).toBe(200);
  const result: { items: { id: string }[] } = await listed.json();
  expect(result.items.some((item) => item.id === document.id)).toBe(false);
  await page.screenshot({
    path: info.outputPath('dt-real.png'),
    fullPage: true,
  });
});

// La regresión transversal comprueba el viewport al terminar cada recorrido real.
test.afterEach(async ({ page }) => {
  if (page.url() === 'about:blank') return;
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
