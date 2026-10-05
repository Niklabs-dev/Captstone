import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración de la inmutabilidad del registro de auditoría
// (SPRINT-1-T15, criterio 2 de E1-H2) contra PostgreSQL real. Se omiten si no
// se define TEST_DATABASE_URL. Cada test corre dentro de una transacción que
// se revierte (patrón withinRollback): los intentos rechazados por la base de
// datos abortan esa transacción, por lo que tampoco dejan datos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const IMMUTABLE = /El registro de auditoría es inmutable/;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface AuditFixture {
  logId: bigint;
  userId: string;
  storeId: string;
}

describe.skipIf(!databaseUrl)(
  'Inmutabilidad de la auditoría (SPRINT-1-T15)',
  () => {
    let prisma: PrismaClient;

    beforeAll(() => {
      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
    });

    afterAll(async () => {
      await prisma.$disconnect();
    });

    async function withinRollback(
      fn: (tx: Prisma.TransactionClient) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(async (tx) => {
          await fn(tx);
          throw new Rollback();
        });
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    // Un local, un usuario y un registro de auditoría que los referencia.
    async function createAuditFixture(
      tx: Prisma.TransactionClient,
    ): Promise<AuditFixture> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Inmutable Test',
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      const role = await tx.role.upsert({
        where: { code: 'TRABAJADOR' },
        update: {},
        create: { code: 'TRABAJADOR', name: 'Trabajador' },
      });
      const user = await tx.user.create({
        data: {
          email: 'inmutable@audit-immutability-test.moi-food.cl',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Inmutable',
          roleId: role.id,
          storeId: store.id,
        },
      });
      const log = await tx.auditLog.create({
        data: {
          action: 'USER_LOGIN',
          entityType: 'auth',
          entityId: user.id,
          detail: { email: user.email },
          userId: user.id,
          storeId: store.id,
        },
      });
      return { logId: log.id, userId: user.id, storeId: store.id };
    }

    it('permite registrar nuevas operaciones y leerlas', async () => {
      await withinRollback(async (tx) => {
        const { logId } = await createAuditFixture(tx);
        const log = await tx.auditLog.findUniqueOrThrow({
          where: { id: logId },
        });
        expect(log.action).toBe('USER_LOGIN');
      });
    });

    it.each<
      [
        string,
        (tx: Prisma.TransactionClient, f: AuditFixture) => Promise<unknown>,
      ]
    >([
      [
        'update de un registro',
        (tx, f) =>
          tx.auditLog.update({
            where: { id: f.logId },
            data: { action: 'USER_LOGIN_FAILED' },
          }),
      ],
      [
        'updateMany',
        (tx, f) =>
          tx.auditLog.updateMany({
            where: { id: f.logId },
            data: { detail: Prisma.DbNull },
          }),
      ],
      [
        'quitar el responsable (user_id a NULL)',
        (tx, f) =>
          tx.auditLog.update({
            where: { id: f.logId },
            data: { userId: null },
          }),
      ],
      [
        'delete de un registro',
        (tx, f) => tx.auditLog.delete({ where: { id: f.logId } }),
      ],
      [
        'deleteMany',
        (tx, f) => tx.auditLog.deleteMany({ where: { id: f.logId } }),
      ],
      [
        'UPDATE en SQL directo',
        (tx, f) =>
          tx.$executeRaw`UPDATE "audit_logs" SET "action" = 'HACK' WHERE "id" = ${f.logId}`,
      ],
      [
        'DELETE en SQL directo',
        (tx, f) =>
          tx.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${f.logId}`,
      ],
      ['TRUNCATE', (tx) => tx.$executeRaw`TRUNCATE "audit_logs"`],
    ])('rechaza en la base de datos: %s', async (_caso, change) => {
      await expect(
        withinRollback(async (tx) => {
          const fixture = await createAuditFixture(tx);
          await change(tx, fixture);
        }),
      ).rejects.toThrow(IMMUTABLE);
    });

    it('impide borrar un usuario que tiene registros de auditoría', async () => {
      await expect(
        withinRollback(async (tx) => {
          const { userId } = await createAuditFixture(tx);
          await tx.user.delete({ where: { id: userId } });
        }),
      ).rejects.toThrow(/audit_logs_user_id_fkey/);
    });

    it('impide borrar un local que tiene registros de auditoría', async () => {
      await expect(
        withinRollback(async (tx) => {
          // Local referenciado solo por la auditoría (sin usuarios), para
          // aislar la FK de audit_logs de la de users.
          const store = await tx.store.create({
            data: {
              name: 'Subway Inmutable Test Local',
              city: 'Calera',
              address: 'Calle de prueba 456',
            },
          });
          await tx.auditLog.create({
            data: {
              action: 'STORE_CLOSED',
              entityType: 'stores',
              storeId: store.id,
            },
          });
          await tx.store.delete({ where: { id: store.id } });
        }),
      ).rejects.toThrow(/audit_logs_store_id_fkey/);
    });

    it('un rol sin privilegios de superusuario no puede omitir los triggers', async () => {
      await expect(
        withinRollback(async (tx) => {
          // CREATE ROLE es transaccional: el rol desaparece con el rollback.
          await tx.$executeRaw`CREATE ROLE "audit_immutability_test_app" NOLOGIN`;
          await tx.$executeRaw`SET LOCAL ROLE "audit_immutability_test_app"`;
          await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        }),
      ).rejects.toThrow(/session_replication_role/);
    });
  },
);
