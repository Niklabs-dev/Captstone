import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración del bloqueo de eliminación de documentos antes de su
// plazo de conservación (SPRINT-2-T07, art. 9 bis CT) contra PostgreSQL real.
// Se omiten si no se define TEST_DATABASE_URL. Cada test corre dentro de una
// transacción que se revierte (patrón withinRollback): los intentos rechazados
// por la base de datos abortan esa transacción, por lo que tampoco dejan datos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const RETENTION = /antes de su plazo de conservación/;
const DAY_MS = 24 * 60 * 60 * 1000;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface RetentionFixture {
  documentId: string;
  versionId: string;
}

describe.skipIf(!databaseUrl)(
  'Conservación de documentos en la base de datos (SPRINT-2-T07)',
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

    // Día actual en hora de Chile según la base de datos, el mismo que usan
    // los triggers.
    async function businessToday(tx: Prisma.TransactionClient): Promise<Date> {
      const [row] = await tx.$queryRaw<{ today: Date }[]>`
        SELECT (now() AT TIME ZONE 'America/Santiago')::date AS today`;
      return row.today;
    }

    // Un contrato con su versión 1 vigente que debe conservarse hasta
    // retainUntil.
    async function createFixture(
      tx: Prisma.TransactionClient,
      retainUntil: Date,
    ): Promise<RetentionFixture> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Conservación Test',
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
          email: 'conservacion@document-retention-test.moi-food.cl',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Conservación',
          roleId: role.id,
          storeId: store.id,
        },
      });
      const type = await tx.documentType.upsert({
        where: { code: 'CONTRATO' },
        update: {},
        create: { code: 'CONTRATO', name: 'Contrato de trabajo' },
      });
      const document = await tx.document.create({
        data: {
          title: 'Contrato de prueba',
          retainUntil,
          storeId: store.id,
          subjectUserId: user.id,
          documentTypeId: type.id,
          createdById: user.id,
        },
      });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: 1,
          fileName: 'contrato.pdf',
          filePath: '2026/10/prueba-conservacion.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256Hash: 'f'.repeat(64),
          uploadedById: user.id,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      return { documentId: document.id, versionId: version.id };
    }

    // Mismo orden que DocumentsService.remove.
    async function deleteDocument(
      tx: Prisma.TransactionClient,
      documentId: string,
    ): Promise<void> {
      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: null },
      });
      await tx.documentVersion.deleteMany({ where: { documentId } });
      await tx.document.delete({ where: { id: documentId } });
    }

    it('rechaza eliminar un documento el último día de su plazo de conservación', async () => {
      await withinRollback(async (tx) => {
        const { documentId } = await createFixture(tx, await businessToday(tx));
        await expect(deleteDocument(tx, documentId)).rejects.toThrow(RETENTION);
      });
    });

    it('rechaza eliminar el documento directamente, sin pasar por sus versiones', async () => {
      await withinRollback(async (tx) => {
        const today = await businessToday(tx);
        const { documentId } = await createFixture(
          tx,
          new Date(today.getTime() + 5 * 365 * DAY_MS),
        );
        await expect(
          tx.$executeRaw`DELETE FROM documents WHERE id = ${documentId}::uuid`,
        ).rejects.toThrow(RETENTION);
      });
    });

    it('permite eliminar el documento y sus versiones vencido el plazo', async () => {
      await withinRollback(async (tx) => {
        const today = await businessToday(tx);
        const { documentId } = await createFixture(
          tx,
          new Date(today.getTime() - DAY_MS),
        );
        await deleteDocument(tx, documentId);
        expect(
          await tx.document.findUnique({ where: { id: documentId } }),
        ).toBeNull();
        expect(await tx.documentVersion.count({ where: { documentId } })).toBe(
          0,
        );
      });
    });

    it('vencido el plazo, las versiones siguen sin poder modificarse', async () => {
      await withinRollback(async (tx) => {
        const today = await businessToday(tx);
        const { versionId } = await createFixture(
          tx,
          new Date(today.getTime() - DAY_MS),
        );
        await expect(
          tx.documentVersion.update({
            where: { id: versionId },
            data: { fileName: 'otro.pdf' },
          }),
        ).rejects.toThrow(/Las versiones de documentos son inmutables/);
      });
    });

    it('permite extender el plazo de conservación', async () => {
      await withinRollback(async (tx) => {
        const { documentId } = await createFixture(
          tx,
          new Date('2031-10-17T00:00:00.000Z'),
        );
        const document = await tx.document.update({
          where: { id: documentId },
          data: { retainUntil: new Date('2032-10-17T00:00:00.000Z') },
        });
        expect(document.retainUntil.toISOString().slice(0, 10)).toBe(
          '2032-10-17',
        );
      });
    });

    it('rechaza acortar el plazo de conservación', async () => {
      await withinRollback(async (tx) => {
        const { documentId } = await createFixture(
          tx,
          new Date('2031-10-17T00:00:00.000Z'),
        );
        await expect(
          tx.document.update({
            where: { id: documentId },
            data: { retainUntil: new Date('2020-01-01T00:00:00.000Z') },
          }),
        ).rejects.toThrow(/No se puede acortar el plazo de conservación/);
      });
    });

    it('rechaza vaciar la tabla con TRUNCATE', async () => {
      await withinRollback(async (tx) => {
        await expect(
          tx.$executeRaw`TRUNCATE TABLE documents CASCADE`,
        ).rejects.toThrow(/no se permite TRUNCATE sobre documents/);
      });
    });
  },
);
