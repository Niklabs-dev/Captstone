import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAX_REPORT_FILE_BYTES } from '../src/sales-imports/parser/xlsx-workbook.reader.js';
import type {
  SalesImportDetail,
  SalesImportPreview,
  SalesImportSummary,
} from '../src/sales-imports/types/sales-imports.types.js';
import {
  buildReportSheet,
  buildReportXlsx,
  type FixtureLine,
  type ReportFixtureOptions,
} from './helpers/mrcomanda-report-fixture.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la importación diaria de ventas MrComanda
// (SPRINT-4R-T10) contra PostgreSQL real: vista previa con almacenamiento
// privado, idempotencia por hash, confirmación con reemplazo explícito y
// versiones trazables, equivalencias faltantes sin persistir, archivos
// inválidos, permisos (solo ADMINISTRADOR), descarte, consulta, descarga con
// verificación de integridad y auditoría con lista blanca. Todo corre dentro
// de withinRollback (la base se revierte); los archivos se escriben en una
// carpeta temporal que se elimina al terminar. La concurrencia y el rollback
// con transacciones reales están en sales-imports-concurrency.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Fecha del fixture ficticio («Período: 14/03/2026 al 14/03/2026»).
const BUSINESS_DATE = '2026-03-14';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Variante corregida del reporte (otro contenido → otro hash): suma 700.000.
const CORRECTED_LINES: readonly FixtureLine[] = [
  { label: 'T. DEBITO', amount: 420_000, percentage: 60 },
  { label: 'EFECTIVO', amount: 160_000, percentage: 22.86 },
  { label: 'T. CREDITO', amount: 120_000, percentage: 17.14 },
  { label: 'N.de Créd.', amount: 0, percentage: 0 },
];

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  externalCode: string;
  admin: AuthUser;
  supervisor: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
  methodIds: Record<string, string>;
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(!databaseUrl)(
  'API de importación diaria de ventas MrComanda (SPRINT-4R-T10)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let storageRoot: string;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function authorize(req: request.Test, user: AuthUser | null): request.Test {
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    function uploadPreview(
      file: Buffer | null,
      user: AuthUser | null,
      fileName = 'ventas-15-03-2026.xlsx',
    ): request.Test {
      const req = authorize(
        request(app.getHttpServer()).post('/sales-imports/preview'),
        user,
      );
      return file ? req.attach('file', file, fileName) : req;
    }

    function confirm(
      id: string,
      expectedActiveImportId: string | null,
      user: AuthUser | null,
    ): request.Test {
      return authorize(
        request(app.getHttpServer()).post(`/sales-imports/${id}/confirm`),
        user,
      ).send({ expectedActiveImportId });
    }

    function get(url: string, user: AuthUser | null): request.Test {
      return authorize(request(app.getHttpServer()).get(url), user);
    }

    // Excel ficticio con el identificador de local del fixture.
    async function excel(
      f: Fixture,
      options: ReportFixtureOptions = {},
    ): Promise<Buffer> {
      return buildReportXlsx([
        buildReportSheet({
          filters: ` - Todas las Empresas - Local: ${f.externalCode} - Todos los Sectores`,
          ...options,
        }),
      ]);
    }

    async function corrected(f: Fixture): Promise<Buffer> {
      return excel(f, {
        lines: CORRECTED_LINES,
        paymentsTotal: 700_000,
        salesTotal: 700_000,
      });
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@sales-imports-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Importación',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const store = await tx.store.create({
        data: {
          name: `Subway Importación ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      // Identificador ficticio propio de cada corrida.
      const externalCode = `9${randomInt(10, 99)} - ${randomInt(10_000, 99_999)}`;
      await tx.storeExternalCode.create({
        data: { system: 'MRCOMANDA', externalCode, storeId: store.id },
      });
      const methodIds: Record<string, string> = {};
      const aliases = [
        {
          label: 'T. DEBITO',
          code: 'DEBIT_CARD',
          behavior: 'RECONCILABLE_CARD',
        },
        { label: 'EFECTIVO', code: 'CASH', behavior: 'CASH' },
        {
          label: 'T. CREDITO',
          code: 'CREDIT_CARD',
          behavior: 'RECONCILABLE_CARD',
        },
        {
          label: 'N.DE CRED.',
          code: 'T10_CREDIT_NOTE',
          behavior: 'EXTERNAL_OTHER',
        },
      ] as const;
      for (const [index, alias] of aliases.entries()) {
        const method = await tx.paymentMethod.upsert({
          where: { code: alias.code },
          update: {},
          create: {
            code: alias.code,
            name: alias.code,
            sortOrder: 960 + index,
            behavior: alias.behavior,
          },
        });
        methodIds[alias.code] = method.id;
        await tx.paymentMethodAlias.upsert({
          where: {
            system_normalizedLabel: {
              system: 'MRCOMANDA',
              normalizedLabel: alias.label,
            },
          },
          update: { paymentMethodId: method.id },
          create: {
            system: 'MRCOMANDA',
            label: alias.label,
            normalizedLabel: alias.label,
            paymentMethodId: method.id,
          },
        });
      }
      return {
        tx,
        storeId: store.id,
        externalCode,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id),
        methodIds,
      };
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            await run(await createFixture(tx));
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 50_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    async function storedFiles(): Promise<string[]> {
      const dir = path.join(storageRoot, 'sales-imports');
      const entries = await fs
        .readdir(dir, { recursive: true })
        .catch(() => [] as string[]);
      const files: string[] = [];
      for (const entry of entries) {
        const absolute = path.join(dir, entry);
        const stat = await fs.stat(absolute).catch(() => null);
        if (stat?.isFile()) files.push(absolute);
      }
      return files;
    }

    async function previewOk(
      f: Fixture,
      file: Buffer,
      status = 201,
    ): Promise<SalesImportPreview> {
      const response = await uploadPreview(file, f.admin).expect(status);
      return response.body as SalesImportPreview;
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-imp-'));
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      switchable = createSwitchablePrisma();
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(switchable.service)
        .compile();
      app = moduleFixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      jwt = app.get(JwtService);
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storageRoot, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await fs.rm(path.join(storageRoot, 'sales-imports'), {
        recursive: true,
        force: true,
      });
    });

    describe('vista previa', () => {
      it('lee el Excel, lo guarda en privado como PENDING y audita con lista blanca', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const preview = await previewOk(f, file);

          expect(preview).toMatchObject({
            outcome: 'CREATED',
            canConfirm: true,
            issues: [],
            businessDate: BUSINESS_DATE,
            externalStoreCode: f.externalCode,
            store: { id: f.storeId },
            totalAmount: 650_000,
            activeImport: null,
          });
          expect(preview.issuedAt).toBe('2026-03-15T12:30:00.000Z');
          expect(preview.lines.map((line) => line.paymentMethod?.code)).toEqual(
            ['DEBIT_CARD', 'CASH', 'CREDIT_CARD', 'T10_CREDIT_NOTE'],
          );
          const saved = preview.import as SalesImportDetail;
          expect(saved).toMatchObject({
            status: 'PENDING',
            version: 1,
            businessDate: BUSINESS_DATE,
            fileName: 'ventas-15-03-2026.xlsx',
            sizeBytes: file.length,
            sha256Hash: sha256(file),
            uploadedBy: { id: f.admin.id },
            confirmedBy: null,
            totalAmount: 650_000,
          });
          expect(saved.lines).toHaveLength(4);
          expect(saved.versions.map((v) => [v.version, v.status])).toEqual([
            [1, 'PENDING'],
          ]);

          // Archivo en el volumen privado con nombre aleatorio y mismo hash.
          const files = await storedFiles();
          expect(files).toHaveLength(1);
          expect(path.basename(files[0])).toMatch(/^[0-9a-f-]{36}\.xlsx$/);
          expect(sha256(await fs.readFile(files[0]))).toBe(sha256(file));

          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_PREVIEWED,
              entityId: saved.id,
            },
          });
          expect(audit.userId).toBe(f.admin.id);
          expect(audit.storeId).toBe(f.storeId);
          expect(audit.detail).toEqual({
            businessDate: BUSINESS_DATE,
            sha256Hash: sha256(file),
            version: 1,
            totalAmount: 650_000,
          });
        });
      });

      it('el mismo archivo para el mismo local y fecha devuelve la importación existente', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const first = await previewOk(f, file);
          const again = await previewOk(f, file, 200);

          expect(again.outcome).toBe('EXISTING');
          expect(again.import?.id).toBe(first.import?.id);
          expect(
            await f.tx.salesImport.count({ where: { storeId: f.storeId } }),
          ).toBe(1);
          // Ni un segundo archivo ni un segundo evento de auditoría.
          expect(await storedFiles()).toHaveLength(1);
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.SALES_IMPORT_PREVIEWED,
                entityId: first.import?.id,
              },
            }),
          ).toBe(1);

          // Ya confirmado, sigue sin duplicarse y no se puede volver a confirmar.
          await confirm(first.import?.id ?? '', null, f.admin).expect(200);
          const afterConfirm = await previewOk(f, file, 200);
          expect(afterConfirm).toMatchObject({
            outcome: 'EXISTING',
            canConfirm: false,
            import: { id: first.import?.id, status: 'ACTIVE' },
            activeImport: null,
          });
        });
      });

      it('sin equivalencia de local responde UNRESOLVED sin guardar nada', async () => {
        await withinRollback(async (f) => {
          await f.tx.storeExternalCode.deleteMany({
            where: { storeId: f.storeId },
          });
          const response = await uploadPreview(await excel(f), f.admin).expect(
            200,
          );
          const preview = response.body as SalesImportPreview;

          expect(preview).toMatchObject({
            outcome: 'UNRESOLVED',
            canConfirm: false,
            store: null,
            import: null,
          });
          expect(preview.issues).toEqual([
            expect.objectContaining({
              code: 'STORE_NOT_CONFIGURED',
              externalStoreCode: f.externalCode,
            }),
          ]);
          expect(
            await f.tx.salesImport.count({ where: { storeId: f.storeId } }),
          ).toBe(0);
          expect(await storedFiles()).toHaveLength(0);
        });
      });

      it('un medio sin alias (N.de Créd.) responde UNRESOLVED con la línea afectada', async () => {
        await withinRollback(async (f) => {
          await f.tx.paymentMethodAlias.deleteMany({
            where: { system: 'MRCOMANDA', normalizedLabel: 'N.DE CRED.' },
          });
          const response = await uploadPreview(await excel(f), f.admin).expect(
            200,
          );
          const preview = response.body as SalesImportPreview;

          expect(preview.outcome).toBe('UNRESOLVED');
          expect(preview.store?.id).toBe(f.storeId);
          expect(preview.issues).toEqual([
            expect.objectContaining({
              code: 'PAYMENT_METHOD_NOT_CONFIGURED',
              lineNumber: 4,
              originalLabel: 'N.de Créd.',
            }),
          ]);
          expect(preview.lines[3].paymentMethod).toBeNull();
          expect(await storedFiles()).toHaveLength(0);
        });
      });

      it('rechaza archivos inválidos con el código y la fila, sin guardar nada', async () => {
        await withinRollback(async (f) => {
          const cases: Array<{
            file: Buffer;
            status: number;
            code: string;
          }> = [
            {
              file: Buffer.from('Fecha;Monto\n05/11/2026;1000\n'),
              status: 415,
              code: 'FILE_NOT_XLSX',
            },
            {
              file: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]),
              status: 415,
              code: 'FILE_XLS_NOT_SUPPORTED',
            },
            {
              file: (await excel(f)).subarray(0, 200),
              status: 422,
              code: 'FILE_CORRUPT',
            },
            {
              file: await excel(f, {
                period: '14/03/2026 al 15/03/2026',
                title: null,
              }),
              status: 422,
              code: 'PERIOD_MULTIPLE_DAYS',
            },
            {
              file: await excel(f, { paymentsTotal: 650_001 }),
              status: 422,
              code: 'TOTAL_MISMATCH',
            },
          ];
          for (const testCase of cases) {
            const response = await uploadPreview(testCase.file, f.admin).expect(
              testCase.status,
            );
            expect(response.body).toMatchObject({
              statusCode: testCase.status,
              code: testCase.code,
            });
            expect(typeof (response.body as { message: unknown }).message).toBe(
              'string',
            );
          }
          const period = await uploadPreview(
            await excel(f, { period: '14/03/2026 al 15/03/2026', title: null }),
            f.admin,
          ).expect(422);
          expect((period.body as { row: number }).row).toBe(6);

          expect(
            await f.tx.salesImport.count({ where: { storeId: f.storeId } }),
          ).toBe(0);
          expect(await storedFiles()).toHaveLength(0);
        });
      });

      it('exige el archivo y respeta el límite de tamaño', async () => {
        await withinRollback(async (f) => {
          await uploadPreview(null, f.admin).expect(400);
          const huge = Buffer.alloc(MAX_REPORT_FILE_BYTES + 1);
          await uploadPreview(huge, f.admin).expect(413);
          expect(await storedFiles()).toHaveLength(0);
        });
      });
    });

    describe('confirmación y versiones', () => {
      it('confirma la primera versión y audita la confirmación', async () => {
        await withinRollback(async (f) => {
          const preview = await previewOk(f, await excel(f));
          const id = preview.import?.id ?? '';

          const response = await confirm(id, null, f.admin).expect(200);
          const confirmed = response.body as SalesImportDetail;
          expect(confirmed).toMatchObject({
            id,
            status: 'ACTIVE',
            confirmedBy: { id: f.admin.id },
            supersededAt: null,
          });
          expect(confirmed.confirmedAt).not.toBeNull();

          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
              entityId: id,
            },
          });
          expect(audit.storeId).toBe(f.storeId);
          expect(audit.detail).toEqual({
            businessDate: BUSINESS_DATE,
            sha256Hash: confirmed.sha256Hash,
            version: 1,
            totalAmount: 650_000,
            supersededImportId: null,
            supersededVersion: null,
          });

          // Repetir la confirmación es idempotente y no se audita de nuevo.
          await confirm(id, null, f.admin).expect(200);
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
                entityId: id,
              },
            }),
          ).toBe(1);
        });
      });

      it('un archivo corregido crea otra versión y solo reemplaza con confirmación explícita', async () => {
        await withinRollback(async (f) => {
          const first = await previewOk(f, await excel(f));
          const v1 = first.import?.id ?? '';
          await confirm(v1, null, f.admin).expect(200);

          const second = await previewOk(f, await corrected(f));
          const v2 = second.import?.id ?? '';
          expect(second).toMatchObject({
            outcome: 'CREATED',
            canConfirm: true,
            totalAmount: 700_000,
            import: { version: 2, status: 'PENDING' },
            activeImport: { id: v1, version: 1, status: 'ACTIVE' },
          });
          // Mientras no se confirme, la v1 sigue vigente.
          const stillActive = await get(`/sales-imports/${v1}`, f.admin).expect(
            200,
          );
          expect((stillActive.body as SalesImportDetail).status).toBe('ACTIVE');

          // Sin indicar la versión que reemplaza: 409 con la vigente.
          const conflict = await confirm(v2, null, f.admin).expect(409);
          expect(conflict.body).toMatchObject({
            activeImport: { id: v1, version: 1 },
          });

          const response = await confirm(v2, v1, f.admin).expect(200);
          const confirmed = response.body as SalesImportDetail;
          expect(confirmed.status).toBe('ACTIVE');
          expect(confirmed.versions.map((v) => [v.version, v.status])).toEqual([
            [2, 'ACTIVE'],
            [1, 'SUPERSEDED'],
          ]);

          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
              entityId: v2,
            },
          });
          expect(audit.detail).toMatchObject({
            version: 2,
            totalAmount: 700_000,
            supersededImportId: v1,
            supersededVersion: 1,
          });

          // Una versión reemplazada no vuelve a quedar vigente.
          const superseded = await confirm(v1, v2, f.admin).expect(409);
          expect(superseded.body).toMatchObject({ activeImport: { id: v2 } });
        });
      });

      it('valida el cuerpo de la confirmación y el ID', async () => {
        await withinRollback(async (f) => {
          const preview = await previewOk(f, await excel(f));
          const id = preview.import?.id ?? '';
          await authorize(
            request(app.getHttpServer()).post(`/sales-imports/${id}/confirm`),
            f.admin,
          )
            .send({})
            .expect(400);
          await confirm(id, 'no-es-uuid', f.admin).expect(400);
          await confirm('no-es-uuid', null, f.admin).expect(400);
          await confirm(MISSING_ID, null, f.admin).expect(404);
        });
      });
    });

    describe('descarte, consulta y descarga', () => {
      it('descarta una PENDING con su archivo y protege las confirmadas', async () => {
        await withinRollback(async (f) => {
          const pending = await previewOk(f, await excel(f));
          const id = pending.import?.id ?? '';
          const response = await authorize(
            request(app.getHttpServer()).delete(`/sales-imports/${id}`),
            f.admin,
          ).expect(200);
          expect((response.body as SalesImportSummary).id).toBe(id);
          expect(await f.tx.salesImport.count({ where: { id } })).toBe(0);
          expect(
            await f.tx.salesImportLine.count({ where: { importId: id } }),
          ).toBe(0);
          expect(await storedFiles()).toHaveLength(0);
          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_DISCARDED,
              entityId: id,
            },
          });
          expect(audit.storeId).toBe(f.storeId);

          const active = await previewOk(f, await excel(f));
          await confirm(active.import?.id ?? '', null, f.admin).expect(200);
          await authorize(
            request(app.getHttpServer()).delete(
              `/sales-imports/${active.import?.id ?? ''}`,
            ),
            f.admin,
          ).expect(409);
        });
      });

      it('lista con filtros y entrega el detalle con líneas y versiones', async () => {
        await withinRollback(async (f) => {
          const first = await previewOk(f, await excel(f));
          await confirm(first.import?.id ?? '', null, f.admin).expect(200);
          await previewOk(f, await corrected(f));

          const all = await get(
            `/sales-imports?storeId=${f.storeId}&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`,
            f.admin,
          ).expect(200);
          expect(
            (all.body as SalesImportSummary[]).map((i) => [
              i.version,
              i.status,
            ]),
          ).toEqual([
            [2, 'PENDING'],
            [1, 'ACTIVE'],
          ]);
          const active = await get(
            `/sales-imports?storeId=${f.storeId}&status=ACTIVE`,
            f.admin,
          ).expect(200);
          expect(active.body as SalesImportSummary[]).toHaveLength(1);
          await get('/sales-imports?status=OTRO', f.admin).expect(400);
          await get('/sales-imports?from=2026-02-30', f.admin).expect(400);

          const detail = await get(
            `/sales-imports/${first.import?.id ?? ''}`,
            f.admin,
          ).expect(200);
          const body = detail.body as SalesImportDetail;
          expect(body.lines.map((line) => line.amount)).toEqual([
            400_000, 150_000, 100_000, 0,
          ]);
          expect(body.lines[0].paymentMethod.code).toBe('DEBIT_CARD');
          expect(body.versions).toHaveLength(2);
          await get(`/sales-imports/${MISSING_ID}`, f.admin).expect(404);
        });
      });

      it('descarga el archivo original con verificación de integridad y la audita', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const preview = await previewOk(f, file);
          const id = preview.import?.id ?? '';

          const response = await get(`/sales-imports/${id}/file`, f.admin)
            .buffer(true)
            .parse((res, callback) => {
              const chunks: Buffer[] = [];
              res.on('data', (chunk: Buffer) => chunks.push(chunk));
              res.on('end', () => callback(null, Buffer.concat(chunks)));
            })
            .expect(200);
          expect(response.headers['x-file-integrity']).toBe('VALID');
          expect(response.headers['x-content-type-options']).toBe('nosniff');
          expect(response.headers['content-disposition']).toContain(
            'ventas-15-03-2026.xlsx',
          );
          expect(sha256(response.body as Buffer)).toBe(sha256(file));
          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_FILE_DOWNLOADED,
              entityId: id,
            },
          });
          expect(audit.detail).toEqual({ integrity: 'VALID' });

          // Un archivo alterado en el volumen se advierte.
          const [stored] = await storedFiles();
          await fs.appendFile(stored, Buffer.from([0x00]));
          const altered = await get(
            `/sales-imports/${id}/file`,
            f.admin,
          ).expect(200);
          expect(altered.headers['x-file-integrity']).toBe('ALTERED');
        });
      });
    });

    describe('permisos', () => {
      it('solo el ADMINISTRADOR usa la importación', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          await uploadPreview(file, null).expect(401);
          for (const user of [f.supervisor, f.accountant, f.worker]) {
            await uploadPreview(file, user).expect(403);
            await get('/sales-imports', user).expect(403);
          }
          const preview = await previewOk(f, file);
          const id = preview.import?.id ?? '';
          for (const user of [f.supervisor, f.accountant, f.worker]) {
            await get(`/sales-imports/${id}`, user).expect(403);
            await get(`/sales-imports/${id}/file`, user).expect(403);
            await confirm(id, null, user).expect(403);
            await authorize(
              request(app.getHttpServer()).delete(`/sales-imports/${id}`),
              user,
            ).expect(403);
          }
          // Los rechazos no tocaron la importación.
          const unchanged = await f.tx.salesImport.findUniqueOrThrow({
            where: { id },
          });
          expect(unchanged.status).toBe('PENDING');
        });
      });
    });
  },
);
