import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PaymentMethod, PrismaClient } from '../src/generated/prisma/client.js';
import type { TipEntryResponse } from '../src/tips/types/tips.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

interface ErrorResponse {
  message: string | string[];
}

// Tests de integración HTTP del registro diario de propinas (SPRINT-3-T10)
// contra PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual
// que los demás tests HTTP, los datos van por la API con un local propio
// ("Subway Tips API Test") y correos @tips-api-test.invalid, y se eliminan al
// finalizar junto con su auditoría; las relaciones de venta y reparto se crean
// directo con Prisma respetando fecha, medio y local del registro.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@tips-api-test.invalid';
const STORE_NAME = 'Subway Tips API Test';
const OTHER_STORE_NAME = 'Subway Tips API Test Otro';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const FORBIDDEN_DETAIL_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'rut',
  'passwordHash',
  'password',
];
const AUDIT_DETAIL_KEYS = [
  'amount',
  'businessDate',
  'paymentMethod',
  'responsibleId',
  'storeId',
];

function messagesOf(body: unknown): string[] {
  const message = (body as ErrorResponse).message;
  return Array.isArray(message) ? message : [message];
}

describe.skipIf(!databaseUrl)(
  'API de registro diario de propinas (SPRINT-3-T10)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storeId: string;
    let otherStoreId: string;
    const ids: Record<string, string> = {};
    const tokens: Record<string, string> = {};

    function tokenFor(
      sub: string,
      role: RoleCode,
      tokenStoreId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId: tokenStoreId,
      };
      return jwt.signAsync(payload);
    }

    async function cleanup(): Promise<void> {
      // Las ventas, repartos y sus fuentes se purgan como mantenimiento con
      // session_replication_role = replica (superusuario de TEST_DATABASE_URL).
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const storeWhere = { name: { startsWith: STORE_NAME } };
        await tx.sale.deleteMany({ where: { store: storeWhere } });
        await tx.tipPoolSource.deleteMany({
          where: { tipEntry: { store: storeWhere } },
        });
        await tx.tipPoolLine.deleteMany({
          where: { pool: { store: storeWhere } },
        });
        await tx.tipPool.deleteMany({ where: { store: storeWhere } });
        await tx.tipAgreement.deleteMany({ where: { store: storeWhere } });
        await tx.workHoursRecord.deleteMany({ where: { store: storeWhere } });
        await tx.tipEntry.deleteMany({ where: { store: storeWhere } });
      });
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_NAME } } },
        ],
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_NAME } },
      });
    }

    async function createUser(
      name: string,
      roleCode: RoleCode,
      userStoreId: string | null,
    ): Promise<void> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'Tips',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      ids[name] = user.id;
      tokens[name] = await tokenFor(user.id, roleCode, userStoreId);
    }

    function tipPayload(overrides: Record<string, unknown> = {}): object {
      return {
        storeId,
        businessDate: '2026-10-20',
        paymentMethod: 'DEBIT_CARD',
        amount: 12500,
        ...overrides,
      };
    }

    function createTip(body: object, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .post('/tips')
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function listTips(query: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .get(`/tips${query}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function getTip(id: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .get(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    function patchTip(id: string, body: object, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .patch(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function deleteTip(id: string, token = tokens.supervisor) {
      return request(app.getHttpServer())
        .delete(`/tips/${id}`)
        .set('Authorization', `Bearer ${token}`);
    }

    async function entryCount(
      businessDate: string,
      paymentMethod: PaymentMethod,
    ): Promise<number> {
      return prisma.tipEntry.count({
        where: {
          storeId,
          businessDate: new Date(`${businessDate}T00:00:00.000Z`),
          paymentMethod,
        },
      });
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      // Mismo pipe de validación que main.ts.
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
      await cleanup();

      // Roles por si la BD no está sembrada.
      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }

      const store = await prisma.store.create({
        data: { name: STORE_NAME, city: 'Melipilla', address: 'Calle 123' },
      });
      storeId = store.id;
      const otherStore = await prisma.store.create({
        data: {
          name: OTHER_STORE_NAME,
          city: 'Calera',
          address: 'Otra calle 456',
        },
      });
      otherStoreId = otherStore.id;

      await createUser('supervisor', ROLE.SUPERVISOR, store.id);
      await createUser('supervisor2', ROLE.SUPERVISOR, store.id);
      await createUser('worker', ROLE.TRABAJADOR, store.id);
      await createUser('accountant', ROLE.CONTADOR, null);
      await createUser('admin', ROLE.ADMINISTRADOR, null);
      await createUser('otherSupervisor', ROLE.SUPERVISOR, otherStore.id);
      await createUser('storelessSupervisor', ROLE.SUPERVISOR, null);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
    });

    it('ejecuta el CRUD completo como supervisor con el responsable del JWT', async () => {
      const created = (
        await createTip(tipPayload({ businessDate: '2026-10-20' })).expect(201)
      ).body as TipEntryResponse;
      expect(created).toMatchObject({
        businessDate: '2026-10-20',
        paymentMethod: 'DEBIT_CARD',
        amount: 12500,
      });
      expect(typeof created.amount).toBe('number');
      expect(created.store).toEqual({ id: storeId, name: STORE_NAME });
      // El responsable se toma del JWT, no del cuerpo.
      expect(created.responsible).toEqual({
        id: ids.supervisor,
        name: 'supervisor Tips',
      });
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();

      // Segundo medio el mismo día: el listado queda ordenado por medio.
      await createTip(
        tipPayload({ businessDate: '2026-10-20', paymentMethod: 'CASH' }),
      ).expect(201);
      const list = (
        await listTips(`?storeId=${storeId}&businessDate=2026-10-20`).expect(
          200,
        )
      ).body as TipEntryResponse[];
      expect(list.map((entry) => entry.paymentMethod)).toEqual([
        'CASH',
        'DEBIT_CARD',
      ]);
      expect(
        list.some(
          (entry) =>
            entry.id === created.id &&
            entry.store.id === storeId &&
            entry.responsible.id === ids.supervisor,
        ),
      ).toBe(true);

      const found = (await getTip(created.id).expect(200))
        .body as TipEntryResponse;
      expect(found).toMatchObject({ id: created.id, amount: 12500 });

      const patched = (await patchTip(created.id, { amount: 999 }).expect(200))
        .body as TipEntryResponse;
      expect(patched).toMatchObject({
        id: created.id,
        amount: 999,
        businessDate: '2026-10-20',
        paymentMethod: 'DEBIT_CARD',
        store: { id: storeId },
        responsible: { id: ids.supervisor },
      });

      await deleteTip(created.id).expect(204);
      const missing = await getTip(created.id).expect(404);
      expect(messagesOf(missing.body).join(' ')).toContain(
        'Registro de propinas no encontrado',
      );
      await patchTip(created.id, { amount: 1 }).expect(404);
      await deleteTip(created.id).expect(404);
    });

    it('trata el reintento idéntico como idempotente y serializa la concurrencia', async () => {
      const payload = tipPayload({
        businessDate: '2026-10-21',
        paymentMethod: 'TRANSFER',
        amount: 7000,
      });
      const first = (await createTip(payload).expect(201))
        .body as TipEntryResponse;
      const retry = (await createTip(payload).expect(200))
        .body as TipEntryResponse;
      expect(retry.id).toBe(first.id);
      expect(retry.amount).toBe(7000);
      expect(await entryCount('2026-10-21', 'TRANSFER')).toBe(1);
      const retryAudits = await prisma.auditLog.count({
        where: { entityType: 'tip_entries', entityId: first.id },
      });
      expect(retryAudits).toBe(1);

      // Dos POST concurrentes de la misma clave nueva: una fila y una
      // auditoría; uno crea (201) y el otro recibe el existente (200).
      const concurrentPayload = tipPayload({
        businessDate: '2026-10-22',
        paymentMethod: 'CASH',
        amount: 4500,
      });
      const [left, right] = await Promise.all([
        createTip(concurrentPayload),
        createTip(concurrentPayload),
      ]);
      expect([left.status, right.status].sort((a, b) => a - b)).toEqual([
        200, 201,
      ]);
      const leftBody = left.body as TipEntryResponse;
      const rightBody = right.body as TipEntryResponse;
      expect(leftBody.id).toBe(rightBody.id);
      expect(await entryCount('2026-10-22', 'CASH')).toBe(1);
      const concurrentAudits = await prisma.auditLog.count({
        where: { entityType: 'tip_entries', entityId: leftBody.id },
      });
      expect(concurrentAudits).toBe(1);

      // Misma clave con otro monto: conflicto que sugiere usar PATCH.
      const otherAmount = await createTip({
        ...payload,
        amount: 8000,
      }).expect(409);
      expect(messagesOf(otherAmount.body).join(' ')).toContain(
        'Ya existe un registro para ese local, fecha y medio',
      );

      // Misma clave y monto pero otro responsable: también conflicto.
      const otherResponsible = await createTip(
        payload,
        tokens.supervisor2,
      ).expect(409);
      expect(messagesOf(otherResponsible.body).join(' ')).toContain(
        'Ya existe un registro para ese local, fecha y medio',
      );
      expect(await entryCount('2026-10-21', 'TRANSFER')).toBe(1);
    });

    it('valida campos, formatos y contenedores de la solicitud con 400', async () => {
      // Cuerpo vacío: el guard de local exige el identificador.
      const emptyBody = await createTip({}).expect(400);
      expect(messagesOf(emptyBody.body).join(' ')).toContain('storeId');

      // Monto negativo.
      const negative = await createTip(tipPayload({ amount: -1 })).expect(400);
      expect(messagesOf(negative.body).join(' ')).toContain(
        'amount no puede ser negativo',
      );

      // CLP no admite centavos, incluso si son solo dos cifras decimales.
      const decimals = await createTip(tipPayload({ amount: 12.5 })).expect(
        400,
      );
      expect(messagesOf(decimals.body).join(' ')).toContain(
        'amount debe ser un número entero en CLP',
      );

      // Fecha inexistente y formato incorrecto.
      for (const businessDate of ['2026-02-30', '26/10/2026']) {
        const invalidDate = await createTip(
          tipPayload({ businessDate }),
        ).expect(400);
        expect(messagesOf(invalidDate.body).join(' ')).toContain(
          'businessDate',
        );
      }

      // Local inválido: el guard de local se ejecuta antes del ValidationPipe,
      // así que solo un rol global llega a la validación del UUID (400); un
      // supervisor recibe 403 porque evalúa el acceso con el cuerpo sin validar.
      const invalidStore = await createTip(
        tipPayload({ storeId: 'no-uuid' }),
        tokens.admin,
      ).expect(400);
      expect(messagesOf(invalidStore.body).join(' ')).toContain(
        'storeId debe ser un UUID válido',
      );
      await createTip(tipPayload({ storeId: 'no-uuid' })).expect(403);
      const invalidQueryStore = await listTips(
        '?storeId=no-uuid&businessDate=2026-10-20',
        tokens.accountant,
      ).expect(400);
      expect(messagesOf(invalidQueryStore.body).join(' ')).toContain(
        'storeId debe ser un UUID válido',
      );
      const invalidMethod = await createTip(
        tipPayload({ paymentMethod: 'BILLETERA' }),
      ).expect(400);
      expect(messagesOf(invalidMethod.body).join(' ')).toContain(
        'paymentMethod debe ser uno de',
      );

      // Campos no permitidos, incluido el responsable que manda el JWT.
      for (const extra of [
        { campoExtra: true },
        { responsibleId: ids.admin },
      ]) {
        const rejected = await createTip(tipPayload(extra)).expect(400);
        const field = 'campoExtra' in extra ? 'campoExtra' : 'responsibleId';
        expect(messagesOf(rejected.body).join(' ')).toContain(field);
      }

      // El monto cero sí es válido.
      const zero = (
        await createTip(
          tipPayload({ businessDate: '2026-10-24', amount: 0 }),
        ).expect(201)
      ).body as TipEntryResponse;
      expect(zero.amount).toBe(0);

      // PATCH vacío o sin cambios de negocio.
      const patchable = (
        await createTip(
          tipPayload({ businessDate: '2026-10-25', paymentMethod: 'CASH' }),
        ).expect(201)
      ).body as TipEntryResponse;
      const emptyPatch = await patchTip(patchable.id, {}).expect(400);
      expect(messagesOf(emptyPatch.body).join(' ')).toContain('amount');
      await patchTip(patchable.id, { amount: -2 }).expect(400);
      await patchTip(patchable.id, { amount: 0.001 }).expect(400);
      const patchExtra = await patchTip(patchable.id, {
        amount: 10,
        campoExtra: true,
      }).expect(400);
      expect(messagesOf(patchExtra.body).join(' ')).toContain('campoExtra');

      // Query incompleta.
      const missingDate = await listTips(`?storeId=${storeId}`).expect(400);
      expect(messagesOf(missingDate.body).join(' ')).toContain('businessDate');
      const missingStore = await listTips('?businessDate=2026-10-20').expect(
        400,
      );
      expect(messagesOf(missingStore.body).join(' ')).toContain('storeId');

      // ID que no es UUID en las tres rutas con parámetro.
      await getTip('no-es-uuid').expect(400);
      await patchTip('no-es-uuid', { amount: 1 }).expect(400);
      await deleteTip('no-es-uuid').expect(400);
    });

    it('restringe mutaciones y locales según el rol del JWT', async () => {
      const entry = (
        await createTip(
          tipPayload({ businessDate: '2026-10-26', paymentMethod: 'TRANSFER' }),
        ).expect(201)
      ).body as TipEntryResponse;

      // Trabajador: sin mutaciones ni consultas de propinas.
      await createTip(
        tipPayload({ businessDate: '2026-10-27' }),
        tokens.worker,
      ).expect(403);
      await patchTip(entry.id, { amount: 1 }, tokens.worker).expect(403);
      await deleteTip(entry.id, tokens.worker).expect(403);
      await getTip(entry.id, tokens.worker).expect(403);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-26`,
        tokens.worker,
      ).expect(403);

      // Contador: solo lectura, en cualquier local.
      await getTip(entry.id, tokens.accountant).expect(200);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-26`,
        tokens.accountant,
      ).expect(200);
      await createTip(
        tipPayload({ businessDate: '2026-10-27' }),
        tokens.accountant,
      ).expect(403);
      await patchTip(entry.id, { amount: 1 }, tokens.accountant).expect(403);
      await deleteTip(entry.id, tokens.accountant).expect(403);

      // Supervisor de otro local: 403 en cuerpo, query y por ID.
      const scopedAttempts: Array<[string, () => request.Test]> = [
        [
          'body',
          () =>
            createTip(
              tipPayload({ businessDate: '2026-10-27' }),
              tokens.otherSupervisor,
            ),
        ],
        [
          'query',
          () =>
            listTips(
              `?storeId=${storeId}&businessDate=2026-10-26`,
              tokens.otherSupervisor,
            ),
        ],
        ['id-lectura', () => getTip(entry.id, tokens.otherSupervisor)],
        [
          'id-edicion',
          () => patchTip(entry.id, { amount: 1 }, tokens.otherSupervisor),
        ],
        ['id-eliminacion', () => deleteTip(entry.id, tokens.otherSupervisor)],
      ];
      for (const [label, attempt] of scopedAttempts) {
        const response = await attempt().expect(403);
        expect(
          messagesOf(response.body).join(' '),
          `escenario ${label}`,
        ).toContain('No tienes acceso a este local');
      }

      // Supervisor sin local asignado: tampoco accede.
      await createTip(
        tipPayload({ businessDate: '2026-10-27' }),
        tokens.storelessSupervisor,
      ).expect(403);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-26`,
        tokens.storelessSupervisor,
      ).expect(403);
      await getTip(entry.id, tokens.storelessSupervisor).expect(403);
      await patchTip(
        entry.id,
        { amount: 1 },
        tokens.storelessSupervisor,
      ).expect(403);
      await deleteTip(entry.id, tokens.storelessSupervisor).expect(403);

      // Administrador global: opera en cualquier local.
      const asAdmin = (
        await createTip(
          tipPayload({ businessDate: '2026-10-26', paymentMethod: 'CASH' }),
          tokens.admin,
        ).expect(201)
      ).body as TipEntryResponse;
      expect(asAdmin.responsible.id).toBe(ids.admin);
      await listTips(
        `?storeId=${storeId}&businessDate=2026-10-26`,
        tokens.admin,
      ).expect(200);
      await getTip(asAdmin.id, tokens.admin).expect(200);
      await patchTip(asAdmin.id, { amount: 321 }, tokens.admin).expect(200);
      await deleteTip(asAdmin.id, tokens.admin).expect(204);

      // ...y también en el segundo local.
      const otherEntry = (
        await createTip(
          {
            storeId: otherStoreId,
            businessDate: '2026-10-26',
            paymentMethod: 'CASH',
            amount: 500,
          },
          tokens.admin,
        ).expect(201)
      ).body as TipEntryResponse;
      expect(otherEntry.store.id).toBe(otherStoreId);
      await deleteTip(otherEntry.id, tokens.admin).expect(204);
    });

    it('responde 404 en registros inexistentes y 409 en registros vinculados', async () => {
      const missingAttempts: Array<[string, () => request.Test]> = [
        ['lectura', () => getTip(MISSING_ID)],
        ['edición', () => patchTip(MISSING_ID, { amount: 10 })],
        ['eliminación', () => deleteTip(MISSING_ID)],
      ];
      for (const [label, attempt] of missingAttempts) {
        const response = await attempt().expect(404);
        expect(
          messagesOf(response.body).join(' '),
          `escenario ${label}`,
        ).toContain('Registro de propinas no encontrado');
      }

      // Vinculado a una venta: bloquea PATCH y DELETE con 409.
      const saleLinked = (
        await createTip(
          tipPayload({ businessDate: '2026-10-28', paymentMethod: 'CASH' }),
        ).expect(201)
      ).body as TipEntryResponse;
      await prisma.sale.create({
        data: {
          soldAt: new Date('2026-10-28T12:00:00.000Z'),
          paymentMethod: PaymentMethod.CASH,
          grossAmount: 50000,
          tipAmount: 3000,
          storeId,
          registeredById: ids.supervisor,
          tipEntryId: saleLinked.id,
        },
      });
      const saleLinkedAttempts: Array<[string, () => request.Test]> = [
        ['patch', () => patchTip(saleLinked.id, { amount: 4000 })],
        ['delete', () => deleteTip(saleLinked.id)],
      ];
      for (const [label, attempt] of saleLinkedAttempts) {
        const response = await attempt().expect(409);
        expect(
          messagesOf(response.body).join(' '),
          `vinculado a venta: ${label}`,
        ).toContain('vinculado a ventas o repartos');
      }
      await getTip(saleLinked.id).expect(200);

      // Vinculado a un reparto (TipPoolSource): también bloquea con 409.
      const poolLinked = (
        await createTip(
          tipPayload({
            businessDate: '2026-10-28',
            paymentMethod: 'TRANSFER',
          }),
        ).expect(201)
      ).body as TipEntryResponse;
      const pool = await prisma.tipPool.create({
        data: {
          periodStart: new Date('2026-10-26T00:00:00.000Z'),
          periodEnd: new Date('2026-11-01T00:00:00.000Z'),
          totalAmount: 12500,
          storeId,
          calculatedById: ids.supervisor,
        },
      });
      await prisma.tipPoolSource.create({
        data: { poolId: pool.id, tipEntryId: poolLinked.id, amount: 12500 },
      });
      const poolLinkedAttempts: Array<[string, () => request.Test]> = [
        ['patch', () => patchTip(poolLinked.id, { amount: 4000 })],
        ['delete', () => deleteTip(poolLinked.id)],
      ];
      for (const [label, attempt] of poolLinkedAttempts) {
        const response = await attempt().expect(409);
        expect(
          messagesOf(response.body).join(' '),
          `vinculado a reparto: ${label}`,
        ).toContain('vinculado a ventas o repartos');
      }
      await getTip(poolLinked.id).expect(200);
    });

    it('rechaza mutaciones en local inactivo pero mantiene la lectura histórica', async () => {
      const entry = (
        await createTip(
          tipPayload({ businessDate: '2026-11-02', paymentMethod: 'CASH' }),
        ).expect(201)
      ).body as TipEntryResponse;
      await prisma.store.update({
        where: { id: storeId },
        data: { isActive: false },
      });

      try {
        const patched = await patchTip(entry.id, { amount: 13000 }).expect(400);
        expect(messagesOf(patched.body).join(' ')).toContain('inactivo');
        const removed = await deleteTip(entry.id).expect(400);
        expect(messagesOf(removed.body).join(' ')).toContain('inactivo');

        await getTip(entry.id).expect(200);
        await listTips(`?storeId=${storeId}&businessDate=2026-11-02`).expect(
          200,
        );
      } finally {
        await prisma.store.update({
          where: { id: storeId },
          data: { isActive: true },
        });
      }
    });

    it('audita crear, editar y eliminar con listas blancas y actor correcto', async () => {
      const businessDate = '2026-10-29';
      const created = (
        await createTip(
          tipPayload({ businessDate, paymentMethod: 'CREDIT_CARD' }),
        ).expect(201)
      ).body as TipEntryResponse;

      // Reintento idéntico: no agrega evento.
      await createTip(
        tipPayload({ businessDate, paymentMethod: 'CREDIT_CARD' }),
      ).expect(200);
      const afterRetry = await prisma.auditLog.findMany({
        where: { entityType: 'tip_entries', entityId: created.id },
        orderBy: { id: 'asc' },
      });
      expect(afterRetry.map((log) => log.action)).toEqual([
        AUDIT_ACTION.TIP_ENTRY_CREATED,
      ]);

      await patchTip(created.id, { amount: 777 }).expect(200);
      await deleteTip(created.id).expect(204);

      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'tip_entries', entityId: created.id },
        orderBy: { id: 'asc' },
      });
      expect(logs.map((log) => log.action)).toEqual([
        AUDIT_ACTION.TIP_ENTRY_CREATED,
        AUDIT_ACTION.TIP_ENTRY_UPDATED,
        AUDIT_ACTION.TIP_ENTRY_DELETED,
      ]);

      const expectedDetail = {
        storeId,
        responsibleId: ids.supervisor,
        businessDate,
        paymentMethod: 'CREDIT_CARD',
      };
      for (const [index, log] of logs.entries()) {
        expect(log.storeId).toBe(storeId);
        expect(log.userId).toBe(ids.supervisor);
        expect(log.entityType).toBe('tip_entries');
        expect(log.entityId).toBe(created.id);
        // Detalle con lista blanca: sin datos personales ni credenciales.
        expect(log.detail).not.toBeNull();
        const detail = log.detail as Record<string, unknown>;
        expect(Object.keys(detail).sort()).toEqual(
          [...AUDIT_DETAIL_KEYS].sort(),
        );
        const serialized = JSON.stringify(detail);
        for (const forbidden of FORBIDDEN_DETAIL_FIELDS) {
          expect(serialized, `detalle del evento ${index}`).not.toContain(
            forbidden,
          );
        }
      }
      expect(logs[0].detail).toMatchObject({
        ...expectedDetail,
        amount: 12500,
      });
      expect(logs[1].detail).toMatchObject({ ...expectedDetail, amount: 777 });
      expect(logs[2].detail).toMatchObject({ ...expectedDetail, amount: 777 });
    });

    it('audita al administrador global con el local del registro, no el suyo', async () => {
      const created = (
        await createTip(
          tipPayload({ businessDate: '2026-10-30', paymentMethod: 'CASH' }),
          tokens.admin,
        ).expect(201)
      ).body as TipEntryResponse;
      expect(created.responsible.id).toBe(ids.admin);

      const [log] = await prisma.auditLog.findMany({
        where: { entityType: 'tip_entries', entityId: created.id },
      });
      expect(log).toMatchObject({
        action: AUDIT_ACTION.TIP_ENTRY_CREATED,
        entityType: 'tip_entries',
        entityId: created.id,
        userId: ids.admin,
        storeId,
      });
      expect(log?.detail).toMatchObject({
        storeId,
        responsibleId: ids.admin,
        businessDate: '2026-10-30',
        paymentMethod: 'CASH',
        amount: 12500,
      });
      await deleteTip(created.id, tokens.admin).expect(204);
    });
  },
  30_000,
);
