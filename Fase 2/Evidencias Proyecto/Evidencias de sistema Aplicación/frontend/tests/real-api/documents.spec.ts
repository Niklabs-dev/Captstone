import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo con backend y base reales de pruebas.',
);

test('API real: carga, nuevas versiones inmutables, hash, descarga y conservación', async ({
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
  expect(
    (
      await context.request.post('/api/auth/login', {
        headers: { Origin: baseURL! },
        data: credentials,
      })
    ).status(),
  ).toBe(200);
  await page.goto('/admin/documentos');
  await page.getByRole('button', { name: /worker Integración/ }).click();
  await page
    .getByRole('button', { name: 'Subir documento', exact: true })
    .click();
  const title = `Documento real ${info.project.name} ${Date.now()}`;
  const first = Buffer.from(`%PDF-1.7\n${title}-v1\n%%EOF`),
    second = Buffer.from(`%PDF-1.7\n${title}-v2\n%%EOF`);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del documento').fill(title);
  await dialog
    .getByLabel('Tipo de documento', { exact: true })
    .selectOption('CONTRATO');
  await dialog.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'contrato firmado.pdf',
    mimeType: 'application/pdf',
    buffer: first,
  });
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/documents') &&
      response.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'Guardar documento', exact: true })
    .click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const document: {
    id: string;
    retainUntil: string;
    latestVersion: { id: string; number: number };
  } = await created.json();
  expect(document.retainUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(document.latestVersion.number).toBe(1);
  await expect(dialog).toHaveCount(0);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toContainText('Eliminación bloqueada');
  await row.getByRole('button', { name: 'Nueva versión', exact: true }).click();
  await dialog.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'contrato firmado versión 2.pdf',
    mimeType: 'application/pdf',
    buffer: second,
  });
  await dialog
    .getByRole('button', { name: 'Guardar nueva versión', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await row.getByRole('button', { name: 'Ver historial', exact: true }).click();
  const history = page.getByRole('region', { name: 'Historial de versiones' });
  await expect(history).toContainText('Versión 2');
  await expect(history).toContainText('Versión 1');
  await row
    .getByRole('button', { name: 'Verificar integridad', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Integridad verificada' }),
  ).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Descargar', exact: true }).click();
  const download = await pendingDownload;
  const downloaded = await download.path();
  if (!downloaded) throw new Error('No se guardó la descarga');
  expect(
    createHash('sha256').update(readFileSync(downloaded)).digest('hex'),
  ).toBe(createHash('sha256').update(second).digest('hex'));
  await page.reload();
  await page.getByRole('button', { name: /worker Integración/ }).click();
  await expect(row).toContainText('v2');
  const folder = await context.request.get(
    '/api/documents?workerId=' + fixtures.worker.id,
  );
  expect(folder.status()).toBe(200);
  await page.screenshot({
    path: info.outputPath('documents-real.png'),
    fullPage: true,
  });
});
