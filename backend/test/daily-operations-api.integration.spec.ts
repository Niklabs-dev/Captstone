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
import { minimalJpeg } from './helpers/jpeg.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Tests de integración HTTP de la operación diaria (SPRINT-4R-T01 y
// SPRINT-4R-T03) contra PostgreSQL real: catálogo acotado de elegibles,
// persistencia transaccional de la selección de participantes en el alta y
// su corrección multipart, idempotencia con la selección comparada como
// conjunto, autorización por local y rol, auditoría con lista blanca y los
// triggers T02 (reparto CONFIRMED/PAID inmutable). Todo corre dentro de
// withinRollback: la base se revierte; los vouchers se escriben en disco en
// una carpeta temporal que se elimina al terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

const BUSINESS_DATE = '2026-03-10';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Imágenes mínimas completas: firma + marca de cierre de cada formato
// (el chequeo estructural de SPRINT-4R-T18 rechaza las truncadas).
const JPEG = minimalJpeg('voucher-a');
const JPEG_OTHER = minimalJpeg('voucher-b');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
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
  worker2: AuthUser;
  inactiveWorker: AuthUser;
  otherWorker: AuthUser;
}

function messagesOf(body: unknown): string {
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join(' ');
  return typeof message === 'string' ? message : '';
}

describe.skipIf(!databaseUrl)(
  'API de operación diaria (SPRINT-4R-T01 y SPRINT-4R-T03)',
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
      participantIds: string[] = [],
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
      for (const participantId of participantIds) {
        req = req.field('participantIds', participantId);
      }
      if (voucher) {
        req = req.attach('voucher', voucher.buffer, voucher.filename);
      }
      return req;
    }

    function patchMultipart(
      id: string,
      fields: {
        cardTipAmount?: number;
        cashTipAmount?: number;
        cashDifference?: number;
        differenceReason?: string;
        participantIds?: string[];
      },
      voucher: { buffer: Buffer; filename: string } | null,
      user: AuthUser | null,
    ): request.Test {
      let req = authorize(
        request(app.getHttpServer()).patch(`/daily-operations/${id}`),
        user,
      );
      if (fields.cardTipAmount !== undefined) {
        req = req.field('cardTipAmount', String(fields.cardTipAmount));
      }
      if (fields.cashTipAmount !== undefined) {
        req = req.field('cashTipAmount', String(fields.cashTipAmount));
      }
      if (fields.cashDifference !== undefined) {
        req = req.field('cashDifference', String(fields.cashDifference));
      }
      if (fields.differenceReason !== undefined) {
        req = req.field('differenceReason', fields.differenceReason);
      }
      for (const participantId of fields.participantIds ?? []) {
        req = req.field('participantIds', participantId);
      }
      if (voucher) {
        req = req.attach('voucher', voucher.buffer, voucher.filename);
      }
      return req;
    }

    function eligibleWorkers(
      f: Fixture,
      storeId: string,
      user: AuthUser | null,
    ) {
      return authorize(
        request(app.getHttpServer()).get(
          `/daily-operations/eligible-workers?storeId=${storeId}`,
        ),
        user,
      );
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

    /// Participantes por defecto del alta con fondo > 0: Ana y Beto.
    function defaultParticipants(f: Fixture): string[] {
      return [f.worker.id, f.worker2.id];
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
      options: { active?: boolean; firstName?: string; lastName?: string } = {},
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
          firstName: options.firstName ?? role,
          lastName: options.lastName ?? 'Operación',
          isActive: options.active ?? true,
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
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id, {
          firstName: 'Ana',
          lastName: 'Participa',
        }),
        worker2: await createUser(tx, ROLE.TRABAJADOR, store.id, {
          firstName: 'Beto',
          lastName: 'Participa',
        }),
        inactiveWorker: await createUser(tx, ROLE.TRABAJADOR, store.id, {
          firstName: 'Cora',
          lastName: 'De Baja',
          active: false,
        }),
        otherWorker: await createUser(tx, ROLE.TRABAJADOR, otherStore.id, {
          firstName: 'Dario',
          lastName: 'Otro Local',
        }),
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
      const vouchersDir = path.join(voucherRoot, 'vouchers');
      let relative: string[];
      try {
        relative = await fs.readdir(vouchersDir, { recursive: true });
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return [];
        }
        throw error;
      }
      const absolute = relative.map((entry) => path.join(vouchersDir, entry));
      const stats = await Promise.all(
        absolute.map(async (entry) => ({
          entry,
          stat: await fs.stat(entry).catch(() => null),
        })),
      );
      return stats
        .filter((item) => item.stat !== null && item.stat.isFile())
        .map((item) => item.entry);
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

    it('registra la operación diaria con voucher, participantes y audita con lista blanca', async () => {
      await withinRollback(async (f) => {
        const response = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher-terminal-1.jpg' },
          f.supervisor,
          defaultParticipants(f),
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

        // La respuesta expone la selección con id y nombre, sin datos
        // personales (Ley N°21.719), ordenada por nombre.
        expect(body.participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
          { id: f.worker2.id, name: 'Beto Participa' },
        ]);

        // Se guardó exactamente una operación, una fila de voucher y dos
        // participaciones, todos en la misma transacción.
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
        const participants = await f.tx.dailyOperationParticipant.findMany({
          where: { operationId: body.id },
        });
        expect(participants.map((row) => row.workerId).sort()).toEqual(
          [f.worker.id, f.worker2.id].sort(),
        );

        // Auditoría con lista blanca: montos, hash y selección, jamás
        // contenido del archivo ni datos personales de los trabajadores.
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
          participantIds: [f.worker.id, f.worker2.id],
          cardTipAmount: 31602,
          cashTipAmount: 4500,
          tipFundAmount: 36102,
          cashDifference: -1000,
          differenceReason: 'Faltante por vuelto no registrado',
          voucherSha256: body.voucher?.sha256Hash,
        });
        expect(JSON.stringify(audit.detail)).not.toContain(f.worker.email);
      });
    });

    it('resuelve el reintento idéntico (misma selección en otro orden) con 200 sin duplicar', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            [f.worker.id, f.worker2.id],
          ).expect(201)
        ).body as DailyOperationResponse;

        // Mismos participantes en orden distinto y mismo archivo (por hash):
        // el reintento es idéntico aunque el nombre del archivo cambie.
        const retry = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'otro-nombre.jpg' },
          f.supervisor,
          [f.worker2.id, f.worker.id],
        ).expect(200);
        const body = retry.body as DailyOperationResponse;
        expect(body.id).toBe(created.id);
        // El nombre original se conserva del primer registro.
        expect(body.voucher?.fileName).toBe('voucher.jpg');
        expect(body.participants).toEqual(created.participants);

        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
        // Reintento no duplica la selección.
        const participants = await f.tx.dailyOperationParticipant.count({
          where: { operationId: created.id },
        });
        expect(participants).toBe(2);
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

    it('conflicto 409 con existingOperationId ante contenido o selección distintos', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;

        const differentAmounts = await postMultipart(
          baseFields(f, { cashTipAmount: 999 }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          defaultParticipants(f),
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
          defaultParticipants(f),
        ).expect(409);
        expect(differentVoucher.body).toMatchObject({
          existingOperationId: created.id,
        });

        // Mismos montos y voucher pero selección distinta: no es un reintento
        // idéntico y no sobrescribe silenciosamente la selección.
        const differentSelection = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          [f.worker.id],
        ).expect(409);
        expect(differentSelection.body).toMatchObject({
          existingOperationId: created.id,
        });

        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(1);
        const participants = await f.tx.dailyOperationParticipant.count({
          where: { operationId: created.id },
        });
        expect(participants).toBe(2);
      });
    });

    it('lista los elegibles del local acotado, ordenados y sin datos personales', async () => {
      await withinRollback(async (f) => {
        const response = await eligibleWorkers(
          f,
          f.storeId,
          f.supervisor,
        ).expect(200);
        // TRABAJADOR y SUPERVISOR activos del local (SPRINT-4A-T01), por
        // firstName, lastName, id: incluye al supervisor del local y excluye
        // a la inactiva (Cora), al de otro local (Dario), al supervisor de
        // otro local y a ADMINISTRADOR/CONTADOR. Solo expone id y nombre.
        expect(response.body).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
          { id: f.worker2.id, name: 'Beto Participa' },
          { id: f.supervisor.id, name: 'SUPERVISOR Operación' },
        ]);
        expect(JSON.stringify(response.body)).not.toContain(f.worker.email);

        // El ADMINISTRADOR (rol global) lista cualquier local.
        await eligibleWorkers(f, f.otherStoreId, f.admin).expect(200, [
          { id: f.otherWorker.id, name: 'Dario Otro Local' },
          { id: f.otherSupervisor.id, name: 'SUPERVISOR Operación' },
        ]);
        await eligibleWorkers(f, f.storeId, f.admin).expect(200);

        // Alcance por local y roles: solo SUPERVISOR/ADMINISTRADOR.
        await eligibleWorkers(f, f.otherStoreId, f.supervisor).expect(403);
        await eligibleWorkers(f, f.storeId, f.worker).expect(403);
        await eligibleWorkers(f, f.storeId, f.accountant).expect(403);
        await eligibleWorkers(f, f.storeId, null).expect(401);
        await eligibleWorkers(f, 'no-es-uuid', f.supervisor).expect(400);
      });
    });

    it('acepta al supervisor del local como participante en POST y PATCH (SPRINT-4A-T01)', async () => {
      await withinRollback(async (f) => {
        const response = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          [f.supervisor.id, f.worker.id],
        ).expect(201);
        const body = response.body as DailyOperationResponse;
        expect(body.participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
          { id: f.supervisor.id, name: 'SUPERVISOR Operación' },
        ]);

        // La corrección también lo acepta (solo el supervisor participa).
        const corrected = await patchMultipart(
          body.id,
          { participantIds: [f.supervisor.id] },
          null,
          f.supervisor,
        ).expect(200);
        expect((corrected.body as DailyOperationResponse).participants).toEqual(
          [{ id: f.supervisor.id, name: 'SUPERVISOR Operación' }],
        );

        // ...y rechaza con 400 a ADMINISTRADOR, CONTADOR, inactivos y
        // usuarios de otro local sin tocar la selección.
        for (const ineligible of [
          f.admin,
          f.accountant,
          f.inactiveWorker,
          f.otherSupervisor,
        ]) {
          const rejected = await patchMultipart(
            body.id,
            { participantIds: [ineligible.id] },
            null,
            f.supervisor,
          ).expect(400);
          expect(messagesOf(rejected.body)).toContain(ineligible.id);
        }
        const stored = await f.tx.dailyOperationParticipant.findMany({
          where: { operationId: body.id },
          select: { workerId: true },
        });
        expect(stored).toEqual([{ workerId: f.supervisor.id }]);
      });
    });

    it('exige participantes con fondo mayor que 0 y rechaza selección con fondo 0', async () => {
      await withinRollback(async (f) => {
        // Sin participantIds con fondo > 0.
        const withoutParticipants = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);
        expect(messagesOf(withoutParticipants.body)).toContain(
          'al menos un trabajador',
        );

        // participantIds explícitamente vacío con fondo > 0.
        await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          [],
        ).expect(400);

        // participantIds informado con fondo 0.
        const withFundZero = await postMultipart(
          baseFields(f, {
            cardTipAmount: 0,
            cashTipAmount: 0,
            cashDifference: 0,
          }),
          null,
          f.supervisor,
          [f.worker.id],
        ).expect(400);
        expect(messagesOf(withFundZero.body)).toContain('fondo de propinas 0');

        // Duplicados.
        const duplicates = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          [f.worker.id, f.worker.id],
        ).expect(400);
        expect(messagesOf(duplicates.body)).toContain(f.worker.id);

        // UUID inválido (rechazo del pipe).
        const invalidUuid = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
        )
          .field('participantIds', 'no-es-uuid')
          .expect(400);
        expect(messagesOf(invalidUuid.body)).toContain('participantIds');

        // No elegibles: otro local, inactivo y roles globales
        // (ADMINISTRADOR, CONTADOR); el supervisor de otro local y el
        // supervisor inactivo también (SPRINT-4A-T01).
        const inactiveSupervisor = await createUser(
          f.tx,
          ROLE.SUPERVISOR,
          f.storeId,
          { active: false },
        );
        for (const ineligible of [
          f.otherWorker,
          f.inactiveWorker,
          f.admin,
          f.accountant,
          f.otherSupervisor,
          inactiveSupervisor,
        ]) {
          const response = await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            [ineligible.id],
          ).expect(400);
          expect(messagesOf(response.body)).toContain(ineligible.id);
        }

        // UUID bien formado pero inexistente.
        const unknown = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          [MISSING_ID],
        ).expect(400);
        expect(messagesOf(unknown.body)).toContain(MISSING_ID);

        const count = await f.tx.dailyOperation.count({
          where: { storeId: f.storeId },
        });
        expect(count).toBe(0);
      });
    });

    it('consulta por local/fecha: arreglo de 0 o 1 operaciones con participantes', async () => {
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
            [f.worker.id],
          ).expect(201)
        ).body as DailyOperationResponse;
        expect(created.voucher).toBeNull();
        // La selección informada se guarda aunque no haya propina de tarjeta.
        expect(created.participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
        ]);

        const found = await list(
          f,
          f.storeId,
          BUSINESS_DATE,
          f.supervisor,
        ).expect(200);
        const operations = found.body as DailyOperationResponse[];
        expect(operations.map((op) => op.id)).toEqual([created.id]);
        expect(operations[0].participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
        ]);

        const detail = await getOne(created.id, f.supervisor).expect(200);
        expect((detail.body as DailyOperationResponse).participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
        ]);

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
        await postMultipart(
          baseFields(f),
          null,
          f.supervisor,
          defaultParticipants(f),
        ).expect(400);
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
          defaultParticipants(f),
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
          defaultParticipants(f),
        ).expect(415);

        // Contenido JPEG declarado como PNG: el tipo declarado no coincide.
        const declared = await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.png' },
          f.supervisor,
          defaultParticipants(f),
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
          defaultParticipants(f),
        ).expect(413);
      });
    });

    it('valida campos del formulario y rechazados por el pipe', async () => {
      await withinRollback(async (f) => {
        await postMultipart(
          baseFields(f, { businessDate: '2026-02-30' }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          defaultParticipants(f),
        ).expect(400);
        await postMultipart(
          baseFields(f, { cardTipAmount: -1 }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          defaultParticipants(f),
        ).expect(400);
        await postMultipart(
          baseFields(f, { cashTipAmount: 12.5 as unknown as number }),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          defaultParticipants(f),
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
          defaultParticipants(f),
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
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;

        const detail = await getOne(created.id, f.supervisor).expect(200);
        expect((detail.body as DailyOperationResponse).participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
          { id: f.worker2.id, name: 'Beto Participa' },
        ]);
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
            defaultParticipants(f),
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
            [f.worker.id],
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
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;
        const row = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(row.cashDifference).toBe(BigInt(2500));
        expect(row.tipFundAmount).toBe(row.cardTipAmount + row.cashTipAmount);
      });
    });

    it('corrige montos y selección conservando el voucher y al responsable original', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;

        const response = await patchMultipart(
          created.id,
          {
            cashTipAmount: 5000,
            cashDifference: 0,
            participantIds: [f.worker2.id],
          },
          null,
          f.supervisor,
        ).expect(200);
        const body = response.body as DailyOperationResponse;

        expect(body).toMatchObject({
          id: created.id,
          cardTipAmount: 31602,
          cashTipAmount: 5000,
          tipFundAmount: 36602,
          cashDifference: 0,
          differenceReason: null,
          responsible: { id: f.supervisor.id },
        });
        // La selección se reemplaza completa...
        expect(body.participants).toEqual([
          { id: f.worker2.id, name: 'Beto Participa' },
        ]);
        // ...y el voucher registrado se conserva (mismo hash, mismo archivo).
        expect(body.voucher?.sha256Hash).toBe(created.voucher?.sha256Hash);
        expect(body.voucher?.fileName).toBe('voucher.jpg');

        const row = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(row.cashTipAmount).toBe(BigInt(5000));
        expect(row.tipFundAmount).toBe(row.cardTipAmount + row.cashTipAmount);
        expect(row.responsibleId).toBe(f.supervisor.id);
        const participants = await f.tx.dailyOperationParticipant.findMany({
          where: { operationId: created.id },
        });
        expect(participants.map((p) => p.workerId)).toEqual([f.worker2.id]);
        const voucherRow = await f.tx.dailyOperationVoucher.findFirstOrThrow({
          where: { operation: { storeId: f.storeId } },
        });
        expect(voucherRow.sha256Hash).toBe(created.voucher?.sha256Hash);

        // El actor queda en auditoría con lista blanca (montos resultantes y
        // selección enviada; jamás datos personales).
        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_UPDATED,
            entityId: created.id,
          },
        });
        expect(audit.userId).toBe(f.supervisor.id);
        expect(audit.storeId).toBe(f.storeId);
        expect(audit.detail).toMatchObject({
          participantIds: [f.worker2.id],
          cashTipAmount: 5000,
          tipFundAmount: 36602,
          cashDifference: 0,
          differenceReason: null,
          voucherSha256: created.voucher?.sha256Hash,
        });
        expect(JSON.stringify(audit.detail)).not.toContain(f.worker2.email);
      });
    });

    it('el ADMINISTRADOR corrige dentro de su alcance global y el supervisor solo su local', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;

        // Admin global: puede corregir; el actor queda distinto del
        // responsable original.
        const byAdmin = await patchMultipart(
          created.id,
          { cashTipAmount: 6000 },
          null,
          f.admin,
        ).expect(200);
        expect((byAdmin.body as DailyOperationResponse).cashTipAmount).toBe(
          6000,
        );
        const audit = await f.tx.auditLog.findFirstOrThrow({
          where: {
            action: AUDIT_ACTION.DAILY_OPERATION_UPDATED,
            entityId: created.id,
            userId: f.admin.id,
          },
        });
        expect(audit.userId).toBe(f.admin.id);

        // Rol de lectura, anónimos y otro local no corrigen.
        await patchMultipart(
          created.id,
          { cashTipAmount: 1 },
          null,
          f.worker,
        ).expect(403);
        await patchMultipart(
          created.id,
          { cashTipAmount: 1 },
          null,
          null,
        ).expect(401);
        await patchMultipart(
          created.id,
          { cashTipAmount: 1 },
          null,
          f.otherSupervisor,
        ).expect(403);
      });
    });

    it('reemplaza el voucher y retira el archivo anterior', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;
        const oldFile = await f.tx.dailyOperationVoucher.findFirstOrThrow({
          where: { operation: { storeId: f.storeId } },
        });
        const filesBefore = await storedFiles();

        const response = await patchMultipart(
          created.id,
          {},
          { buffer: JPEG_OTHER, filename: 'voucher-corregido.jpg' },
          f.supervisor,
        ).expect(200);
        const body = response.body as DailyOperationResponse;

        expect(body.voucher?.fileName).toBe('voucher-corregido.jpg');
        expect(body.voucher?.sha256Hash).toMatch(/^[0-9a-f]{64}$/);
        expect(body.voucher?.sha256Hash).not.toBe(created.voucher?.sha256Hash);
        // La selección no se envió: se conserva intacta.
        expect(body.participants).toEqual(created.participants);

        // El archivo y la fila anteriores desaparecen; el nuevo queda.
        const newRow = await f.tx.dailyOperationVoucher.findFirstOrThrow({
          where: { operation: { storeId: f.storeId } },
        });
        expect(newRow.id).not.toBe(oldFile.id);
        expect(newRow.sha256Hash).toBe(body.voucher?.sha256Hash);
        const filesAfter = await storedFiles();
        expect(filesAfter).toHaveLength(filesBefore.length);
        expect(filesAfter).not.toContain(
          path.join(voucherRoot, oldFile.filePath),
        );
      });
    });

    it('retira voucher y selección cuando la tarjeta y el fondo quedan en 0', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;
        const oldFile = await f.tx.dailyOperationVoucher.findFirstOrThrow({
          where: { operation: { storeId: f.storeId } },
        });
        const filesBefore = await storedFiles();

        const response = await patchMultipart(
          created.id,
          { cardTipAmount: 0, cashTipAmount: 0 },
          null,
          f.supervisor,
        ).expect(200);
        const body = response.body as DailyOperationResponse;

        expect(body).toMatchObject({
          cardTipAmount: 0,
          cashTipAmount: 0,
          tipFundAmount: 0,
          voucher: null,
        });
        // Sin fondo no hay selección: queda vacía de forma consistente.
        expect(body.participants).toEqual([]);

        const row = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(row.voucherId).toBeNull();
        expect(
          await f.tx.dailyOperationVoucher.count({
            where: { operation: { storeId: f.storeId } },
          }),
        ).toBe(0);
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: created.id },
          }),
        ).toBe(0);
        // El archivo retirado se elimina del volumen.
        const filesAfter = await storedFiles();
        expect(filesAfter).toHaveLength(filesBefore.length - 1);
        expect(filesAfter).not.toContain(
          path.join(voucherRoot, oldFile.filePath),
        );

        // Y la descarga del voucher responde 404: ya no hay propina de tarjeta.
        await getVoucher(created.id, f.supervisor).expect(404);
      });
    });

    it('corrige la selección sin tocar el voucher ni duplicar participantes', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            [f.worker.id],
          ).expect(201)
        ).body as DailyOperationResponse;

        // Reenviar la misma selección no duplica filas ni archivos.
        const same = await patchMultipart(
          created.id,
          { participantIds: [f.worker.id, f.worker2.id] },
          null,
          f.supervisor,
        ).expect(200);
        expect((same.body as DailyOperationResponse).participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
          { id: f.worker2.id, name: 'Beto Participa' },
        ]);
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: created.id },
          }),
        ).toBe(2);

        // Volver a enviar solo a Ana reemplaza la selección completa.
        const reduced = await patchMultipart(
          created.id,
          { participantIds: [f.worker.id] },
          null,
          f.supervisor,
        ).expect(200);
        expect((reduced.body as DailyOperationResponse).participants).toEqual([
          { id: f.worker.id, name: 'Ana Participa' },
        ]);
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: created.id },
          }),
        ).toBe(1);
      });
    });

    it('PATCH valida reglas del resultado y errores claros', async () => {
      await withinRollback(async (f) => {
        const created = (
          await postMultipart(
            baseFields(f),
            { buffer: JPEG, filename: 'voucher.jpg' },
            f.supervisor,
            defaultParticipants(f),
          ).expect(201)
        ).body as DailyOperationResponse;

        // Solicitud vacía.
        await patchMultipart(created.id, {}, null, f.supervisor).expect(400);

        // Voucher de reemplazo con tarjeta resultante 0.
        await patchMultipart(
          created.id,
          { cardTipAmount: 0 },
          { buffer: JPEG_OTHER, filename: 'voucher.jpg' },
          f.supervisor,
        ).expect(400);

        // Selección vacía con fondo mayor que 0: multipart no distingue
        // "cero repeticiones" de "campo ausente" (ambos conservan), así que
        // el vacío explícito llega como valor vacío y lo rechaza el pipe.
        const emptySelection = await patchMultipart(
          created.id,
          {},
          null,
          f.supervisor,
        )
          .field('participantIds', '')
          .expect(400);
        expect(messagesOf(emptySelection.body)).toContain('participantIds');

        // Selección informada con fondo 0.
        const withFundZero = await patchMultipart(
          created.id,
          { cardTipAmount: 0, cashTipAmount: 0, participantIds: [f.worker.id] },
          null,
          f.supervisor,
        ).expect(400);
        expect(messagesOf(withFundZero.body)).toContain('fondo de propinas 0');

        // Duplicados y no elegibles.
        const duplicates = await patchMultipart(
          created.id,
          { participantIds: [f.worker.id, f.worker.id] },
          null,
          f.supervisor,
        ).expect(400);
        expect(messagesOf(duplicates.body)).toContain(f.worker.id);

        const ineligible = await patchMultipart(
          created.id,
          { participantIds: [f.otherWorker.id] },
          null,
          f.supervisor,
        ).expect(400);
        expect(messagesOf(ineligible.body)).toContain(f.otherWorker.id);

        const invalidUuid = await patchMultipart(
          created.id,
          {},
          null,
          f.supervisor,
        )
          .field('participantIds', 'no-es-uuid')
          .expect(400);
        expect(messagesOf(invalidUuid.body)).toContain('participantIds');

        // Diferencia resultante distinta de cero sin motivo: la operación
        // base cuadra (diferencia 0, sin motivo registrado).
        const squared = (
          await postMultipart(
            baseFields(f, {
              businessDate: '2026-03-11',
              cardTipAmount: 0,
              cashDifference: 0,
              differenceReason: undefined,
            }),
            null,
            f.supervisor,
            [f.worker.id],
          ).expect(201)
        ).body as DailyOperationResponse;
        expect(squared.differenceReason).toBeNull();
        const noReason = await patchMultipart(
          squared.id,
          { cashDifference: -500 },
          null,
          f.supervisor,
        ).expect(400);
        expect(messagesOf(noReason.body)).toContain('differenceReason');

        // UUID de ruta inválido y operación inexistente.
        await patchMultipart(
          'no-es-uuid',
          { cashTipAmount: 1 },
          null,
          f.supervisor,
        ).expect(400);
        await patchMultipart(
          MISSING_ID,
          { cashTipAmount: 1 },
          null,
          f.supervisor,
        ).expect(404);

        // Nada se corrompió: la operación sigue como se creó.
        const row = await f.tx.dailyOperation.findUniqueOrThrow({
          where: { id: created.id },
        });
        expect(row.cashTipAmount).toBe(BigInt(4500));
        expect(
          await f.tx.dailyOperationParticipant.count({
            where: { operationId: created.id },
          }),
        ).toBe(2);
      });
    });

    // Un rechazo de trigger aborta la transacción del withinRollback, así
    // que cada escenario va en su propio rollback y el PATCH rechazado es la
    // última sentencia (mismo patrón que los specs de modelo T02).
    async function crearOperacionConRepartoConfirmado(
      f: Fixture,
    ): Promise<DailyOperationResponse> {
      const created = (
        await postMultipart(
          baseFields(f),
          { buffer: JPEG, filename: 'voucher.jpg' },
          f.supervisor,
          defaultParticipants(f),
        ).expect(201)
      ).body as DailyOperationResponse;

      // El fondo de la operación alimenta un reparto CONFIRMED.
      const pool = await f.tx.tipPool.create({
        data: {
          storeId: f.storeId,
          periodStart: new Date(`${BUSINESS_DATE}T00:00:00.000Z`),
          periodEnd: new Date(`${BUSINESS_DATE}T00:00:00.000Z`),
          totalAmount: new Prisma.Decimal(36102),
          calculatedById: f.supervisor.id,
        },
      });
      await f.tx.tipPoolDailyOperationSource.create({
        data: {
          poolId: pool.id,
          operationId: created.id,
          amount: BigInt(36102),
        },
      });
      await f.tx.tipPool.update({
        where: { id: pool.id },
        data: {
          status: 'CONFIRMED',
          confirmedById: f.accountant.id,
          confirmedAt: new Date('2026-03-11T12:00:00.000Z'),
        },
      });
      return created;
    }

    it('los triggers T02 bloquean corregir montos con reparto CONFIRMED (409 claro)', async () => {
      await withinRollback(async (f) => {
        const created = await crearOperacionConRepartoConfirmado(f);

        // La base rechaza el UPDATE de montos y la API mapea el mensaje del
        // trigger a 409 claro (rechazo: última sentencia del rollback).
        const amounts = await patchMultipart(
          created.id,
          { cashTipAmount: 999 },
          null,
          f.supervisor,
        ).expect(409);
        expect(messagesOf(amounts.body)).toContain(
          'reparto confirmado o pagado',
        );
      });
    });

    it('los triggers T02 bloquean corregir la selección con reparto CONFIRMED (409 claro)', async () => {
      await withinRollback(async (f) => {
        const created = await crearOperacionConRepartoConfirmado(f);

        // La base rechaza el reemplazo de participantes y la API mapea el
        // mensaje del trigger a 409 claro (rechazo: última sentencia).
        const selection = await patchMultipart(
          created.id,
          { participantIds: [f.worker.id] },
          null,
          f.supervisor,
        ).expect(409);
        expect(messagesOf(selection.body)).toContain(
          'reparto confirmado o pagado',
        );
      });
    });
  },
);
