import { randomInt, randomUUID } from 'node:crypto';
import {
  ROLE,
  type RoleCode,
} from '../../src/auth/constants/roles.constants.js';
import type { AuthUser } from '../../src/auth/types/auth.types.js';
import type {
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';
import { computeRutCheckDigit } from '../../src/users/utils/rut.util.js';
import { createDailyOperation } from './daily-operations.js';

// Datos FICTICIOS de propinas diarias para los tests de la exportación a
// Excel (SPRINT-4A-T05) y del pago por período (SPRINT-4A-T06): un local con
// supervisor, tres trabajadores con RUT ficticio y tres días de operación
// (D1 $40.000 entre 4, D2 $10.000 entre 3 y D3 con fondo 0), un contador y
// un administrador. Las propinas las genera el helper de operaciones con la
// misma regla que la API (SPRINT-4A-T03). Con payFirstDay, D1 y la propina de
// Ana en D2 quedan pagadas en un lote insertado directamente en la base.

type Client = Prisma.TransactionClient | PrismaClient;

export const TIPS_D1 = '2026-11-03';
export const TIPS_D2 = '2026-11-04';
export const TIPS_D3 = '2026-11-05';

export interface DailyTipsFixture {
  storeId: string;
  storeName: string;
  otherStoreId: string;
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  ana: AuthUser;
  beto: AuthUser;
  carla: AuthUser;
  rutByUser: Map<string, string>;
  operations: Record<string, string>;
  batchId: string | null;
}

export interface DailyTipsFixtureOptions {
  // Prefijo del nombre del local (único por corrida con un UUID).
  storePrefix: string;
  // Dominio de correo de los usuarios creados (para limpiarlos después).
  emailDomain: string;
  payFirstDay?: boolean;
}

function fakeRut(): string {
  const body = String(randomInt(30_000_000, 99_999_999));
  return `${body}-${computeRutCheckDigit(body)}`;
}

async function createUser(
  client: Client,
  role: RoleCode,
  storeId: string | null,
  firstName: string,
  emailDomain: string,
  rut: string | null = null,
): Promise<AuthUser> {
  const roleRecord = await client.role.upsert({
    where: { code: role },
    update: {},
    create: { code: role, name: role },
  });
  const id = randomUUID();
  const email = `${id}${emailDomain}`;
  await client.user.create({
    data: {
      id,
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName,
      lastName: 'Ficticia',
      rut,
      roleId: roleRecord.id,
      storeId,
    },
  });
  return { id, email, role, storeId };
}

export async function createDailyTipsFixture(
  client: Client,
  options: DailyTipsFixtureOptions,
): Promise<DailyTipsFixture> {
  const domain = options.emailDomain;
  const storeName = `${options.storePrefix} ${randomUUID()}`;
  const store = await client.store.create({
    data: { name: storeName, city: 'Melipilla', address: 'Calle ficticia 1' },
  });
  const otherStore = await client.store.create({
    data: {
      name: `${options.storePrefix} Otro ${randomUUID()}`,
      city: 'Calera',
      address: 'Calle ficticia 2',
    },
  });
  const rutByUser = new Map<string, string>();
  const withRut = async (
    role: RoleCode,
    firstName: string,
  ): Promise<AuthUser> => {
    const rut = fakeRut();
    const user = await createUser(
      client,
      role,
      store.id,
      firstName,
      domain,
      rut,
    );
    rutByUser.set(user.id, rut);
    return user;
  };
  const supervisor = await withRut(ROLE.SUPERVISOR, 'Sofía');
  const ana = await withRut(ROLE.TRABAJADOR, 'Ana');
  const beto = await withRut(ROLE.TRABAJADOR, 'Beto');
  const carla = await withRut(ROLE.TRABAJADOR, 'Carla');
  const base = { storeId: store.id, responsibleId: supervisor.id };
  const operations = {
    [TIPS_D1]: await createDailyOperation(client, {
      ...base,
      businessDate: TIPS_D1,
      cashTipAmount: 40_000,
      participantIds: [ana.id, beto.id, carla.id, supervisor.id],
    }),
    [TIPS_D2]: await createDailyOperation(client, {
      ...base,
      businessDate: TIPS_D2,
      cashTipAmount: 10_000,
      participantIds: [ana.id, beto.id, supervisor.id],
    }),
    [TIPS_D3]: await createDailyOperation(client, {
      ...base,
      businessDate: TIPS_D3,
    }),
  };
  const accountant = await createUser(
    client,
    ROLE.CONTADOR,
    null,
    'Contador',
    domain,
  );
  const admin = await createUser(
    client,
    ROLE.ADMINISTRADOR,
    null,
    'Admin',
    domain,
  );

  let batchId: string | null = null;
  if (options.payFirstDay) {
    // Lote y propinas en la misma transacción: los totales del lote se
    // concilian al commit (constraint trigger diferido).
    const pay = async (tx: Prisma.TransactionClient): Promise<string> => {
      const paid = await tx.dailyTipAllocation.findMany({
        where: {
          OR: [
            { operationId: operations[TIPS_D1] },
            { operationId: operations[TIPS_D2], workerId: ana.id },
          ],
        },
      });
      const batch = await tx.tipPaymentBatch.create({
        data: {
          storeId: store.id,
          periodStart: new Date(`${TIPS_D1}T00:00:00.000Z`),
          periodEnd: new Date(`${TIPS_D2}T00:00:00.000Z`),
          totalAmount: paid.reduce((sum, tip) => sum + tip.amount, 0n),
          allocationCount: paid.length,
          paidById: accountant.id,
          paidAt: new Date('2026-11-06T15:00:00.000Z'),
        },
      });
      await tx.dailyTipAllocation.updateMany({
        where: { id: { in: paid.map((tip) => tip.id) } },
        data: { status: 'PAID', paymentBatchId: batch.id },
      });
      return batch.id;
    };
    batchId =
      '$transaction' in client
        ? await client.$transaction((tx) => pay(tx))
        : await pay(client);
  }

  return {
    storeId: store.id,
    storeName,
    otherStoreId: otherStore.id,
    admin,
    accountant,
    supervisor,
    ana,
    beto,
    carla,
    rutByUser,
    operations,
    batchId,
  };
}
