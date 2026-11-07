import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import {
  MAX_VOUCHER_BYTES,
  type DailyOperationResponse,
} from '../src/daily-operations/types/daily-operations.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la operación diaria (SPRINT-4R-T01) contra
// PostgreSQL real. Todo corre dentro de withinRollback: la base se revierte;
// los vouchers se escriben en disco en una carpeta temporal que se elimina al
// terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = '2026-03-10';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const JPEG_OTHER = Buffer.from([
  0xff, 0xd8, 0xff, 0xe1, 0x02, 0x2a, 0x45, 0x78, 0x69, 0x66,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const PDF = Buffer.from('%PDF-1.7\ncontenido\n%%EOF');

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  otherStoreId: string;
  supervisor: AuthUser;
  otherSupervisor: AuthUser;
  admin: AuthUser;
  accountant: AuthUser;
  worker: AuthUser;
}

function messagesOf(body: unknown): string {
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message : '';
}

describe.skipIf(!databaseUrl)(
  'API de operación diaria (SPRINT-4R-T01)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let voucherRoot: string;

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

    interface Fields {
      storeId: string;
      businessDate: string;
      cardTipAmount: number;
      cashTipAmount: number;
      cashDifference: number;
      differenceReason?: string;
    }

    function postMultipart(
      fields: Fields,
      voucher: { buffer: Buffer; filename: string } | null,
      user: AuthUser | null,
    ): request.Test {
      let req = request(app.getHttpServer()).post('/daily-operations');
      req = authorize(req, user);
      req = req
        .field('storeId', fields.storeId)
        .field('businessDate', fields.businessDate)
        .field('cardTipAmount', String(fields.cardTipAmount))
        .field('cashTipAmount', String(fields.cashTipAmount))
        .field('cashDifference', String(fields.cashDifference));
      if (fields.differenceReason !== undefined) {
        req = req.field('differenceReason', fields.differenceReason);
      }
      if (voucher) {
        req = req.attach('voucher', voucher.buffer, voucher.filename);
      }
      return req;
    }

    function baseFields(f: Fixture, overrides: Partial<Fields> = {}): Fields {
      return {
        storeId: f.storeId,
        businessDate: BUSINESS_DATE,
        cardTipAmount: 31602,
        cashTipAmount: 4500,
        cashDifference: -1000,
        differenceReason: 'Faltante por vuelto no registrado',
        ...overrides,
      };
    }

    function list(
      f: Fixture,
      storeId: string,
      date: string,
      user: AuthUser | null,
    ) {
      return authorize(
        request(app.getHttpServer()).get(
          `/daily-operations?storeId=${storeId}&businessDate=${date}`,
        ),
        user,
      );
    }

    function getOne(id: string, user: AuthUser | null) {
      return authorize(
        request(app.getHttpServer()).get(`/daily-operations/${id}`),
        user,
      );
    }

    function getVoucher(id: string, user: AuthUser | null) {
      return authorize(
        request(app.getHttpServer()).get(`/daily-operations/${id}/voucher`),
        user,
      );
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
      const email = `${id}@daily-operations-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Operación',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      const store = await tx.store.create({
        data: {
          name: `Subway Operación Diaria ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Operación Diaria Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      return {
        tx,
        storeId: store.id,
        otherStoreId: otherStore.id,
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id),
        otherSupervisor: await createUser(tx, ROLE.SUPERVISOR, otherStore.id),
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id),
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

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      voucherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-daily-'));
      process.env.DOCUMENTS_STORAGE_PATH = voucherRoot;
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
      await fs.rm(voucherRoot, { recursive: true, force: true });
    });

    it('registra la operación diaria con voucher y audita con lista blanca', async () => {
      await withinRollback(async (f) => {
        const response = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher-terminal-1.jpg' },
          f.supervisor,
        ).expect(201);
        const body = response.body as DailyOperationResponse;

        expect(body).toMatchObject({
          businessDate: BUSINESS_DATE,
          cardTipAmount: 31602,
          cashTipAmount: 4500,
          tipFundAmount: 36102,
          cashDifference: -1000,
          differenceReason: 'Faltante por vuelto no registrado',
          store: { id: f.storeId },
          responsible: { id: f.supervisor.id },
        });
        expect(body.voucher).toMatchObject({
          fileName: 'voucher-terminal-1.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: JPEG.length,
        });
        expect(body.voucher?.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
        expect(body.createdAt).toBeDefined();
        expect(body.updatedAt).toBeDefined();

        // El fondo es la suma de ambos montos (una sola fuente de propinas).
        expect(body.tipFundAmount).toBe(
          body.cardTipAmount + body.cashTipAmount,
        );

        // Se guardó exactamente una operación y una fila de voucher.
        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
        const voucherRow = await f.tx.dailyOperationVoucher.findFirstOrThrow({
          where: { operation: { storeId: f.storeId } },
        });
        expect(voucherRow.sha256Hash).toBe(body.voucher?.sha256Hash);
        const onDisk = await fs.readFile(
          path.join(voucherRoot, voucherRow.filePath),
        );
        expect(onDisk.equals(JPEG)).toBe(true);

        // Auditoría con lista blanca: montos y hash, jamás contenido.
        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_CREATED,
            entityId: body.id,
          },
        });
        expect(audit.storeId).toBe(f.storeId);
        expect(audit.userId).toBe(f.supervisor.id);
        expect(audit.detail).toEqual({
          storeId: f.storeId,
          businessDate: BUSINESS_DATE,
          cardTipAmount: 31602,
          cashTipAmount: 4500,
          tipFundAmount: 36102,
          cashDifference: -1000,
          differenceReason: 'Faltante por vuelto no registrado',
          voucherSha256: body.voucher?.sha256Hash,
        });
      });
    });

    it('resuelve el reintento idéntico (mismo archivo) con 200 sin duplicar', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;

        const retry = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'otro-nombre.jpg' },
          f.supervisor,
        ).expect(200);
        const body = retry.body as DailyOperationResponse;
        expect(body.id).toBe(created.id);
        // El nombre original se conserva del primer registro.
        expect(body.voucher?.fileName).toBe('voucher.jpg');

        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
        // El reintento idéntico no se audita de nuevo.
        const audits = await f.tx.auditLog.count({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_CREATED,
            storeId: f.storeId,
          },
        });
        expect(audits).toBe(1);
      });
    });

    it('conflicto 409 con existingOperationId ante contenido distinto', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;

        const differentAmounts = await postMultipart(
          baseFields(f, { cashTipAmount: 999 }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(409);
        expect(differentAmounts.body).toMatchObject({
          statusCode: 409,
          existingOperationId: created.id,
        });

        // Mismos montos pero voucher distinto: también es conflicto.
        const differentVoucher = await postMultipart(
          baseFields(f),
          { buffer: JPEG_OTHER, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(409);
        expect(differentVoucher.body).toMatchObject({
          existingOperationId: created.id,
        });

        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
      });
    });

    it('consulta por local/fecha: arreglo de 0 o 1 operaciones', async () => {
      await withinRollback(async (f) => {
        const empty = await list(
          f,
          f.storeId,
          BUSINESS_DATE,
          f.supervisor,
        ).expect(200);
        expect(empty.body).toEqual([]);

        const created = (
          await postMultipart(
            baseFields(f, { cardTipAmount: 0, cashDifference: 0 }),
            null,
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;
        expect(created.voucher).toBeNull();

        const found = await list(
          f,
          f.storeId,
          BUSINESS_DATE,
          f.supervisor,
        ).expect(200);
        expect(
          (found.body as DailyOperationResponse[]).map((op) => op.id),
        ).toEqual([created.id]);

        const otherDate = await list(
          f,
          f.storeId,
          '2026-03-11',
          f.supervisor,
        ).expect(200);
        expect(otherDate.body).toEqual([]);
      });
    });

    it('exige voucher con propina de tarjeta y rechaza voucher sin ella', async () => {
      await withinRollback(async (f) => {
        await postMultipart(baseFields(f), null, f.supervisor).expect(400);
        await postMultipart(
          baseFields(f, { cardTipAmount: 0, cashDifference: 0 }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(0);
      });
    });

    it('exige motivo cuando la diferencia no es cero', async () => {
      await withinRollback(async (f) => {
        const fields = baseFields(f);
        delete fields.differenceReason;
        const response = await postMultipart(
          fields,
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
        expect(messagesOf(response.body)).toContain('differenceReason');
      });
    });

    it('valida firma real, tipo declarado y tamaño del voucher', async () => {
      await withinRollback(async (f) => {
        // PDF no es un tipo de voucher aceptado (rechazo por contenido).
        await postMultipart(
          baseFields(f),
          { buffer: PDF, filename: 'voucher.pdf' },
          f.supervisor,
        ).expect(415);

        // Contenido JPEG declarado como PNG: el tipo declarado no coincide.
        const declared = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.png' },
          f.supervisor,
        );
        // Multer envía el tipo declarado del navegador; con "image/png" sobre
        // contenido JPEG el servicio rechaza por discrepancia.
        expect(declared.status).toBe(415);

        // Supera los 5 MiB permitidos.
        const big = Buffer.concat([
          PNG,
          Buffer.alloc(MAX_VOUCHER_BYTES + 1 - PNG.length, 0x00),
        ]);
        await postMultipart(
          baseFields(f),
          { buffer: big, filename: 'voucher-grande.png' },
          f.supervisor,
        ).expect(413);
      });
    });

    it('valida campos del formulario y rechazados por el pipe', async () => {
      await withinRollback(async (f) => {
        await postMultipart(
          baseFields(f, { businessDate: '2026-02-30' }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
        await postMultipart(
          baseFields(f, { cardTipAmount: -1 }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
        await postMultipart(
          baseFields(f, { cashTipAmount: 12.5 as unknown as number }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
      });
    });

    it('rechaza al supervisor de otro local, a otros roles y a anónimos', async () => {
      await withinRollback(async (f) => {
        await postMultipart(baseFields(f), null, null).expect(401);
        await postMultipart(baseFields(f), null, f.worker).expect(403);
        await postMultipart(baseFields(f), null, f.admin).expect(403);
        await postMultipart(
          baseFields(f, { storeId: f.otherStoreId }),
          null,
          f.supervisor,
        ).expect(403);

        await list(f, f.otherStoreId, BUSINESS_DATE, f.supervisor).expect(403);
        await list(f, f.storeId, BUSINESS_DATE, f.worker).expect(403);
        await list(f, f.storeId, BUSINESS_DATE, null).expect(401);
        // El contador (rol global) sí lee cualquier local.
        await list(f, f.storeId, BUSINESS_DATE, f.accountant).expect(200);
      });
    });

    it('rechaza la operación de un local inactivo', async () => {
      await withinRollback(async (f) => {
        await f.tx.store.update({
          where: { id: f.storeId },
          data: { isActive: false },
        });
        await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
      });
    });

    it('detalle por ID aplica JWT, rol y aislamiento por local', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;

        await getOne(created.id, f.supervisor).expect(200);
        await getOne(created.id, f.admin).expect(200);
        await getOne(created.id, f.accountant).expect(200);
        await getOne(created.id, f.otherSupervisor).expect(403);
        await getOne(created.id, f.worker).expect(403);
        await getOne(created.id, null).expect(401);
        await getOne(MISSING_ID, f.supervisor).expect(404);
        await getOne('no-es-uuid', f.supervisor).expect(400);
      });
    });

    it('descarga el voucher solo autorizado y auditado, con integridad válida', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher-terminal-1.jpg' },
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;

        const download = await getVoucher(created.id, f.supervisor).expect(200);
        expect(download.headers['content-type']).toContain('image/jpeg');
        expect(download.headers['x-voucher-integrity']).toBe('VALID');
        expect(download.headers['content-disposition']).toContain(
          'voucher-terminal-1.jpg',
        );
        expect(Buffer.compare(download.body as Buffer, JPEG)).toBe(0);

        await getVoucher(created.id, f.otherSupervisor).expect(403);
        await getVoucher(created.id, f.worker).expect(403);
        await getVoucher(created.id, null).expect(401);
        await getVoucher(MISSING_ID, f.supervisor).expect(404);

        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_VOUCHER_DOWNLOADED,
            entityId: created.id,
          },
        });
        expect(audit.storeId).toBe(f.storeId);
        expect(audit.detail).toMatchObject({
          operationId: created.id,
          integrity: 'VALID',
        });
      });
    });

    it('responde 404 al descargar el voucher de una operación sin propina de tarjeta', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f, { cardTipAmount: 0, cashDifference: 0 }),
            null,
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;
        await getVoucher(created.id, f.supervisor).expect(404);
      });
    });

    it('guarda la diferencia de efectivo con signo y motivo en la base', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f, { cashDifference: 2500 }),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
          ).expect(201)
        ).body as DailyOperationResponse;
        const row = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(row.cashDifference).toBe(BigInt(2500));
        expect(row.tipFundAmount).toBe(row.cardTipAmount + row.cashTipAmount);
      });
    });
  },
);
