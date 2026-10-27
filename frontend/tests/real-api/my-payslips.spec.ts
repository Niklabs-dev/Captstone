import { test, expect } from '@playwright/test';
import { formatCalendarDate } from '../../src/lib/display-date';
import { readFileSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo contra NestJS/PostgreSQL y archivos sintéticos de pruebas.',
);
const backend = process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3301';

test('API real: aislamiento, pendientes ocultas, stream verificado, supervisor y archivo ausente', async ({
  page,
  context,
  baseURL,
}, info) => {
  const fixtures: Record<
    'worker' | 'other' | 'supervisor' | 'accountant',
    { id: string; email: string }
  > = JSON.parse(readFileSync('output/real-api/fixtures.json', 'utf8'));
  const password = 'Integration-test-2026!';
  const login = async (email: string): Promise<void> => {
    expect(
      (
        await context.request.post('/api/auth/login', {
          headers: { Origin: baseURL! },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
  };
  const accountantLogin = await context.request.post(backend + '/auth/login', {
    data: { email: fixtures.accountant.email, password },
  });
  const auth: { accessToken: string } = await accountantLogin.json();
  const headers = { Authorization: `Bearer ${auth.accessToken}` };
  const listed = await context.request.get(backend + '/payroll', { headers });
  const existing: { items: { worker: { id: string }; period: string }[] } =
    await listed.json();
  let month = 1;
  while (
    existing.items.some(
      (item) => item.period === `2012-${String(month).padStart(2, '0')}`,
    )
  )
    month++;
  const period = `2012-${String(month).padStart(2, '0')}`;
  type Payslip = { id: string; revision: string; versionId?: string };
  async function upload(
    workerId: string,
    publish: boolean,
    suffix: string,
  ): Promise<Payslip> {
    const response = await context.request.post(backend + '/payroll', {
      headers,
      multipart: {
        workerId,
        period,
        file: {
          name: 'liquidación sin extensión',
          mimeType: 'application/pdf',
          buffer: Buffer.from(
            `%PDF-1.7\n${info.project.name}-${Date.now()}-${suffix}\n%%EOF`,
          ),
        },
      },
    });
    expect(response.status()).toBe(201);
    const item: Payslip = await response.json();
    if (publish) {
      const published = await context.request.post(
        backend + `/payroll/${item.id}/publish`,
        { headers, data: { revision: item.revision } },
      );
      expect(published.status()).toBe(200);
    }
    return item;
  }
  const own = await upload(fixtures.worker.id, true, 'own');
  const other = await upload(fixtures.other.id, true, 'other');
  const supervisor = await upload(fixtures.supervisor.id, true, 'supervisor');
  // Una pendiente distinta del trabajador nunca debe filtrarse en /mine.
  const pendingResponse = await context.request.post(backend + '/payroll', {
    headers,
    multipart: {
      workerId: fixtures.worker.id,
      period: `2013-${String(month).padStart(2, '0')}`,
      file: {
        name: 'pendiente.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(
          `%PDF-1.7\nPendiente-${Date.now()}-${info.project.name}\n%%EOF`,
        ),
      },
    },
  });
  expect(pendingResponse.status()).toBe(201);
  const pending: Payslip = await pendingResponse.json();
  await login(fixtures.worker.email);
  const mine = await context.request.get('/api/my-payroll');
  expect(mine.status()).toBe(200);
  const result: {
    items: { id: string; versionId: string; signedAt: string }[];
  } = await mine.json();
  expect(
    result.items.some((item) => item.id === other.id || item.id === pending.id),
  ).toBe(false);
  const ownFile = result.items.find((item) => item.id === own.id);
  expect(ownFile).toBeDefined();
  if (!ownFile) throw new Error('Falta liquidación propia');
  for (const id of [other.id, pending.id])
    expect(
      (await context.request.get(`/api/my-payroll/${id}/download`)).status(),
    ).toBe(404);
  const download = await context.request.get(
    `/api/my-payroll/${own.id}/download`,
  );
  expect(download.status()).toBe(200);
  expect(download.headers()['content-type']).toContain('application/pdf');
  expect(download.headers()['x-document-integrity']).toBe('VALID');
  expect(download.headers()['cache-control']).toContain('no-store');
  expect(Number(download.headers()['content-length'])).toBe(
    (await download.body()).length,
  );
  await page.goto('/portal/liquidaciones');
  await expect(
    page
      .getByText(`Fecha de firma: ${formatCalendarDate(ownFile.signedAt)}`)
      .first(),
  ).toBeVisible();
  // Se retira temporalmente solo el archivo sintético de esta prueba y se restaura siempre.
  type DatabaseClient = {
    connect(): Promise<unknown>;
    query(
      sql: string,
      params: string[],
    ): Promise<{ rows: { file_path: string }[] }>;
    end(): Promise<unknown>;
  };
  const requireBackend = createRequire(path.resolve('../backend/package.json'));
  const pg = requireBackend('pg') as {
    Client: new (config: { connectionString: string }) => DatabaseClient;
  };
  if (!process.env.DATABASE_URL || !process.env.TEST_REAL_STORAGE_PATH)
    throw new Error(
      'Configura DATABASE_URL y TEST_REAL_STORAGE_PATH del entorno exclusivo',
    );
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  let file: string;
  try {
    const records = await db.query(
      'SELECT file_path FROM document_versions WHERE id=$1',
      [ownFile.versionId],
    );
    file = path.resolve(
      process.env.TEST_REAL_STORAGE_PATH,
      records.rows[0].file_path,
    );
  } finally {
    await db.end();
  }
  const relative = path.relative(
    path.resolve(process.env.TEST_REAL_STORAGE_PATH),
    file,
  );
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Archivo fuera del almacenamiento de pruebas');
  await rename(file, file + '.missing-test');
  try {
    const integrity = await context.request.get(
      `/api/my-payroll/${own.id}/integrity`,
    );
    expect(integrity.status()).toBe(200);
    expect(await integrity.json()).toMatchObject({
      status: 'MISSING',
      actualHash: null,
      valid: false,
    });
    await page.getByLabel('Período', { exact: true }).selectOption(period);
    await page.getByRole('button', { name: /Descargar liquidación/ }).click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'El archivo no está disponible; informa al administrador',
    );
  } finally {
    await rename(file + '.missing-test', file);
  }
  await login(fixtures.supervisor.email);
  await page.goto('/dashboard');
  await page
    .getByRole('navigation', { name: 'Navegación principal' })
    .getByRole('link', { name: 'Mis liquidaciones', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mis liquidaciones' }),
  ).toBeVisible();
  const supervisorMine = await context.request.get('/api/my-payroll');
  expect(supervisorMine.status()).toBe(200);
  const supervisorData: { items: { id: string }[] } =
    await supervisorMine.json();
  expect(supervisorData.items.some((item) => item.id === supervisor.id)).toBe(
    true,
  );
  expect(supervisorData.items.some((item) => item.id === own.id)).toBe(false);
  await page.screenshot({
    path: info.outputPath('my-payslips-real.png'),
    fullPage: true,
  });
});
