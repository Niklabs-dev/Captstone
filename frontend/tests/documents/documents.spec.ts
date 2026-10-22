import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import type {
  WorkerDocument,
  DocumentVersion,
  UploadPolicy,
} from '../../src/lib/documents';

const workerId = '10000000-0000-4000-8000-000000000210';
const documentId = '20000000-0000-4000-8000-000000000210';
const pdf = Buffer.from('%PDF-1.7\nDocumento simulado de prueba\n%%EOF');
const oldPdf = Buffer.from('%PDF-1.7\nVersion anterior de prueba\n%%EOF');
const sha = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');
const version: DocumentVersion = {
  id: '30000000-0000-4000-8000-000000000210',
  number: 2,
  fileName: 'contrato.pdf',
  mime: 'application/pdf',
  size: pdf.length,
  sha256: sha(pdf),
  createdAt: '2026-10-14T12:00:00Z',
  uploadedBy: 'Administrador de prueba',
};
const oldVersion: DocumentVersion = {
  ...version,
  id: '40000000-0000-4000-8000-000000000210',
  number: 1,
  size: oldPdf.length,
  sha256: sha(oldPdf),
};
const record: WorkerDocument = {
  id: documentId,
  workerId,
  title: 'Contrato de prueba',
  type: 'CONTRATO',
  retainUntil: '2031-10-14',
  deletionBlocked: true,
  deletionReason:
    'No se puede eliminar mientras siga vigente el plazo de conservación informado por el servidor.',
  latestVersion: version,
};
const policy: UploadPolicy = {
  maxBytes: 1024 * 1024,
  allowedMimes: ['application/pdf', 'image/png', 'image/jpeg'],
  canUpload: true,
};
interface Simulation {
  documents: WorkerDocument[];
  versions: DocumentVersion[];
  policy: UploadPolicy;
  error: boolean;
  malformed: boolean;
  mismatch: boolean;
  tampered: boolean;
  uploads: number;
  downloads: number;
  delay: number;
}
async function simulate(page: Page): Promise<Simulation> {
  const state: Simulation = {
    documents: [{ ...record }],
    versions: [{ ...version }, { ...oldVersion }],
    policy: { ...policy },
    error: false,
    malformed: false,
    mismatch: false,
    tampered: false,
    uploads: 0,
    downloads: 0,
    delay: 0,
  };
  await page.route('**/api/documents**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (state.delay)
      await new Promise((resolve) => setTimeout(resolve, state.delay));
    if (state.error) {
      await route.fulfill({ status: 503, json: { message: 'private-error' } });
      return;
    }
    if (url.pathname === '/api/documents' && request.method() === 'POST') {
      const data = await new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': request.headers()['content-type'] },
        body: new Uint8Array(request.postDataBuffer() ?? Buffer.alloc(0)),
      }).formData();
      const file = data.get('file');
      if (!file || typeof file === 'string')
        throw new Error('No se envió archivo multipart.');
      const previous = data.get('documentId')
        ? state.documents.find((item) => item.id === data.get('documentId'))
        : null;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fresh: DocumentVersion = {
        ...version,
        id: '50000000-0000-4000-8000-000000000210',
        number: previous ? previous.latestVersion.number + 1 : 1,
        size: bytes.length,
        mime: 'application/pdf',
        fileName: file.name,
        sha256: sha(bytes),
      };
      const next: WorkerDocument = {
        ...record,
        id: previous?.id ?? '21000000-0000-4000-8000-000000000210',
        workerId: String(data.get('workerId')),
        title: String(data.get('title')),
        type: String(data.get('documentTypeCode')) as WorkerDocument['type'],
        latestVersion: fresh,
      };
      state.uploads++;
      state.documents = [
        next,
        ...state.documents.filter((item) => item.id !== next.id),
      ];
      state.versions = [fresh, ...state.versions];
      await route.fulfill({ status: 201, json: next });
      return;
    }
    if (url.pathname.endsWith('/versions')) {
      await route.fulfill({
        json: { documentId, workerId, versions: state.versions },
      });
      return;
    }
    const requested =
      state.versions.find((item) => url.pathname.includes(item.id)) ?? version;
    if (url.pathname.endsWith('/integrity')) {
      await route.fulfill({
        json: {
          versionId: requested.id,
          valid: !state.mismatch,
          status: state.mismatch ? 'ALTERED' : 'VALID',
          expectedHash: requested.sha256,
          actualHash: state.mismatch ? 'b'.repeat(64) : requested.sha256,
          checkedAt: '2026-10-14T13:00:00Z',
        },
      });
      return;
    }
    if (url.pathname.endsWith('/download')) {
      state.downloads++;
      const bytes = state.tampered
        ? Buffer.alloc(requested.size, 65)
        : requested.number === 1
          ? oldPdf
          : pdf;
      await route.fulfill({ contentType: 'application/pdf', body: bytes, headers: { 'Content-Disposition': "attachment; filename=ANEXO_Anexo_v1.pdf; filename*=UTF-8''ANEXO_Anexo-jornada-Ana_v1.pdf" } });
      return;
    }
    const selectedWorker = url.searchParams.get('workerId');
    await route.fulfill({
      json: state.malformed
        ? { items: 'incorrecto' }
        : {
            items: selectedWorker === workerId ? state.documents : [],
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
      value: 'test-documents-admin',
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
});
test('Carpeta, filtros, historial, bloqueo de conservación y descarga con hash verificado', async ({
  page,
}, info) => {
  const state = await simulate(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/admin/documentos');
  await expect(
    page.getByRole('heading', { name: 'Selecciona un trabajador' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await expect(
    page.getByText('Contrato de prueba', { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByLabel('Tipo de documento', { exact: true })
    .selectOption('ANEXO');
  await expect(page.getByText('Sin documentos de este tipo')).toBeVisible();
  await page.getByLabel('Tipo de documento', { exact: true }).selectOption('');
  await page
    .getByRole('button', { name: 'Ver historial', exact: true })
    .click();
  await expect(
    page.getByText('Versión 1 · Anterior', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Eliminación bloqueada por conservación', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Eliminar/ })).toHaveCount(0);
  const history = page.getByRole('region', { name: 'Historial de versiones' });
  const downloaded = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Descargar', exact: true })
    .first()
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('ANEXO_Anexo-jornada-Ana_v1.pdf');
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(sha(Buffer.concat(chunks))).toBe(version.sha256);
  expect(state.downloads).toBe(1);
  await expect(
    page.getByText('Verificado ahora', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar historial' }).click();
  await page
    .getByRole('button', { name: 'Ver historial', exact: true })
    .click();
  await expect(
    page.getByText('Versión 2 · Actual', { exact: true }),
  ).toBeVisible();
  await expect(history).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.cookie)).not.toContain('mf_access');
  await mkdir('output/playwright/documents', { recursive: true });
  await page.screenshot({
    path: 'output/playwright/documents/' + info.project.name + '.png',
    fullPage: true,
  });
  await page.getByLabel('Buscar trabajador').fill('sin coincidencias');
  await expect(
    page.getByText('No hay trabajadores que coincidan con los filtros.'),
  ).toBeVisible();
  await page.getByLabel('Buscar trabajador').fill('');
  await page
    .getByLabel('Local', { exact: true })
    .selectOption('61000000-0000-4000-8000-000000000210');
  await expect(
    page.getByRole('button', { name: /María Prueba/ }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /Camila Prueba/ })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});
test('Valida archivo y crea nueva versión sin sobrescribir el historial anterior', async ({
  page,
}) => {
  const state = await simulate(page);
  await page.goto('/admin/documentos');
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await page
    .getByRole('button', { name: 'Nueva versión', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Cargar nueva versión' });
  await dialog.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'mal.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('no'),
  });
  await dialog.getByRole('button', { name: 'Guardar nueva versión' }).click();
  await expect(dialog.getByRole('alert')).toContainText('formato');
  expect(state.uploads).toBe(0);
  await dialog.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'contrato.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await dialog.getByRole('button', { name: 'Guardar nueva versión' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('Contrato · v3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver historial' }).click();
  await expect(page.getByText('Versión 3 · Actual')).toBeVisible();
  await expect(page.getByText('Versión 1 · Anterior')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar historial' }).click();
  await page
    .getByRole('button', { name: 'Subir documento', exact: true })
    .click();
  const fresh = page.getByRole('dialog', { name: 'Subir documento' });
  await fresh.getByLabel('Nombre del documento').fill('Pacto de prueba');
  await fresh.getByLabel('Tipo de documento').selectOption('PACTO');
  await fresh.getByLabel('Archivo', { exact: true }).setInputFiles({
    name: 'pacto.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await fresh.getByRole('button', { name: 'Guardar documento' }).click();
  await expect(fresh).not.toBeVisible();
  await expect(
    page.getByText('Pacto de prueba', { exact: true }),
  ).toBeVisible();
  expect(state.uploads).toBe(2);
});
test('Bloquea discrepancias del servicio y bytes alterados; respeta carpeta de solo consulta', async ({
  page,
}) => {
  const state = await simulate(page);
  state.mismatch = true;
  state.policy.canUpload = false;
  await page.goto('/admin/documentos');
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await expect(
    page.getByRole('button', { name: 'Subir documento', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Descargar', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'integridad no coincide',
  );
  expect(state.downloads).toBe(0);
  state.mismatch = false;
  state.tampered = true;
  await page.getByRole('button', { name: 'Descargar', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'archivo recibido pudo ser alterado',
  );
  expect(state.downloads).toBe(1);
});
test('Carga, vacío, error, contrato inválido y cambio rápido de trabajador no dejan datos cruzados', async ({
  page,
}) => {
  const state = await simulate(page);
  state.delay = 1200;
  await page.goto('/admin/documentos');
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Consultando documentos' }),
  ).toBeVisible();
  state.delay = 0;
  await page.getByRole('button', { name: /Diego Prueba/ }).click();
  await expect(
    page.getByText('Esta carpeta aún no tiene documentos'),
  ).toBeVisible();
  await expect(
    page.getByText('Contrato de prueba', { exact: true }),
  ).toHaveCount(0);
  state.error = true;
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'servicio documental aún no está disponible',
  );
  await expect(page.getByText('0 documentos', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Subir documento', exact: true }),
  ).toBeDisabled();
  state.error = false;
  state.malformed = true;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'respuesta del servicio no pudo verificarse',
  );
  state.malformed = false;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(
    page.getByText('Contrato de prueba', { exact: true }),
  ).toBeVisible();
});
test('BFF conectado: RBAC, CSRF, listado real del adaptador y cuenta inactiva', async ({
  page,
  context,
  baseURL,
}) => {
  const api = baseURL + '/api/documents';
  expect((await context.request.get(api + '?workerId=' + workerId)).status()).toBe(200);
  expect(
    (
      await context.request.post(api, {
        headers: { Origin: 'https://external.example' },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await context.request.post(api, {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(400);
  expect((await context.request.delete(api)).status()).toBe(405);
  await page.goto('/admin/documentos');
  await page.getByRole('button', { name: /Camila Prueba/ }).click();
  await expect(page.getByRole('heading', { name: 'Esta carpeta aún no tiene documentos' })).toBeVisible();
  for (const role of ['worker', 'supervisor', 'accountant']) {
    await context.clearCookies();
    await context.addCookies([
      {
        name: 'mf_access',
        value: 'test-documents-' + role,
        url: baseURL!,
        httpOnly: true,
      },
    ]);
    expect((await context.request.get(api)).status()).toBe(403);
    await page.goto('/admin/documentos');
    await expect(page).toHaveURL(
      role === 'worker'
        ? /\/portal\?reason=forbidden$/
        : /\/dashboard\?reason=forbidden$/,
    );
  }
  await context.clearCookies();
  expect((await context.request.get(api)).status()).toBe(401);
  await page.goto('/admin/documentos');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  await context.addCookies([
    {
      name: 'mf_access',
      value: 'test-documents-inactive',
      url: baseURL!,
      httpOnly: true,
    },
  ]);
  await page.goto('/admin/documentos');
  await expect(page).toHaveURL(/\/login\?reason=session$/);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === 'mf_access'),
  ).toBe(false);
});

// Regresión del layout y de los controles compartidos tras actualizar con main.
test('Diseño compartido: una cabecera, un menú y controles accesibles', async ({ page }, info) => {
  await page.goto('/admin/documentos');
  await expect(page.getByRole('heading', { level: 1, name: 'Gestor documental' })).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.getByRole('navigation')).toHaveCount(1);
  await expect(page.getByText('Mi sesión', { exact: true })).toHaveCount(1);
  const active = page.locator('nav [aria-current="page"]');
  await expect(active).toHaveAttribute('href', '/admin/documentos');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.screenshot({ path: info.outputPath('design.png'), fullPage: true });
});
