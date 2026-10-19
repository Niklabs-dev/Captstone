import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración de la inmutabilidad de las liquidaciones publicadas
// (SPRINT-2-T14, criterio 1 de E2-H1) contra PostgreSQL real. Se omiten si no
// se define TEST_DATABASE_URL. Cada test corre dentro de una transacción que
// se revierte (patrón withinRollback): los intentos rechazados por la base de
// datos abortan esa transacción, por lo que tampoco dejan datos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PUBLISHED_IMMUTABLE = /La liquidación publicada .* es inmutable/;
const IDENTITY = /No se puede cambiar el trabajador, el período/;
const PUBLISHED_DOCUMENT = /es de una liquidación publicada/;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface PayslipFixture {
  payslipId: string;
  documentId: string;
  workerId: string;
  accountantId: string;
}

describe.skipIf(!databaseUrl)(
  'Inmutabilidad de las liquidaciones publicadas (SPRINT-2-T14)',
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

    // Una liquidación pendiente con su documento LIQUIDACION y versión 1.
    // retainUntil permite simular un plazo de conservación vencido.
    async function createFixture(
      tx: Prisma.TransactionClient,
      retainUntil = new Date('2031-10-19'),
    ): Promise<PayslipFixture> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Liquidaciones Inmutables Test',
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      const createUser = async (
        code: string,
        name: string,
        storeId: string | null,
      ): Promise<string> => {
        const role = await tx.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
        const user = await tx.user.create({
          data: {
            email: `${name}@payslips-immutability-test.moi-food.cl`,
            passwordHash: '$2b$04$hash-de-prueba',
            firstName: name,
            lastName: 'Inmutable',
            roleId: role.id,
            storeId,
          },
        });
        return user.id;
      };
      const workerId = await createUser('TRABAJADOR', 'ana', store.id);
      const accountantId = await createUser('CONTADOR', 'contador', null);
      const type = await tx.documentType.upsert({
        where: { code: 'LIQUIDACION' },
        update: {},
        create: { code: 'LIQUIDACION', name: 'Liquidación de sueldo' },
      });
      const document = await tx.document.create({
        data: {
          title: 'Liquidación de sueldo 2026-09',
          retainUntil,
          storeId: store.id,
          subjectUserId: workerId,
          documentTypeId: type.id,
          createdById: accountantId,
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          fileName: 'liquidacion.pdf',
          filePath: '2026/10/liquidacion-inmutable.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256Hash: 'f'.repeat(64),
          uploadedById: accountantId,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      const payslip = await tx.payslip.create({
        data: {
          period: new Date('2026-09-01'),
          documentId: document.id,
          workerId,
          createdById: accountantId,
        },
      });
      return {
        payslipId: payslip.id,
        documentId: document.id,
        workerId,
        accountantId,
      };
    }

    async function publish(
      tx: Prisma.TransactionClient,
      fixture: PayslipFixture,
    ): Promise<void> {
      await tx.payslip.update({
        where: { id: fixture.payslipId },
        data: {
          status: 'PUBLISHED',
          signedAt: new Date('2026-10-19'),
          publishedAt: new Date(),
          publishedById: fixture.accountantId,
        },
      });
    }

    it('permite publicar una liquidación pendiente', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        const payslip = await tx.payslip.findUniqueOrThrow({
          where: { id: fixture.payslipId },
        });
        expect(payslip.status).toBe('PUBLISHED');
      });
    });

    it('rechaza modificar una liquidación publicada, también volverla a pendiente', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        await expect(
          tx.payslip.update({
            where: { id: fixture.payslipId },
            data: { signedAt: new Date('2026-10-01') },
          }),
        ).rejects.toThrow(PUBLISHED_IMMUTABLE);
      });
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        await expect(
          tx.$executeRaw`UPDATE payslips SET status = 'PENDING_SIGNATURE', signed_at = NULL, published_at = NULL, published_by_id = NULL WHERE id = ${fixture.payslipId}::uuid`,
        ).rejects.toThrow(PUBLISHED_IMMUTABLE);
      });
    });

    it('rechaza eliminar una liquidación publicada durante el plazo de conservación', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        await expect(
          tx.payslip.delete({ where: { id: fixture.payslipId } }),
        ).rejects.toThrow(PUBLISHED_IMMUTABLE);
      });
    });

    it('permite eliminar una liquidación publicada vencido el plazo de conservación de su documento', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx, new Date('2020-01-01'));
        await publish(tx, fixture);
        await tx.payslip.delete({ where: { id: fixture.payslipId } });
        expect(
          await tx.payslip.count({ where: { id: fixture.payslipId } }),
        ).toBe(0);
      });
    });

    it('rechaza cambiar el trabajador, el período o el documento de una liquidación pendiente', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await expect(
          tx.payslip.update({
            where: { id: fixture.payslipId },
            data: { period: new Date('2026-08-01') },
          }),
        ).rejects.toThrow(IDENTITY);
      });
    });

    it('rechaza agregar versiones o modificar el documento de una liquidación publicada', async () => {
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        await expect(
          tx.documentVersion.create({
            data: {
              documentId: fixture.documentId,
              versionNumber: 2,
              fileName: 'liquidacion-v2.pdf',
              filePath: '2026/10/liquidacion-inmutable-v2.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 2048,
              sha256Hash: 'e'.repeat(64),
              uploadedById: fixture.accountantId,
            },
          }),
        ).rejects.toThrow(PUBLISHED_DOCUMENT);
      });
      await withinRollback(async (tx) => {
        const fixture = await createFixture(tx);
        await publish(tx, fixture);
        await expect(
          tx.document.update({
            where: { id: fixture.documentId },
            data: { title: 'Liquidación modificada' },
          }),
        ).rejects.toThrow(PUBLISHED_DOCUMENT);
      });
    });

    it('rechaza vaciar la tabla con TRUNCATE', async () => {
      await withinRollback(async (tx) => {
        // Mismo orden de bloqueo que la aplicación (documents, document_versions
        // y payslips) para evitar deadlocks con los tests que corren en paralelo.
        await tx.$executeRaw`LOCK TABLE documents, document_versions, payslips IN ACCESS EXCLUSIVE MODE`;
        await expect(tx.$executeRaw`TRUNCATE TABLE payslips`).rejects.toThrow(
          /no se permite TRUNCATE sobre payslips/,
        );
      });
    });
  },
);
