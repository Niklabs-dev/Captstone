import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración del modelo de liquidaciones (SPRINT-2-T12) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Cada test
// corre dentro de una transacción que se revierte (patrón withinRollback): los
// intentos rechazados por la base de datos abortan esa transacción, por lo que
// tampoco dejan datos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const WRONG_DOCUMENT = /debe apuntar a un documento LIQUIDACION/;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface PayslipFixture {
  storeId: string;
  workerId: string;
  otherWorkerId: string;
  accountantId: string;
  payslipDocumentId: string;
  contractDocumentId: string;
}

describe.skipIf(!databaseUrl)('Modelo de liquidaciones (SPRINT-2-T12)', () => {
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

  async function createUser(
    tx: Prisma.TransactionClient,
    roleCode: string,
    name: string,
    storeId: string | null,
  ): Promise<string> {
    const role = await tx.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, name: roleCode },
    });
    const user = await tx.user.create({
      data: {
        email: `${name}@payslips-model-test.moi-food.cl`,
        passwordHash: '$2b$04$hash-de-prueba',
        firstName: name,
        lastName: 'Liquidaciones',
        roleId: role.id,
        storeId,
      },
    });
    return user.id;
  }

  async function createDocument(
    tx: Prisma.TransactionClient,
    typeCode: string,
    subjectUserId: string,
    storeId: string,
    createdById: string,
  ): Promise<string> {
    const type = await tx.documentType.upsert({
      where: { code: typeCode },
      update: {},
      create: { code: typeCode, name: typeCode },
    });
    const document = await tx.document.create({
      data: {
        title: `${typeCode} de prueba`,
        retainUntil: new Date('2031-10-19'),
        storeId,
        subjectUserId,
        documentTypeId: type.id,
        createdById,
      },
    });
    return document.id;
  }

  // Un trabajador con un documento LIQUIDACION (y otro CONTRATO) y el
  // contador que los carga.
  async function createFixture(
    tx: Prisma.TransactionClient,
  ): Promise<PayslipFixture> {
    const store = await tx.store.create({
      data: {
        name: 'Subway Liquidaciones Test',
        city: 'Melipilla',
        address: 'Calle de prueba 123',
      },
    });
    const workerId = await createUser(tx, 'TRABAJADOR', 'ana', store.id);
    const otherWorkerId = await createUser(tx, 'TRABAJADOR', 'luis', store.id);
    const accountantId = await createUser(tx, 'CONTADOR', 'contador', null);
    return {
      storeId: store.id,
      workerId,
      otherWorkerId,
      accountantId,
      payslipDocumentId: await createDocument(
        tx,
        'LIQUIDACION',
        workerId,
        store.id,
        accountantId,
      ),
      contractDocumentId: await createDocument(
        tx,
        'CONTRATO',
        workerId,
        store.id,
        accountantId,
      ),
    };
  }

  function pendingPayslip(
    fixture: PayslipFixture,
    period = '2026-09-01',
  ): Prisma.PayslipUncheckedCreateInput {
    return {
      period: new Date(period),
      documentId: fixture.payslipDocumentId,
      workerId: fixture.workerId,
      createdById: fixture.accountantId,
    };
  }

  it('registra una liquidación pendiente de firma y la publica con fecha de firma y de publicación', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      const payslip = await tx.payslip.create({
        data: pendingPayslip(fixture),
      });
      expect(payslip).toMatchObject({
        status: 'PENDING_SIGNATURE',
        signedAt: null,
        publishedAt: null,
        publishedById: null,
      });

      const published = await tx.payslip.update({
        where: { id: payslip.id },
        data: {
          status: 'PUBLISHED',
          signedAt: new Date('2026-10-01'),
          publishedAt: new Date(),
          publishedById: fixture.accountantId,
        },
      });
      expect(published.status).toBe('PUBLISHED');

      // El archivo sale del gestor documental: versión y hash del documento.
      const withDocument = await tx.payslip.findUniqueOrThrow({
        where: { id: payslip.id },
        include: { document: { include: { documentType: true } } },
      });
      expect(withDocument.document.documentType.code).toBe('LIQUIDACION');
    });
  });

  it('rechaza una segunda liquidación del mismo trabajador y período', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await tx.payslip.create({ data: pendingPayslip(fixture) });
      const otherDocumentId = await createDocument(
        tx,
        'LIQUIDACION',
        fixture.workerId,
        fixture.storeId,
        fixture.accountantId,
      );
      await expect(
        tx.payslip.create({
          data: { ...pendingPayslip(fixture), documentId: otherDocumentId },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  it('rechaza un período que no es el primer día del mes', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await expect(
        tx.payslip.create({ data: pendingPayslip(fixture, '2026-09-15') }),
      ).rejects.toThrow(/payslips_period_first_day_check/);
    });
  });

  it('exige fecha de firma, publicación y responsable solo en una liquidación publicada', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await expect(
        tx.payslip.create({
          data: { ...pendingPayslip(fixture), status: 'PUBLISHED' },
        }),
      ).rejects.toThrow(/payslips_status_publication_check/);
    });
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await expect(
        tx.payslip.create({
          data: { ...pendingPayslip(fixture), publishedAt: new Date() },
        }),
      ).rejects.toThrow(/payslips_status_publication_check/);
    });
  });

  it('rechaza un documento que no es LIQUIDACION', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await expect(
        tx.payslip.create({
          data: {
            ...pendingPayslip(fixture),
            documentId: fixture.contractDocumentId,
          },
        }),
      ).rejects.toThrow(WRONG_DOCUMENT);
    });
  });

  it('rechaza una liquidación cuyo trabajador no es el titular del documento', async () => {
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      await expect(
        tx.payslip.create({
          data: { ...pendingPayslip(fixture), workerId: fixture.otherWorkerId },
        }),
      ).rejects.toThrow(WRONG_DOCUMENT);
    });
    await withinRollback(async (tx) => {
      const fixture = await createFixture(tx);
      const payslip = await tx.payslip.create({
        data: pendingPayslip(fixture),
      });
      await expect(
        tx.payslip.update({
          where: { id: payslip.id },
          data: { workerId: fixture.otherWorkerId },
        }),
      ).rejects.toThrow(WRONG_DOCUMENT);
    });
  });
});
