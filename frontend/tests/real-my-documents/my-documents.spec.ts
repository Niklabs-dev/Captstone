import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { DOCUMENT_TYPES, type WorkerDocument } from '../../src/lib/documents';

test.skip(
  process.env.TEST_REAL_DISPOSABLE !== 'true',
  'Solo en Docker con base y almacenamiento exclusivos.',
);
const password = 'Own-document-test-2026!';
async function login(
  request: APIRequestContext,
  baseURL: string,
  email: string,
  accountPassword = password,
): Promise<void> {
  expect(
    (
      await request.post('/api/auth/login', {
        headers: { Origin: baseURL },
        data: { email, password: accountPassword },
      })
    ).status(),
  ).toBe(200);
}
async function rows(
  sql: string,
  params: string[],
): Promise<Record<string, string>[]> {
  if (!process.env.DATABASE_URL || process.env.TEST_REAL_DISPOSABLE !== 'true')
    throw Error('Base exclusiva requerida');
  type Client = {
    connect(): Promise<unknown>;
    query(
      sql: string,
      params: string[],
    ): Promise<{ rows: Record<string, string>[] }>;
    end(): Promise<unknown>;
  };
  const backendRequire = createRequire(path.resolve('../backend/package.json'));
  const pg = backendRequire('pg') as {
    Client: new (config: { connectionString: string }) => Client;
  };
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.end();
  }
}
async function storageFile(versionId: string): Promise<string> {
  if (!process.env.TEST_REAL_STORAGE_PATH)
    throw Error('Almacenamiento de pruebas requerido');
  const records = await rows(
    'SELECT file_path FROM document_versions WHERE id=$1',
    [versionId],
  );
  const root = path.resolve(process.env.TEST_REAL_STORAGE_PATH);
  const file = path.resolve(root, records[0].file_path);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw Error('Archivo fuera del almacenamiento de pruebas');
  return file;
}
async function noOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

for (const role of ['TRABAJADOR', 'SUPERVISOR'] as const)
  test(`${role}: documentos propios, historial, descarga verificada, aislamiento y daños de archivo`, async ({
    page,
    context,
    request,
    baseURL,
  }, info) => {
    const fixtures = JSON.parse(
      readFileSync('output/real-api/fixtures.json', 'utf8'),
    ) as { store: string; accountant: { email: string } };
    await login(
      request,
      baseURL!,
      process.env.TEST_REAL_ADMIN_EMAIL ?? 'admin@moi-food.cl',
      process.env.TEST_REAL_ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
    );
    const headers = { Origin: baseURL! };
    const suffix = `${role.toLowerCase()}-${info.project.name}-${Date.now()}`;
    const email = `${suffix}@integration.example.test`;
    async function createUser(accountEmail: string): Promise<string> {
      const response = await request.post('/api/users', {
        headers,
        data: {
          firstName: 'Camila',
          lastName: role,
          email: accountEmail,
          password,
          roleCode: role,
          storeId: fixtures.store,
        },
      });
      expect(response.status()).toBe(201);
      const data = (await response.json()) as { id: string };
      return data.id;
    }
    const workerId = await createUser(email);
    const otherId = await createUser('other-' + email);
    await login(context.request, baseURL!, email);
    await page.goto(role === 'TRABAJADOR' ? '/portal' : '/dashboard');
    await expect(
      page
        .locator('main')
        .getByRole('link', { name: 'Mis documentos', exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator('main')
        .getByRole('link', { name: 'Mis liquidaciones', exact: true }),
    ).toBeVisible();
    await page
      .locator('main')
      .getByRole('link', { name: 'Mis documentos', exact: true })
      .click();
    await expect(
      page.getByText('Esta carpeta aún no tiene documentos', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: /Subir documento|Nueva versión|Eliminar/,
      }),
    ).toHaveCount(0);
    async function upload(
      type: string,
      owner: string,
      previous?: WorkerDocument,
    ): Promise<{ document: WorkerDocument; bytes: Buffer }> {
      const bytes = Buffer.from(
        `%PDF-1.7\n${suffix}-${owner}-${type}-${previous ? 'v2' : 'v1'}\n%%EOF`,
      );
      const response = await request.post('/api/documents', {
        headers,
        multipart: {
          workerId: owner,
          documentTypeCode: type,
          title: `Documento ${type} ${suffix}`,
          ...(previous ? { documentId: previous.id } : {}),
          file: {
            name: 'documento firmado.pdf',
            mimeType: 'application/pdf',
            buffer: bytes,
          },
        },
      });
      expect(response.status()).toBe(201);
      return { document: (await response.json()) as WorkerDocument, bytes };
    }
    const own: WorkerDocument[] = [];
    for (const type of DOCUMENT_TYPES)
      own.push((await upload(type, workerId)).document);
    const previous = own[0];
    const current = await upload('CONTRATO', workerId, previous);
    const foreign = (await upload('CONTRATO', otherId)).document;
    // La pendiente existe de verdad y usa un documento LIQUIDACION en la misma BD.
    const backend =
      process.env.TEST_REAL_BACKEND_URL ?? 'http://127.0.0.1:3001';
    const authResponse = await request.post(backend + '/auth/login', {
      data: {
        email: fixtures.accountant.email,
        password: 'Integration-test-2026!',
      },
    });
    expect(authResponse.status()).toBe(200);
    const auth = (await authResponse.json()) as { accessToken: string };
    const pendingResponse = await request.post(backend + '/payroll', {
      headers: { Authorization: 'Bearer ' + auth.accessToken },
      multipart: {
        workerId,
        period: '2026-01',
        file: {
          name: 'pendiente.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from(`%PDF-1.7\nPendiente ${suffix}\n%%EOF`),
        },
      },
    });
    expect(pendingResponse.status()).toBe(201);
    const pending = (await pendingResponse.json()) as {
      id: string;
      status: string;
    };
    expect(pending.status).toBe('PENDING_SIGNATURE');
    const pendingFiles = await rows(
      'SELECT p.document_id, v.id FROM payslips p JOIN document_versions v ON v.document_id=p.document_id WHERE p.id=$1',
      [pending.id],
    );
    expect(pendingFiles).toHaveLength(1);
    await page.reload();
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Mis documentos',
        exact: true,
      }),
    ).toHaveCount(1);
    const filter = page.getByRole('combobox', {
      name: 'Tipo de documento',
      exact: true,
    });
    for (const type of DOCUMENT_TYPES) {
      await filter.selectOption(type);
      await expect(page.locator('tbody tr')).toHaveCount(1);
      await expect(page.locator('tbody')).toContainText(
        `Documento ${type} ${suffix}`,
      );
    }
    await filter.selectOption('CONTRATO');
    const row = page.locator('tbody tr');
    await expect(row).toContainText('Versión vigente: v2');
    await row
      .getByRole('button', { name: 'Ver historial', exact: true })
      .click();
    const history = page.getByRole('region', {
      name: 'Historial de versiones',
      exact: true,
    });
    await expect(history).toContainText('Versión 2 · Actual');
    await expect(history).toContainText('Versión 1 · Anterior');
    await row
      .getByRole('button', { name: 'Verificar integridad', exact: true })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Integridad verificada' }),
    ).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Descargar', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toContain('CONTRATO_');
    const file = await download.path();
    expect(file).not.toBeNull();
    expect(createHash('sha256').update(readFileSync(file!)).digest('hex')).toBe(
      current.document.latestVersion.sha256,
    );
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath('mis-documentos-historial.png'),
    });
    for (const candidate of [
      foreign,
      {
        id: pendingFiles[0].document_id,
        latestVersion: { id: pendingFiles[0].id },
      },
    ]) {
      for (const route of [
        `/${candidate.id}/versions`,
        `/versions/${candidate.latestVersion.id}/integrity`,
        `/versions/${candidate.latestVersion.id}/download`,
      ])
        expect(
          (await context.request.get('/api/my-documents' + route)).status(),
        ).toBe(candidate.id === foreign.id ? 403 : 404);
    }
    expect(
      (
        await context.request.get('/api/my-documents?workerId=' + otherId)
      ).status(),
    ).toBe(400);
    for (const method of ['post', 'patch', 'delete'] as const)
      expect(
        (
          await context.request[method]('/api/my-documents', { headers })
        ).status(),
      ).toBe(405);
    const listing = await context.request.get('/api/my-documents');
    expect(listing.status()).toBe(200);
    const collection = (await listing.json()) as {
      items: WorkerDocument[];
      policy: { canUpload: boolean };
    };
    expect(collection.items).toHaveLength(4);
    expect(
      collection.items.every(
        (item) =>
          item.workerId === workerId && DOCUMENT_TYPES.includes(item.type),
      ),
    ).toBe(true);
    expect(collection.policy.canUpload).toBe(false);
    expect(JSON.stringify(collection)).not.toContain(foreign.id);
    expect(JSON.stringify(collection)).not.toContain(
      pendingFiles[0].document_id,
    );
    // Alteración y ausencia: solo el archivo sintético propio, restaurado siempre.
    const storage = await storageFile(current.document.latestVersion.id);
    try {
      await writeFile(storage, Buffer.from('Archivo alterado para prueba'));
      await row.getByRole('button', { name: 'Descargar', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('alterado');
      await page.screenshot({ path: info.outputPath('archivo-alterado.png') });
    } finally {
      await writeFile(storage, current.bytes);
    }
    await rename(storage, storage + '.missing-test');
    try {
      await row
        .getByRole('button', { name: 'Verificar integridad', exact: true })
        .click();
      await expect(page.getByRole('alert')).toContainText(
        'El archivo no está disponible; informa al administrador',
      );
      await page.screenshot({ path: info.outputPath('archivo-ausente.png') });
    } finally {
      await rename(storage + '.missing-test', storage);
    }
    await page
      .getByRole('button', { name: 'Cerrar historial', exact: true })
      .click();
    await filter.selectOption('');
    await expect(page.locator('tbody tr')).toHaveCount(4);
    await expect(
      page
        .locator('main')
        .getByRole('link', {
          name: 'Consultar mis liquidaciones',
          exact: true,
        }),
    ).toBeVisible();
    expect(
      (
        await context.request.get(`/api/my-payroll/${pending.id}/download`)
      ).status(),
    ).toBe(404);
    // La segunda cuenta no obtiene documentos de la primera.
    await login(context.request, baseURL!, 'other-' + email);
    const otherCollection = (await (
      await context.request.get('/api/my-documents')
    ).json()) as { items: WorkerDocument[] };
    expect(otherCollection.items).toHaveLength(1);
    expect(otherCollection.items[0].id).toBe(foreign.id);
    expect(
      (
        await context.request.get(
          `/api/my-documents/versions/${current.document.latestVersion.id}/download`,
        )
      ).status(),
    ).toBe(403);
  });
