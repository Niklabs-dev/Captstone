import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomInt, randomUUID } from 'node:crypto';
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
import type {
  SalesImportDetail,
  SalesImportPreview,
} from '../src/sales-imports/types/sales-imports.types.js';
import {
  buildReportSheet,
  buildReportXlsx,
  type FixtureLine,
} from './helpers/mrcomanda-report-fixture.js';
import { fakeSubwayStoreId } from './helpers/subway-store-id.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Resolución manual del local y de los medios no identificados al importar
// (SPRINT-4A-T18), contra PostgreSQL real y por HTTP: la vista previa
// UNRESOLVED ofrece las opciones, POST /sales-imports/confirm-with-resolution
// importa y confirma con lo elegido (resolver, crear el medio, recordar) o
// responde 400 sin guardar nada, y la base rechaza por sí misma las
// resoluciones que abrirían un hueco. Desde SPRINT-4A-T21 la línea en 0 sin
// alias se omite sola y una línea con valor puede crear su medio. Todo corre en withinRollback; los archivos van a una
// carpeta temporal que se elimina al terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = '2026-03-14';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  // Local activo sin ID Subway: el que el administrador elige a mano.
  targetStoreId: string;
  // Local activo con su propio ID Subway (identificado automáticamente).
  otherStoreId: string;
  otherSubwayStoreId: string;
  // ID Subway del archivo, sin local asignado.
  fileSubwayStoreId: string;
  // Etiquetas del archivo sin alias configurado.
  couponLabel: string;
  noteLabel: string;
  admin: AuthUser;
  supervisor: AuthUser;
  accountant: AuthUser;
  methodIds: Record<string, string>;
}

interface Resolution {
  expectedActiveImportId: string | null;
  store?: { storeId: string; remember: boolean } | null;
  lines: {
    lineNumber: number;
    action: 'ASSIGN' | 'CREATE' | 'SKIP';
    paymentMethodId?: string | null;
    name?: string | null;
    remember: boolean;
  }[];
}

function letters(length: number): string {
  return Array.from({ length }, () =>
    String.fromCharCode(65 + randomInt(0, 26)),
  ).join('');
}

describe.skipIf(!databaseUrl)(
  'Resolución manual al importar ventas MrComanda (SPRINT-4A-T18)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let storageRoot: string;

    function authorize(req: request.Test, user: AuthUser | null): request.Test {
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function uploadPreview(file: Buffer, user: AuthUser | null): request.Test {
      return authorize(
        request(app.getHttpServer()).post('/sales-imports/preview'),
        user,
      ).attach('file', file, 'ventas-15-03-2026.xlsx');
    }

    function confirmResolved(
      file: Buffer | null,
      resolution: Resolution | string,
      user: AuthUser | null,
    ): request.Test {
      const req = authorize(
        request(app.getHttpServer()).post(
          '/sales-imports/confirm-with-resolution',
        ),
        user,
      ).field(
        'resolution',
        typeof resolution === 'string'
          ? resolution
          : JSON.stringify(resolution),
      );
      return file ? req.attach('file', file, 'ventas-15-03-2026.xlsx') : req;
    }

    // Excel ficticio: T. DEBITO y EFECTIVO con alias; un cupón con monto y
    // una nota en 0 sin alias (se omite sola). Suma 650.000.
    async function excel(
      f: Fixture,
      options: { subwayStoreId?: string; debit?: number } = {},
    ): Promise<Buffer> {
      const debit = options.debit ?? 400_000;
      const lines: FixtureLine[] = [
        { label: 'T. DEBITO           ', amount: debit, percentage: null },
        { label: 'EFECTIVO            ', amount: 150_000, percentage: null },
        { label: f.couponLabel, amount: 100_000, percentage: null },
        { label: f.noteLabel, amount: 0, percentage: 0 },
      ];
      const total = debit + 250_000;
      return buildReportXlsx([
        buildReportSheet({
          filters: ` - Todas las Empresas - Local: 208 - ${options.subwayStoreId ?? f.fileSubwayStoreId} - Todos los Sectores`,
          lines,
          paymentsTotal: total,
          salesTotal: total,
        }),
      ]);
    }

    function fullResolution(
      f: Fixture,
      overrides: Partial<Resolution> = {},
    ): Resolution {
      return {
        expectedActiveImportId: null,
        store: { storeId: f.targetStoreId, remember: false },
        lines: [
          {
            lineNumber: 3,
            action: 'ASSIGN',
            paymentMethodId: f.methodIds['TRANSFER'],
            remember: false,
          },
        ],
        ...overrides,
      };
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
      const email = `${id}@sales-manual-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Resolución',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const target = await tx.store.create({
        data: {
          name: `Subway Manual ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherSubwayStoreId = fakeSubwayStoreId();
      const other = await tx.store.create({
        data: {
          name: `Subway Identificado ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
          subwayStoreId: otherSubwayStoreId,
        },
      });
      const methodIds: Record<string, string> = {};
      const catalog = [
        {
          label: 'T. DEBITO',
          code: 'DEBIT_CARD',
          behavior: 'RECONCILABLE_CARD',
        },
        { label: 'EFECTIVO', code: 'CASH', behavior: 'CASH' },
        { label: null, code: 'TRANSFER', behavior: 'EXTERNAL_OTHER' },
      ] as const;
      for (const [index, entry] of catalog.entries()) {
        const method = await tx.paymentMethod.upsert({
          where: { code: entry.code },
          update: { isActive: true },
          create: {
            code: entry.code,
            name: entry.code,
            sortOrder: 970 + index,
            behavior: entry.behavior,
          },
        });
        methodIds[entry.code] = method.id;
        if (entry.label !== null) {
          await tx.paymentMethodAlias.upsert({
            where: {
              system_normalizedLabel: {
                system: 'MRCOMANDA',
                normalizedLabel: entry.label,
              },
            },
            update: { paymentMethodId: method.id },
            create: {
              system: 'MRCOMANDA',
              label: entry.label,
              normalizedLabel: entry.label,
              paymentMethodId: method.id,
            },
          });
        }
      }
      const inactive = await tx.paymentMethod.create({
        data: {
          code: `T18_INACTIVE_${letters(6)}`,
          name: 'Medio inactivo',
          sortOrder: 990,
          behavior: 'EXTERNAL_OTHER',
          isActive: false,
        },
      });
      methodIds['INACTIVE'] = inactive.id;
      return {
        tx,
        targetStoreId: target.id,
        otherStoreId: other.id,
        otherSubwayStoreId,
        fileSubwayStoreId: fakeSubwayStoreId(),
        couponLabel: `CUPON ${letters(8)}`,
        noteLabel: `NOTA ${letters(8)}`,
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        supervisor: await createUser(tx, ROLE.SUPERVISOR, target.id),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
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
        const stat = await fs.stat(path.join(dir, entry)).catch(() => null);
        if (stat?.isFile()) files.push(entry);
      }
      return files;
    }

    // Nada guardado: ni importación, ni archivo, ni ID Subway, ni alias.
    async function expectNothingSaved(f: Fixture): Promise<void> {
      expect(
        await f.tx.salesImport.count({
          where: { storeId: { in: [f.targetStoreId, f.otherStoreId] } },
        }),
      ).toBe(0);
      expect(await storedFiles()).toHaveLength(0);
      const target = await f.tx.store.findUniqueOrThrow({
        where: { id: f.targetStoreId },
      });
      expect(target.subwayStoreId).toBeNull();
      expect(
        await f.tx.paymentMethodAlias.count({
          where: {
            normalizedLabel: { in: [f.couponLabel, f.noteLabel] },
          },
        }),
      ).toBe(0);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-t18-'));
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
      it('ofrece locales activos y medios del catálogo para lo no identificado, sin guardar nada', async () => {
        await withinRollback(async (f) => {
          const response = await uploadPreview(await excel(f), f.admin).expect(
            200,
          );
          const preview = response.body as SalesImportPreview;

          expect(preview).toMatchObject({
            outcome: 'UNRESOLVED',
            canConfirm: false,
            store: null,
            subwayStoreId: f.fileSubwayStoreId,
            import: null,
          });
          // La nota en 0 se omite sola: no es un problema (SPRINT-4A-T21).
          expect(preview.issues.map((issue) => issue.code)).toEqual([
            'STORE_NOT_CONFIGURED',
            'PAYMENT_METHOD_NOT_CONFIGURED',
          ]);
          expect(
            preview.lines.map((line) => [line.originalLabel, line.skipped]),
          ).toEqual([
            ['T. DEBITO', false],
            ['EFECTIVO', false],
            [f.couponLabel, false],
            [f.noteLabel, true],
          ]);
          const options = preview.resolutionOptions;
          expect(options).not.toBeNull();
          expect(options?.stores).toEqual(
            expect.arrayContaining([
              {
                id: f.targetStoreId,
                name: expect.any(String) as string,
                subwayStoreId: null,
                activeImport: null,
              },
            ]),
          );
          const methodIds = options?.paymentMethods.map((method) => method.id);
          expect(methodIds).toContain(f.methodIds['TRANSFER']);
          expect(methodIds).not.toContain(f.methodIds['INACTIVE']);
          await expectNothingSaved(f);
        });
      });

      it('una carga identificada no trae opciones de resolución', async () => {
        await withinRollback(async (f) => {
          await f.tx.paymentMethodAlias.createMany({
            data: [f.couponLabel, f.noteLabel].map((label) => ({
              system: 'MRCOMANDA' as const,
              label,
              normalizedLabel: label,
              paymentMethodId: f.methodIds['TRANSFER'],
            })),
          });
          const response = await uploadPreview(
            await excel(f, { subwayStoreId: f.otherSubwayStoreId }),
            f.admin,
          ).expect(201);
          const preview = response.body as SalesImportPreview;
          expect(preview.outcome).toBe('CREATED');
          expect(preview.resolutionOptions).toBeNull();
          expect(preview.import?.storeResolution).toBe('AUTOMATIC');
          expect(preview.import?.resolvedBy).toBeNull();
        });
      });
    });

    describe('resolver y omitir', () => {
      it('importa con el local y el medio elegidos a mano, omite sola la línea en 0 y lo deja trazado', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const response = await confirmResolved(
            file,
            fullResolution(f),
            f.admin,
          ).expect(200);
          const detail = response.body as SalesImportDetail;

          expect(detail).toMatchObject({
            status: 'ACTIVE',
            version: 1,
            store: { id: f.targetStoreId },
            businessDate: BUSINESS_DATE,
            subwayStoreId: f.fileSubwayStoreId,
            totalAmount: 650_000,
            storeResolution: 'MANUAL',
            resolvedBy: { id: f.admin.id },
            confirmedBy: { id: f.admin.id },
            uploadedBy: { id: f.admin.id },
          });
          expect(detail.resolvedAt).toEqual(expect.any(String));
          expect(
            detail.lines.map((line) => [
              line.originalLabel,
              line.paymentMethod.code,
              line.resolution,
            ]),
          ).toEqual([
            ['T. DEBITO', 'DEBIT_CARD', 'AUTOMATIC'],
            ['EFECTIVO', 'CASH', 'AUTOMATIC'],
            [f.couponLabel, 'TRANSFER', 'MANUAL'],
          ]);
          expect(detail.skippedLines).toEqual([
            {
              lineNumber: 4,
              originalLabel: f.noteLabel,
              amount: 0,
              percentage: 0,
              resolution: 'AUTOMATIC',
            },
          ]);
          // Sin «recordar» no cambia ninguna equivalencia.
          const target = await f.tx.store.findUniqueOrThrow({
            where: { id: f.targetStoreId },
          });
          expect(target.subwayStoreId).toBeNull();
          expect(
            await f.tx.paymentMethodAlias.count({
              where: { normalizedLabel: f.couponLabel },
            }),
          ).toBe(0);
          expect(await storedFiles()).toHaveLength(1);

          const audit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
              entityId: detail.id,
            },
          });
          expect(audit.userId).toBe(f.admin.id);
          expect(audit.storeId).toBe(f.targetStoreId);
          expect(audit.detail).toMatchObject({
            businessDate: BUSINESS_DATE,
            totalAmount: 650_000,
            supersededImportId: null,
            manualResolution: {
              store: {
                storeId: f.targetStoreId,
                subwayStoreId: f.fileSubwayStoreId,
                remembered: false,
              },
              lines: [
                {
                  lineNumber: 3,
                  originalLabel: f.couponLabel,
                  action: 'ASSIGN',
                  paymentMethodId: f.methodIds['TRANSFER'],
                  remembered: false,
                },
              ],
              skippedLines: [{ lineNumber: 4, originalLabel: f.noteLabel }],
            },
          });

          // El detalle de la consulta conserva lo resuelto a mano.
          const again = await authorize(
            request(app.getHttpServer()).get(`/sales-imports/${detail.id}`),
            f.admin,
          ).expect(200);
          expect(again.body).toMatchObject({
            storeResolution: 'MANUAL',
            skippedLines: [{ originalLabel: f.noteLabel }],
          });
        });
      });

      it('repetir la misma resolución del mismo archivo es idempotente', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const first = await confirmResolved(file, fullResolution(f), f.admin)
            .expect(200)
            .then((response) => response.body as SalesImportDetail);
          const again = await confirmResolved(file, fullResolution(f), f.admin)
            .expect(200)
            .then((response) => response.body as SalesImportDetail);

          expect(again.id).toBe(first.id);
          expect(
            await f.tx.salesImport.count({
              where: { storeId: f.targetStoreId },
            }),
          ).toBe(1);
          expect(await storedFiles()).toHaveLength(1);
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
                entityId: first.id,
              },
            }),
          ).toBe(1);
        });
      });

      it('una corrección resuelta a mano reemplaza a la vigente solo si se indica de forma explícita', async () => {
        await withinRollback(async (f) => {
          const first = await confirmResolved(
            await excel(f),
            fullResolution(f),
            f.admin,
          )
            .expect(200)
            .then((response) => response.body as SalesImportDetail);

          // La opción del local trae la vigente que se reemplazaría.
          const corrected = await excel(f, { debit: 410_000 });
          const preview = await uploadPreview(corrected, f.admin)
            .expect(200)
            .then((response) => response.body as SalesImportPreview);
          expect(
            preview.resolutionOptions?.stores.find(
              (store) => store.id === f.targetStoreId,
            )?.activeImport,
          ).toMatchObject({ id: first.id, status: 'ACTIVE' });

          const conflict = await confirmResolved(
            corrected,
            fullResolution(f),
            f.admin,
          ).expect(409);
          expect(conflict.body).toMatchObject({
            activeImport: { id: first.id },
          });
          expect(await storedFiles()).toHaveLength(1);

          const second = await confirmResolved(
            corrected,
            fullResolution(f, { expectedActiveImportId: first.id }),
            f.admin,
          )
            .expect(200)
            .then((response) => response.body as SalesImportDetail);
          expect(second).toMatchObject({
            status: 'ACTIVE',
            version: 2,
            totalAmount: 660_000,
          });
          expect(second.versions.map((v) => [v.version, v.status])).toEqual([
            [2, 'ACTIVE'],
            [1, 'SUPERSEDED'],
          ]);
        });
      });
    });

    describe('recordar', () => {
      it('asigna el ID Subway al local y crea los alias, con auditoría; la siguiente carga ya no pide resolución', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const detail = await confirmResolved(
            file,
            fullResolution(f, {
              store: { storeId: f.targetStoreId, remember: true },
              lines: [
                {
                  lineNumber: 3,
                  action: 'ASSIGN',
                  paymentMethodId: f.methodIds['TRANSFER'],
                  remember: true,
                },
              ],
            }),
            f.admin,
          )
            .expect(200)
            .then((response) => response.body as SalesImportDetail);
          expect(detail.storeResolution).toBe('MANUAL');
          expect(detail.skippedLines.map((line) => line.originalLabel)).toEqual(
            [f.noteLabel],
          );

          const target = await f.tx.store.findUniqueOrThrow({
            where: { id: f.targetStoreId },
          });
          expect(target.subwayStoreId).toBe(f.fileSubwayStoreId);
          const aliases = await f.tx.paymentMethodAlias.findMany({
            where: { normalizedLabel: { in: [f.couponLabel, f.noteLabel] } },
            orderBy: { normalizedLabel: 'asc' },
          });
          // La nota omitida sola no recibe alias.
          expect(
            aliases.map((alias) => [alias.label, alias.paymentMethodId]),
          ).toEqual([[f.couponLabel, f.methodIds['TRANSFER']]]);

          const storeAudit = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.STORE_UPDATED,
              entityId: f.targetStoreId,
            },
          });
          expect(storeAudit.userId).toBe(f.admin.id);
          expect(storeAudit.detail).toEqual({
            previousSubwayStoreId: null,
            subwayStoreId: f.fileSubwayStoreId,
            source: 'sales_import',
          });
          const aliasAudits = await f.tx.auditLog.findMany({
            where: {
              action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_CREATED,
              entityId: { in: aliases.map((alias) => alias.id) },
            },
          });
          expect(aliasAudits).toHaveLength(1);
          expect(aliasAudits[0].userId).toBe(f.admin.id);

          // Reimportar el mismo archivo: identificado, sin resolución.
          const again = await uploadPreview(file, f.admin)
            .expect(200)
            .then((response) => response.body as SalesImportPreview);
          expect(again).toMatchObject({
            outcome: 'EXISTING',
            issues: [],
            store: { id: f.targetStoreId },
            resolutionOptions: null,
            import: { id: detail.id },
          });
          // Un archivo nuevo del mismo local se confirma sin elegir nada (la
          // nota en 0 se vuelve a omitir sola).
          const next = await uploadPreview(
            await excel(f, { debit: 420_000 }),
            f.admin,
          )
            .expect(201)
            .then((response) => response.body as SalesImportPreview);
          expect(next).toMatchObject({
            outcome: 'CREATED',
            canConfirm: true,
            issues: [],
            activeImport: { id: detail.id },
          });
          expect(next.import?.storeResolution).toBe('AUTOMATIC');
          expect(next.import?.skippedLines).toEqual([
            expect.objectContaining({
              originalLabel: f.noteLabel,
              resolution: 'AUTOMATIC',
            }),
          ]);
        });
      });

      it('nunca sobrescribe el ID Subway ya configurado en el local elegido', async () => {
        await withinRollback(async (f) => {
          await f.tx.store.update({
            where: { id: f.targetStoreId },
            data: { subwayStoreId: fakeSubwayStoreId() },
          });
          const before = await f.tx.store.findUniqueOrThrow({
            where: { id: f.targetStoreId },
          });
          const response = await confirmResolved(
            await excel(f),
            fullResolution(f, {
              store: { storeId: f.targetStoreId, remember: true },
            }),
            f.admin,
          ).expect(400);
          expect(response.body).toMatchObject({
            message: expect.stringContaining('no se sobrescribe') as string,
          });
          const after = await f.tx.store.findUniqueOrThrow({
            where: { id: f.targetStoreId },
          });
          expect(after.subwayStoreId).toBe(before.subwayStoreId);
          expect(await storedFiles()).toHaveLength(0);

          // Sin recordar sí se puede elegir ese local.
          await confirmResolved(
            await excel(f),
            fullResolution(f),
            f.admin,
          ).expect(200);
        });
      });
    });

    describe('crear el medio de pago (SPRINT-4A-T21)', () => {
      function createResolution(f: Fixture, name: string): Resolution {
        return fullResolution(f, {
          lines: [{ lineNumber: 3, action: 'CREATE', name, remember: true }],
        });
      }

      it('da de alta el medio activo con su alias y auditoría en la misma confirmación', async () => {
        await withinRollback(async (f) => {
          const name = `Cupón ${f.couponLabel.slice(6)}`;
          const code = `CUPON_${f.couponLabel.slice(6)}`;
          const file = await excel(f);
          const detail = await confirmResolved(
            file,
            createResolution(f, `  ${name}  `),
            f.admin,
          )
            .expect(200)
            .then((response) => response.body as SalesImportDetail);

          const method = await f.tx.paymentMethod.findUniqueOrThrow({
            where: { code },
          });
          expect(method).toMatchObject({
            name,
            isActive: true,
            behavior: 'EXTERNAL_OTHER',
            availableForTips: false,
          });
          expect(detail.lines[2]).toMatchObject({
            originalLabel: f.couponLabel,
            amount: 100_000,
            paymentMethod: { id: method.id, code, name },
            resolution: 'MANUAL',
          });
          expect(detail.skippedLines.map((line) => line.originalLabel)).toEqual(
            [f.noteLabel],
          );
          const alias = await f.tx.paymentMethodAlias.findUniqueOrThrow({
            where: {
              system_normalizedLabel: {
                system: 'MRCOMANDA',
                normalizedLabel: f.couponLabel,
              },
            },
          });
          expect(alias.paymentMethodId).toBe(method.id);

          const created = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.PAYMENT_METHOD_CREATED,
              entityId: method.id,
            },
          });
          expect(created.userId).toBe(f.admin.id);
          expect(created.detail).toEqual({
            code,
            name,
            sortOrder: method.sortOrder,
            behavior: 'EXTERNAL_OTHER',
            availableForTips: false,
            source: 'sales_import',
          });
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_CREATED,
                entityId: alias.id,
              },
            }),
          ).toBe(1);
          const confirmed = await f.tx.auditLog.findFirstOrThrow({
            where: {
              action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
              entityId: detail.id,
            },
          });
          expect(confirmed.detail).toMatchObject({
            manualResolution: {
              lines: [
                {
                  lineNumber: 3,
                  originalLabel: f.couponLabel,
                  action: 'CREATE',
                  paymentMethodId: method.id,
                  remembered: true,
                },
              ],
            },
          });

          // La siguiente carga del mismo cupón ya lo identifica por su alias.
          const again = await uploadPreview(
            await excel(f, { debit: 420_000 }),
            f.admin,
          )
            .expect(200)
            .then((response) => response.body as SalesImportPreview);
          expect(again.issues.map((issue) => issue.code)).toEqual([
            'STORE_NOT_CONFIGURED',
          ]);
          expect(again.lines[2].paymentMethod?.id).toBe(method.id);
        });
      });

      it('no duplica un medio existente: 409 con código estable y sin guardar nada', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          const methodsBefore = await f.tx.paymentMethod.count();
          // Mismo nombre que un medio activo, sin distinguir mayúsculas.
          const transfer = await f.tx.paymentMethod.findUniqueOrThrow({
            where: { id: f.methodIds['TRANSFER'] },
          });
          const active = await confirmResolved(
            file,
            createResolution(f, ` ${transfer.name.toLowerCase()} `),
            f.admin,
          ).expect(409);
          expect(active.body).toMatchObject({
            code: 'PAYMENT_METHOD_NAME_TAKEN',
            message: expect.stringContaining(
              'elígelo en el selector',
            ) as string,
          });
          const inactive = await f.tx.paymentMethod.findUniqueOrThrow({
            where: { id: f.methodIds['INACTIVE'] },
          });
          const reactivate = await confirmResolved(
            file,
            createResolution(f, inactive.name.toUpperCase()),
            f.admin,
          ).expect(409);
          expect(reactivate.body).toMatchObject({
            code: 'PAYMENT_METHOD_NAME_TAKEN',
            message: expect.stringContaining('reactívalo') as string,
          });
          expect(await f.tx.paymentMethod.count()).toBe(methodsBefore);
          await expectNothingSaved(f);
        });
      });

      it('si la confirmación falla, el medio nuevo tampoco queda creado', async () => {
        await withinRollback(async (f) => {
          const code = `CUPON_${f.couponLabel.slice(6)}`;
          await confirmResolved(
            await excel(f),
            {
              ...createResolution(f, `Cupón ${f.couponLabel.slice(6)}`),
              expectedActiveImportId: randomUUID(),
            },
            f.admin,
          ).expect(409);
          expect(await f.tx.paymentMethod.count({ where: { code } })).toBe(0);
          await expectNothingSaved(f);
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.PAYMENT_METHOD_CREATED,
                userId: f.admin.id,
              },
            }),
          ).toBe(0);
        });
      });
    });

    describe('rechazos', () => {
      it('responde 400 y no guarda nada si la resolución es inválida o incompleta', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          await f.tx.store.update({
            where: { id: f.otherStoreId },
            data: { isActive: false },
          });
          const cases: { resolution: Resolution | string; message: string }[] =
            [
              {
                resolution: fullResolution(f, { store: null }),
                message: 'Elige el local',
              },
              {
                resolution: fullResolution(f, {
                  store: { storeId: f.otherStoreId, remember: false },
                }),
                message: 'está inactivo',
              },
              {
                resolution: fullResolution(f, { lines: [] }),
                message: `Falta elegir el medio de pago de «${f.couponLabel}»`,
              },
              // SPRINT-4A-T21: ninguna línea con valor se puede omitir (la
              // acción SKIP ya no existe) y la línea en 0 no se resuelve.
              {
                resolution: fullResolution(f, {
                  lines: [{ lineNumber: 3, action: 'SKIP', remember: false }],
                }),
                message: 'lines.action debe ser ASSIGN o CREATE',
              },
              {
                resolution: fullResolution(f, {
                  lines: [
                    ...fullResolution(f).lines,
                    {
                      lineNumber: 4,
                      action: 'ASSIGN',
                      paymentMethodId: f.methodIds['CASH'],
                      remember: false,
                    },
                  ],
                }),
                message: 'se omite sola por estar en 0',
              },
              {
                resolution: fullResolution(f, {
                  lines: [{ lineNumber: 3, action: 'CREATE', remember: true }],
                }),
                message: 'lines.name',
              },
              {
                resolution: fullResolution(f, {
                  lines: [
                    {
                      lineNumber: 3,
                      action: 'CREATE',
                      name: 'Cupón',
                      remember: false,
                    },
                  ],
                }),
                message: 'siempre se recuerda',
              },
              {
                resolution: fullResolution(f, {
                  lines: [
                    {
                      lineNumber: 3,
                      action: 'ASSIGN',
                      paymentMethodId: f.methodIds['INACTIVE'],
                      remember: false,
                    },
                  ],
                }),
                message: 'está inactivo',
              },
              {
                resolution: fullResolution(f, {
                  lines: [
                    ...fullResolution(f).lines,
                    {
                      lineNumber: 1,
                      action: 'ASSIGN',
                      paymentMethodId: f.methodIds['CASH'],
                      remember: false,
                    },
                  ],
                }),
                message: 'La línea 1 no está pendiente',
              },
              {
                resolution: '{"expectedActiveImportId":null',
                message: 'resolution debe ser un JSON',
              },
              {
                resolution: fullResolution(f, {
                  lines: [
                    {
                      lineNumber: 3,
                      action: 'ASSIGN',
                      remember: false,
                    },
                  ],
                }),
                message: 'paymentMethodId',
              },
            ];
          for (const { resolution, message } of cases) {
            const response = await confirmResolved(
              file,
              resolution,
              f.admin,
            ).expect(400);
            expect(JSON.stringify(response.body)).toContain(message);
          }
          await expectNothingSaved(f);
          expect(
            await f.tx.auditLog.count({
              where: {
                action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
                userId: f.admin.id,
              },
            }),
          ).toBe(0);
        });
      });

      it('rechaza resolver a mano un archivo cuyo local se identificó', async () => {
        await withinRollback(async (f) => {
          const response = await confirmResolved(
            await excel(f, { subwayStoreId: f.otherSubwayStoreId }),
            fullResolution(f),
            f.admin,
          ).expect(400);
          expect(response.body).toMatchObject({
            message: expect.stringContaining(
              'ya se identificó por su ID Subway',
            ) as string,
          });
          await expectNothingSaved(f);
        });
      });

      it('exige el archivo', async () => {
        await withinRollback(async (f) => {
          await confirmResolved(null, fullResolution(f), f.admin).expect(400);
        });
      });

      it('solo el ADMINISTRADOR resuelve a mano', async () => {
        await withinRollback(async (f) => {
          const file = await excel(f);
          await confirmResolved(file, fullResolution(f), null).expect(401);
          for (const user of [f.supervisor, f.accountant]) {
            await confirmResolved(file, fullResolution(f), user).expect(403);
          }
          await expectNothingSaved(f);
        });
      });
    });

    describe('reglas de la base de datos', () => {
      async function header(
        f: Fixture,
        data: Partial<Prisma.SalesImportUncheckedCreateInput>,
      ): Promise<string> {
        const created = await f.tx.salesImport.create({
          data: {
            system: 'MRCOMANDA',
            storeId: f.targetStoreId,
            businessDate: new Date(`${BUSINESS_DATE}T00:00:00.000Z`),
            periodStart: new Date('2026-03-14T03:00:00.000Z'),
            periodEnd: new Date('2026-03-15T02:59:59.000Z'),
            externalStoreCode: `208 - ${f.fileSubwayStoreId}`,
            subwayStoreId: f.fileSubwayStoreId,
            version: 1,
            totalAmount: 1000n,
            fileName: 'ventas.xlsx',
            filePath: `sales-imports/${randomUUID()}.xlsx`,
            mimeType: 'application/octet-stream',
            sizeBytes: 10n,
            sha256Hash: 'a'.repeat(64),
            uploadedById: f.admin.id,
            storeResolution: 'MANUAL',
            resolvedById: f.admin.id,
            resolvedAt: new Date(),
            ...data,
          },
          select: { id: true },
        });
        return created.id;
      }

      // Cada rechazo de la base aborta la transacción: se aísla en un
      // savepoint para seguir usando la misma.
      async function rejected(
        f: Fixture,
        run: () => Promise<unknown>,
      ): Promise<string> {
        await f.tx.$executeRawUnsafe('SAVEPOINT t18');
        try {
          await run();
        } catch (error) {
          await f.tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT t18');
          return error instanceof Error ? error.message : String(error);
        }
        await f.tx.$executeRawUnsafe('RELEASE SAVEPOINT t18');
        throw new Error('Se esperaba un rechazo de la base');
      }

      it('un local MANUAL debe estar activo y no contradecir otro local identificado', async () => {
        await withinRollback(async (f) => {
          await f.tx.store.update({
            where: { id: f.targetStoreId },
            data: { isActive: false },
          });
          expect(await rejected(f, () => header(f, {}))).toContain(
            'debe estar activo',
          );
          await f.tx.store.update({
            where: { id: f.targetStoreId },
            data: { isActive: true },
          });
          expect(
            await rejected(f, () =>
              header(f, {
                subwayStoreId: f.otherSubwayStoreId,
                externalStoreCode: `208 - ${f.otherSubwayStoreId}`,
              }),
            ),
          ).toContain('ya identifica a otro local activo');
          expect(
            await rejected(f, () =>
              header(f, { resolvedById: null, resolvedAt: null }),
            ),
          ).toContain('sales_imports_resolution_consistency');
          // Un local AUTOMATIC sigue exigiendo su ID Subway.
          expect(
            await rejected(f, () =>
              header(f, { storeResolution: 'AUTOMATIC' }),
            ),
          ).toContain('no está asignado al local de la importación');
        });
      });

      it('las líneas MANUAL exigen medio activo, sin alias hacia otro medio, y la resolución es inmutable', async () => {
        await withinRollback(async (f) => {
          const id = await header(f, {});
          const line = (
            label: string,
            paymentMethodId: string,
            lineNumber = 1,
          ): Promise<unknown> =>
            f.tx.salesImportLine.create({
              data: {
                importId: id,
                lineNumber,
                originalLabel: label,
                normalizedLabel: label,
                amount: 1000n,
                paymentMethodId,
                resolution: 'MANUAL',
              },
            });
          expect(
            await rejected(f, () =>
              line(f.couponLabel, f.methodIds['INACTIVE']),
            ),
          ).toContain('debe estar activo');
          expect(
            await rejected(f, () => line('EFECTIVO', f.methodIds['TRANSFER'])),
          ).toContain('ya tiene un alias hacia otro medio');
          await line(f.couponLabel, f.methodIds['TRANSFER']);
          expect(
            await rejected(f, () =>
              f.tx.salesImport.update({
                where: { id },
                data: { storeResolution: 'AUTOMATIC' },
              }),
            ),
          ).toContain('son inmutables');
        });
      });

      it('una línea omitida exige monto 0 y etiqueta sin alias; solo la omisión a mano exige cabecera resuelta a mano', async () => {
        await withinRollback(async (f) => {
          const manual = await header(f, {});
          const skipped = (
            importId: string,
            label: string,
            amount = 0n,
            resolution: 'AUTOMATIC' | 'MANUAL' = 'AUTOMATIC',
            lineNumber = 4,
          ): Promise<unknown> =>
            f.tx.salesImportSkippedLine.create({
              data: {
                importId,
                lineNumber,
                originalLabel: label,
                normalizedLabel: label,
                amount,
                resolution,
              },
            });
          // Ninguna línea con valor se omite, por ninguna vía.
          expect(
            await rejected(f, () => skipped(manual, f.noteLabel, 500n)),
          ).toContain('sales_import_skipped_lines_amount_zero');
          expect(
            await rejected(f, () => skipped(manual, 'EFECTIVO')),
          ).toContain('tiene un alias configurado');

          await f.tx.store.update({
            where: { id: f.targetStoreId },
            data: { subwayStoreId: f.fileSubwayStoreId },
          });
          const automatic = await header(f, {
            storeResolution: 'AUTOMATIC',
            resolvedById: null,
            resolvedAt: null,
            sha256Hash: 'b'.repeat(64),
            version: 2,
          });
          // SPRINT-4A-T21: la omisión automática no exige resolución manual;
          // la omisión a mano sí.
          expect(
            await rejected(f, () =>
              skipped(automatic, f.noteLabel, 0n, 'MANUAL'),
            ),
          ).toContain('Solo una importación resuelta a mano');
          expect(
            await rejected(f, () => skipped(automatic, f.noteLabel, 1n)),
          ).toContain('sales_import_skipped_lines_amount_zero');
          await skipped(automatic, f.noteLabel);
          const stored = await f.tx.salesImportSkippedLine.findFirstOrThrow({
            where: { importId: automatic },
          });
          expect(stored.resolution).toBe('AUTOMATIC');

          await skipped(manual, f.noteLabel, 0n, 'MANUAL');
          for (const data of [
            { originalLabel: `${f.noteLabel} X` },
            { resolution: 'MANUAL' as const },
          ]) {
            expect(
              await rejected(f, () =>
                f.tx.salesImportSkippedLine.updateMany({
                  where: { importId: automatic },
                  data,
                }),
              ),
            ).toContain('son inmutables');
          }
        });
      });
    });
  },
);
