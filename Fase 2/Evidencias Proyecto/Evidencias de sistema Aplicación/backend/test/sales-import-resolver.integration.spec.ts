import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { parseMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.parser.js';
import type { ParsedMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.types.js';
import { SalesImportResolverService } from '../src/sales-imports/sales-import-resolver.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { buildReportSheet } from './helpers/mrcomanda-report-fixture.js';

// Resolución del reporte leído contra las equivalencias de SPRINT-4R-T08
// (SPRINT-4R-T09) con PostgreSQL real: un local o medio sin equivalencia
// impide confirmar y la resolución nunca crea asignaciones. Se omiten si no
// se define TEST_DATABASE_URL y cada test se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;

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

    // El servicio solo usa storeExternalCode y paymentMethodAlias: la
    // transacción cubre esa superficie y así todo se revierte.
    function resolverFor(tx: Prisma.TransactionClient) {
      return new SalesImportResolverService(tx as unknown as PrismaService);
    }

    // Reporte ficticio con un identificador de local propio del test.
    function report(): ParsedMrComandaReport {
      return parseMrComandaReport([
        buildReportSheet({
          filters:
            ' - Todas las Empresas - Local: 990 - 99999 - Todos los Sectores',
        }),
      ]);
    }

    async function configure(
      tx: Prisma.TransactionClient,
      labels: Record<string, string>,
    ): Promise<{ storeId: string; methodIds: Record<string, string> }> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Resolucion Importacion Test',
          city: 'Melipilla',
          address: 'Calle 1',
        },
      });
      await tx.storeExternalCode.create({
        data: {
          system: 'MRCOMANDA',
          externalCode: '990 - 99999',
          storeId: store.id,
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
      return { storeId: store.id, methodIds };
    }

    it('resuelve el local y todos los medios cuando hay equivalencias', async () => {
      await withinRollback(async (tx) => {
        const { storeId, methodIds } = await configure(tx, {
          'T. DEBITO': 'DEBIT_CARD',
          EFECTIVO: 'CASH',
          'T. CREDITO': 'CREDIT_CARD',
          'N.DE CRED.': 'T09_CREDIT_NOTE',
        });

        const resolved = await resolverFor(tx).resolve(report());

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
        await configure(tx, {
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

        const resolved = await resolverFor(tx).resolve(report());

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

    it('un local sin identificador configurado impide confirmar sin suponer ninguno', async () => {
      await withinRollback(async (tx) => {
        await tx.storeExternalCode.deleteMany({
          where: { system: 'MRCOMANDA', externalCode: '990 - 99999' },
        });
        const codesBefore = await tx.storeExternalCode.count();

        const resolved = await resolverFor(tx).resolve(report());

        expect(resolved.canConfirm).toBe(false);
        expect(resolved.store).toBeNull();
        expect(resolved.issues).toContainEqual(
          expect.objectContaining({
            code: 'STORE_NOT_CONFIGURED',
            externalStoreCode: '990 - 99999',
          }),
        );
        expect(await tx.storeExternalCode.count()).toBe(codesBefore);
      });
    });
  },
);
