import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Tests de integración de la inmutabilidad de las versiones de documentos
// (SPRINT-2-T05, criterio 1 de E1-H3) contra PostgreSQL real. Se omiten si no
// se define TEST_DATABASE_URL. Cada test corre dentro de una transacción que
// se revierte (patrón withinRollback): los intentos rechazados por la base de
// datos abortan esa transacción, por lo que tampoco dejan datos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const IMMUTABLE = /Las versiones de documentos son inmutables/;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface VersionFixture {
  documentId: string;
  versionId: string;
}

describe.skipIf(!databaseUrl)(
  'Inmutabilidad de las versiones de documentos (SPRINT-2-T05)',
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

    // Un trabajador con un documento y su versión 1 vigente.
    async function createVersionFixture(
      tx: Prisma.TransactionClient,
    ): Promise<VersionFixture> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Versiones Test',
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
          email: 'versiones@document-versions-test.moi-food.cl',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Versiones',
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
          retainUntil: new Date('2031-10-17'),
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
          filePath: '2026/10/prueba-inmutable.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1024,
          sha256Hash: 'c'.repeat(64),
          uploadedById: user.id,
        },
      });
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });
      return { documentId: document.id, versionId: version.id };
    }

    it('permite agregar versiones y mover la versión vigente del documento', async () => {
      await withinRollback(async (tx) => {
        const { documentId, versionId } = await createVersionFixture(tx);
        const v1 = await tx.documentVersion.findUniqueOrThrow({
          where: { id: versionId },
        });
        const v2 = await tx.documentVersion.create({
          data: {
            documentId,
            versionNumber: 2,
            fileName: 'contrato-v2.pdf',
            filePath: '2026/10/prueba-inmutable-v2.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            sha256Hash: 'd'.repeat(64),
            uploadedById: v1.uploadedById,
          },
        });
        const document = await tx.document.update({
          where: { id: documentId },
          data: { currentVersionId: v2.id },
        });
        expect(document.currentVersionId).toBe(v2.id);
      });
    });

    it('rechaza modificar una versión', async () => {
      await withinRollback(async (tx) => {
        const { versionId } = await createVersionFixture(tx);
        await expect(
          tx.documentVersion.update({
            where: { id: versionId },
            data: { sha256Hash: 'e'.repeat(64) },
          }),
        ).rejects.toThrow(IMMUTABLE);
      });
    });

    it('rechaza eliminar una versión', async () => {
      await withinRollback(async (tx) => {
        const { versionId } = await createVersionFixture(tx);
        await expect(
          tx.documentVersion.delete({ where: { id: versionId } }),
        ).rejects.toThrow(IMMUTABLE);
      });
    });

    it('rechaza vaciar la tabla con TRUNCATE', async () => {
      await withinRollback(async (tx) => {
        await expect(
          tx.$executeRaw`TRUNCATE TABLE document_versions CASCADE`,
        ).rejects.toThrow(IMMUTABLE);
      });
    });
  },
);
