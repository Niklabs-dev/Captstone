import { PrismaPg } from '@prisma/adapter-pg';
import { readFile } from 'node:fs/promises';
import { BASE_STORES } from '../prisma/seed.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { parseMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.parser.js';
import type { ParsedMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.types.js';
import { readMrComandaReport } from '../src/sales-imports/parser/read-mrcomanda-report.js';
import { SalesImportResolverService } from '../src/sales-imports/sales-import-resolver.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { buildReportSheet } from './helpers/mrcomanda-report-fixture.js';
import { fakeSubwayStoreId } from './helpers/subway-store-id.js';

// Resolución del reporte leído contra las equivalencias de SPRINT-4R-T08
// (SPRINT-4R-T09) con PostgreSQL real: un local o medio sin equivalencia
// impide confirmar y la resolución nunca crea asignaciones. Se omiten si no
// se define TEST_DATABASE_URL y cada test se revierte. Desde SPRINT-4A-T17 el
// local se identifica por el ID Subway del encabezado (stores.subway_store_id).
const databaseUrl = process.env.TEST_DATABASE_URL;
// Archivo real del PO (no versionado), para la aceptación de SPRINT-4A-T17:
//   MRCOMANDA_SAMPLE_XLSX=../.tmp/ventas-06-11-2026.xlsx
const samplePath = process.env.MRCOMANDA_SAMPLE_XLSX;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'Resolución de importaciones MrComanda (SPRINT-4R-T09)',
  { timeout: 60_000 },
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
        await prisma.$transaction(
          async (tx) => {
            await fn(tx);
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    }

    // El servicio solo usa store y paymentMethodAlias: la transacción cubre
    // esa superficie y así todo se revierte.
    function resolverFor(tx: Prisma.TransactionClient) {
      return new SalesImportResolverService(tx as unknown as PrismaService);
    }

    // Reporte ficticio con el local indicado en el encabezado («Local: …»).
    function report(storeLabel: string): ParsedMrComandaReport {
      return parseMrComandaReport([
        buildReportSheet({
          filters: ` - Todas las Empresas - Local: ${storeLabel} - Todos los Sectores`,
        }),
      ]);
    }

    async function configure(
      tx: Prisma.TransactionClient,
      labels: Record<string, string>,
    ): Promise<{
      storeId: string;
      subwayStoreId: string;
      methodIds: Record<string, string>;
    }> {
      const subwayStoreId = fakeSubwayStoreId();
      const store = await tx.store.create({
        data: {
          name: 'Subway Resolucion Importacion Test',
          city: 'Melipilla',
          address: 'Calle 1',
          subwayStoreId,
        },
      });
      const methodIds: Record<string, string> = {};
      for (const [index, [label, code]] of Object.entries(labels).entries()) {
        const method = await tx.paymentMethod.upsert({
          where: { code },
          update: {},
          create: {
            code,
            name: code,
            sortOrder: 950 + index,
            behavior: 'EXTERNAL_OTHER',
          },
        });
        methodIds[label] = method.id;
        await tx.paymentMethodAlias.upsert({
          where: {
            system_normalizedLabel: {
              system: 'MRCOMANDA',
              normalizedLabel: label,
            },
          },
          update: { paymentMethodId: method.id },
          create: {
            system: 'MRCOMANDA',
            label,
            normalizedLabel: label,
            paymentMethodId: method.id,
          },
        });
      }
      return { storeId: store.id, subwayStoreId, methodIds };
    }

    const ALL_LABELS = {
      'T. DEBITO': 'DEBIT_CARD',
      EFECTIVO: 'CASH',
      'T. CREDITO': 'CREDIT_CARD',
      'N.DE CRED.': 'T09_CREDIT_NOTE',
    };

    it('resuelve el local y todos los medios cuando hay equivalencias', async () => {
      await withinRollback(async (tx) => {
        const { storeId, subwayStoreId, methodIds } = await configure(
          tx,
          ALL_LABELS,
        );

        const resolved = await resolverFor(tx).resolve(
          report(`990 - ${subwayStoreId}`),
        );

        expect(resolved.canConfirm).toBe(true);
        expect(resolved.issues).toEqual([]);
        expect(resolved.store?.id).toBe(storeId);
        expect(resolved.lines.map((line) => line.paymentMethod?.id)).toEqual([
          methodIds['T. DEBITO'],
          methodIds['EFECTIVO'],
          methodIds['T. CREDITO'],
          methodIds['N.DE CRED.'],
        ]);
      });
    });

    it('un medio sin alias impide confirmar y no crea el alias', async () => {
      await withinRollback(async (tx) => {
        const { subwayStoreId } = await configure(tx, {
          'T. DEBITO': 'DEBIT_CARD',
          EFECTIVO: 'CASH',
          'T. CREDITO': 'CREDIT_CARD',
        });
        // Si el seed sembró globalmente un alias para la nota de crédito, se
        // retira dentro de la transacción para probar el caso desconocido.
        await tx.paymentMethodAlias.deleteMany({
          where: { system: 'MRCOMANDA', normalizedLabel: 'N.DE CRED.' },
        });
        const aliasesBefore = await tx.paymentMethodAlias.count();

        const resolved = await resolverFor(tx).resolve(
          report(`990 - ${subwayStoreId}`),
        );

        expect(resolved.canConfirm).toBe(false);
        expect(resolved.issues).toEqual([
          expect.objectContaining({
            code: 'PAYMENT_METHOD_NOT_CONFIGURED',
            lineNumber: 4,
            originalLabel: 'N.de Créd.',
          }),
        ]);
        expect(resolved.lines[3].paymentMethod).toBeNull();
        expect(await tx.paymentMethodAlias.count()).toBe(aliasesBefore);
      });
    });

    it('un ID Subway sin local asignado impide confirmar sin suponer ninguno', async () => {
      await withinRollback(async (tx) => {
        const subwayStoreId = fakeSubwayStoreId();
        const storesBefore = await tx.store.findMany({
          select: { id: true, subwayStoreId: true },
          orderBy: { id: 'asc' },
        });

        const resolved = await resolverFor(tx).resolve(
          report(`990 - ${subwayStoreId}`),
        );

        expect(resolved.canConfirm).toBe(false);
        expect(resolved.store).toBeNull();
        expect(resolved.issues).toContainEqual({
          code: 'STORE_NOT_CONFIGURED',
          externalStoreCode: `990 - ${subwayStoreId}`,
          subwayStoreId,
          message: expect.stringContaining(
            `El ID Subway ${subwayStoreId} no está asignado a ningún local`,
          ) as string,
        });
        // La resolución solo consulta: no asigna el ID a ningún local.
        expect(
          await tx.store.findMany({
            select: { id: true, subwayStoreId: true },
            orderBy: { id: 'asc' },
          }),
        ).toEqual(storesBefore);
      });
    });

    it('ignora el número interno de MrComanda y acepta el ID Subway solo (SPRINT-4A-T17)', async () => {
      await withinRollback(async (tx) => {
        const { storeId, subwayStoreId } = await configure(tx, ALL_LABELS);
        // Otro local con un ID Subway igual al número interno: no debe ganar.
        const decoy = await tx.store.create({
          data: {
            name: 'Subway Resolucion Importacion Señuelo',
            city: 'Melipilla',
            address: 'Calle 2',
            subwayStoreId: '990',
          },
        });

        for (const label of [
          `990 - ${subwayStoreId}`,
          `990-${subwayStoreId}`,
          `  990   -   ${subwayStoreId}  `,
          `123 - ${subwayStoreId}`,
          subwayStoreId,
        ]) {
          const resolved = await resolverFor(tx).resolve(report(label));
          expect(resolved.report.subwayStoreId).toBe(subwayStoreId);
          expect(resolved.store?.id).toBe(storeId);
          expect(resolved.store?.id).not.toBe(decoy.id);
          expect(resolved.canConfirm).toBe(true);
        }
      });
    });

    it('un encabezado sin ID Subway reconocible queda como local no identificado', async () => {
      await withinRollback(async (tx) => {
        await configure(tx, ALL_LABELS);

        const resolved = await resolverFor(tx).resolve(report('Santa María'));

        expect(resolved.report.subwayStoreId).toBeNull();
        expect(resolved.store).toBeNull();
        expect(resolved.canConfirm).toBe(false);
        expect(resolved.issues).toEqual([
          expect.objectContaining({
            code: 'STORE_NOT_IDENTIFIED',
            externalStoreCode: 'SANTA MARIA',
            subwayStoreId: null,
          }),
        ]);
      });
    });

    it('un ID Subway de un local inactivo no resuelve el local', async () => {
      await withinRollback(async (tx) => {
        const { storeId, subwayStoreId } = await configure(tx, ALL_LABELS);
        await tx.store.update({
          where: { id: storeId },
          data: { isActive: false },
        });

        const resolved = await resolverFor(tx).resolve(
          report(`990 - ${subwayStoreId}`),
        );

        expect(resolved.store).toBeNull();
        expect(resolved.canConfirm).toBe(false);
        expect(resolved.issues).toEqual([
          expect.objectContaining({
            code: 'STORE_INACTIVE',
            subwayStoreId,
            message: expect.stringContaining(
              'Subway Resolucion Importacion Test',
            ) as string,
          }),
        ]);
      });
    });
  },
);

describe.skipIf(!databaseUrl || !samplePath)(
  'Aceptación con el reporte real de MrComanda (SPRINT-4A-T17)',
  { timeout: 60_000 },
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

    it('con 72597 configurado en Santa María identifica el archivo como Santa María sin pasos manuales', async () => {
      const report = await readMrComandaReport(
        await readFile(samplePath ?? ''),
      );
      expect(report.externalStoreCode).toBe('208 - 72597');
      expect(report.subwayStoreId).toBe('72597');

      const santaMaria = BASE_STORES[0];
      try {
        await prisma.$transaction(
          async (tx) => {
            // Santa María existe y tiene 72597 (como lo deja el seed); si
            // otro local lo tuviera, se libera dentro de la transacción.
            await tx.store.updateMany({
              where: { subwayStoreId: '72597', id: { not: santaMaria.id } },
              data: { subwayStoreId: null },
            });
            await tx.store.upsert({
              where: { id: santaMaria.id },
              update: { subwayStoreId: '72597', isActive: true },
              create: { ...santaMaria, subwayStoreId: '72597' },
            });

            const resolved = await new SalesImportResolverService(
              tx as unknown as PrismaService,
            ).resolve(report);

            expect(resolved.store?.id).toBe(santaMaria.id);
            expect(
              resolved.issues.filter((issue) =>
                issue.code.startsWith('STORE_'),
              ),
            ).toEqual([]);
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 60_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      }
    });
  },
);
