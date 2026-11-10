import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { normalizeExternalLabel } from '../src/sales-imports/normalization/normalize-external-label.js';
import { fakeSubwayStoreId } from './helpers/subway-store-id.js';

// Tests de integración del modelo de importaciones diarias de ventas
// MrComanda (SPRINT-4R-T08) contra PostgreSQL real: equivalencias explícitas
// de locales y medios, una sola versión vigente por local y fecha,
// idempotencia por hash, confirmación solo con líneas que cuadran con el
// total, inmutabilidad del archivo y de las líneas confirmadas, y separación
// de ventas, propinas y diferencias de efectivo. Se omiten si no se define
// TEST_DATABASE_URL. Cada rechazo esperado va en su propio withinRollback y es
// la última sentencia: un error de la base aborta la transacción.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Caso del reporte real: el archivo se llama 06/11, pero su período es el
// 05/11/2026 (hora de Chile, UTC-3 en noviembre).
const BUSINESS_DATE = new Date('2026-11-05T00:00:00.000Z');
const PERIOD_START = new Date('2026-11-05T03:00:00.000Z');
const PERIOD_END = new Date('2026-11-06T02:59:00.000Z');
// Texto original del encabezado; el local se identifica por el ID Subway de
// la cabecera (subway_store_id, SPRINT-4A-T17), que el trigger compara con el
// del local. Cada base de prueba usa un ID Subway ficticio propio.
const EXTERNAL_CODE = '208 - 72597';

// Líneas ficticias con la misma estructura del reporte: suman 873.260.
const LINES = [
  { label: 'T. DEBITO', code: 'DEBIT_CARD', amount: 512_300 },
  { label: 'EFECTIVO', code: 'CASH', amount: 201_460 },
  { label: 'T. CREDITO', code: 'CREDIT_CARD', amount: 154_500 },
  { label: 'N.de Créd.', code: 'CREDIT_NOTE', amount: 5_000 },
] as const;
const TOTAL = 873_260;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)(
  'Modelo de importaciones diarias de ventas MrComanda (SPRINT-4R-T08)',
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

    interface Base {
      storeId: string;
      subwayStoreId: string;
      otherStoreId: string;
      adminId: string;
      methodIds: Record<string, string>;
    }

    // Dos locales (solo el primero con ID Subway), un
    // administrador, un medio propio para la nota de crédito y alias para las
    // cuatro etiquetas del reporte. Los medios y alias se crean con códigos y
    // etiquetas propios del test cuando el seed ya sembró los globales.
    async function crearBase(tx: Prisma.TransactionClient): Promise<Base> {
      const store = await tx.store.create({
        data: {
          name: 'Subway Importacion Modelo Test',
          city: 'Melipilla',
          address: 'Calle 123',
          subwayStoreId: fakeSubwayStoreId(),
        },
      });
      const otherStore = await tx.store.create({
        data: {
          name: 'Subway Importacion Modelo Otro',
          city: 'Calera',
          address: 'Calle 456',
        },
      });
      const adminRole = await tx.role.upsert({
        where: { code: 'ADMINISTRADOR' },
        update: {},
        create: { code: 'ADMINISTRADOR', name: 'Administrador' },
      });
      const admin = await tx.user.create({
        data: {
          email: 'admin-importacion-modelo@test.invalid',
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Ada',
          lastName: 'Importa',
          roleId: adminRole.id,
        },
      });
      const methodIds: Record<string, string> = {};
      const catalog = [
        { code: 'CASH', name: 'Efectivo', behavior: 'CASH' },
        { code: 'DEBIT_CARD', name: 'Débito', behavior: 'RECONCILABLE_CARD' },
        { code: 'CREDIT_CARD', name: 'Crédito', behavior: 'RECONCILABLE_CARD' },
        {
          code: 'CREDIT_NOTE',
          name: 'Nota de crédito',
          behavior: 'EXTERNAL_OTHER',
        },
      ] as const;
      for (const [index, medio] of catalog.entries()) {
        const guardado = await tx.paymentMethod.upsert({
          where: { code: medio.code },
          update: {},
          create: {
            code: medio.code,
            name: medio.name,
            sortOrder: 900 + index,
            behavior: medio.behavior,
          },
        });
        methodIds[medio.code] = guardado.id;
      }
      for (const line of LINES) {
        const normalizedLabel = normalizeExternalLabel(line.label);
        await tx.paymentMethodAlias.upsert({
          where: {
            system_normalizedLabel: { system: 'MRCOMANDA', normalizedLabel },
          },
          update: { paymentMethodId: methodIds[line.code] },
          create: {
            system: 'MRCOMANDA',
            label: line.label,
            normalizedLabel,
            paymentMethodId: methodIds[line.code],
          },
        });
      }
      return {
        storeId: store.id,
        subwayStoreId: store.subwayStoreId ?? '',
        otherStoreId: otherStore.id,
        adminId: admin.id,
        methodIds,
      };
    }

    function headerData(
      base: Base,
      overrides: Partial<Prisma.SalesImportUncheckedCreateInput> = {},
    ): Prisma.SalesImportUncheckedCreateInput {
      return {
        storeId: base.storeId,
        businessDate: BUSINESS_DATE,
        periodStart: PERIOD_START,
        periodEnd: PERIOD_END,
        externalStoreCode: EXTERNAL_CODE,
        externalStoreName: 'Local de prueba',
        subwayStoreId: base.subwayStoreId,
        version: 1,
        totalAmount: BigInt(TOTAL),
        fileName: 'ventas-06-11-2026.xlsx',
        filePath: 'sales-imports/2026/11/aleatorio.xlsx',
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: BigInt(18_432),
        sha256Hash: 'a1'.repeat(32),
        uploadedById: base.adminId,
        ...overrides,
      };
    }

    async function crearImportacion(
      tx: Prisma.TransactionClient,
      base: Base,
      overrides: Partial<Prisma.SalesImportUncheckedCreateInput> = {},
    ): Promise<string> {
      const header = await tx.salesImport.create({
        data: headerData(base, overrides),
      });
      await tx.salesImportLine.createMany({
        data: LINES.map((line, index) => ({
          importId: header.id,
          lineNumber: index + 1,
          originalLabel: line.label,
          normalizedLabel: normalizeExternalLabel(line.label),
          amount: BigInt(line.amount),
          percentage: new Prisma.Decimal(
            ((line.amount / TOTAL) * 100).toFixed(2),
          ),
          paymentMethodId: base.methodIds[line.code],
        })),
      });
      return header.id;
    }

    async function confirmar(
      tx: Prisma.TransactionClient,
      base: Base,
      importId: string,
    ): Promise<void> {
      await tx.salesImport.update({
        where: { id: importId },
        data: {
          status: 'ACTIVE',
          isCurrent: true,
          confirmedAt: new Date(),
          confirmedById: base.adminId,
        },
      });
    }

    async function reemplazar(
      tx: Prisma.TransactionClient,
      importId: string,
    ): Promise<void> {
      await tx.salesImport.update({
        where: { id: importId },
        data: {
          status: 'SUPERSEDED',
          isCurrent: null,
          supersededAt: new Date(),
        },
      });
    }

    describe('equivalencias y normalización', () => {
      it('la normalización SQL coincide con la de TypeScript', async () => {
        const samples = [
          'T. DEBITO',
          'N.de Créd.',
          '  t.   débito \t',
          '208  -\n72597',
          'Señal Única',
          'efectivo',
        ];
        for (const sample of samples) {
          const rows = await prisma.$queryRaw<{ normalized: string }[]>`
            SELECT normalize_external_label(${sample}) AS normalized`;
          expect(rows[0].normalized).toBe(normalizeExternalLabel(sample));
        }
      });

      it('rechaza un alias cuya etiqueta normalizada no corresponde', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.paymentMethodAlias.create({
              data: {
                system: 'MRCOMANDA',
                label: 'Tarjeta Débito Test',
                normalizedLabel: 'Tarjeta Débito Test',
                paymentMethodId: base.methodIds['DEBIT_CARD'],
              },
            }),
          ).rejects.toThrow(/payment_method_aliases_label_normalized/);
        });
      });

      it('una etiqueta normalizada resuelve un único medio por sistema', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.paymentMethodAlias.create({
              data: {
                system: 'MRCOMANDA',
                label: 't. débito',
                normalizedLabel: 'T. DEBITO',
                paymentMethodId: base.methodIds['CASH'],
              },
            }),
          ).rejects.toThrow(/system_normalized_label|normalized_label/);
        });
      });

      it('rechaza un identificador de local sin normalizar', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.storeExternalCode.create({
              data: {
                system: 'MRCOMANDA',
                externalCode: '300  -  1',
                storeId: base.otherStoreId,
              },
            }),
          ).rejects.toThrow(/store_external_codes_code_normalized/);
        });
      });

      // store_external_codes queda sin uso desde SPRINT-4A-T17, pero la tabla y
      // sus restricciones se conservan.
      it('un identificador externo no apunta a dos locales', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await tx.storeExternalCode.create({
            data: {
              system: 'MRCOMANDA',
              externalCode: EXTERNAL_CODE,
              storeId: base.storeId,
            },
          });
          await expect(
            tx.storeExternalCode.create({
              data: {
                system: 'MRCOMANDA',
                externalCode: EXTERNAL_CODE,
                storeId: base.otherStoreId,
              },
            }),
          ).rejects.toThrow(/external_code/);
        });
      });

      it('un local tiene a lo más un identificador por sistema', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await tx.storeExternalCode.create({
            data: {
              system: 'MRCOMANDA',
              externalCode: EXTERNAL_CODE,
              storeId: base.storeId,
            },
          });
          await expect(
            tx.storeExternalCode.create({
              data: {
                system: 'MRCOMANDA',
                externalCode: '999 - 1',
                storeId: base.storeId,
              },
            }),
          ).rejects.toThrow(/store_id/);
        });
      });
    });

    describe('cabecera y líneas', () => {
      it('guarda la importación con metadatos, líneas y etiquetas originales y la confirma', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const salesBefore = await tx.sale.count();
          const importId = await crearImportacion(tx, base);
          await confirmar(tx, base, importId);

          const saved = await tx.salesImport.findUniqueOrThrow({
            where: { id: importId },
            include: { lines: { orderBy: { lineNumber: 'asc' } } },
          });
          expect(saved.status).toBe('ACTIVE');
          expect(saved.isCurrent).toBe(true);
          expect(saved.system).toBe('MRCOMANDA');
          expect(saved.businessDate.toISOString().slice(0, 10)).toBe(
            '2026-11-05',
          );
          expect(saved.periodStart).toEqual(PERIOD_START);
          expect(saved.periodEnd).toEqual(PERIOD_END);
          expect(saved.externalStoreCode).toBe(EXTERNAL_CODE);
          expect(saved.subwayStoreId).toBe(base.subwayStoreId);
          expect(saved.fileName).toBe('ventas-06-11-2026.xlsx');
          expect(saved.sha256Hash).toBe('a1'.repeat(32));
          expect(saved.uploadedById).toBe(base.adminId);
          expect(saved.confirmedById).toBe(base.adminId);
          expect(saved.totalAmount).toBe(BigInt(TOTAL));
          expect(saved.lines.map((l) => l.originalLabel)).toEqual(
            LINES.map((l) => l.label),
          );
          expect(saved.lines.map((l) => l.paymentMethodId)).toEqual(
            LINES.map((l) => base.methodIds[l.code]),
          );
          expect(
            saved.lines.reduce((sum, line) => sum + line.amount, BigInt(0)),
          ).toBe(BigInt(TOTAL));

          // La importación no escribe en sales ni guarda propinas o
          // diferencias de efectivo (esas columnas no existen en el modelo).
          expect(await tx.sale.count()).toBe(salesBefore);
          expect(Object.keys(saved)).not.toContain('tipAmount');
          expect(Object.keys(saved)).not.toContain('cashDifference');
        });
      });

      it('rechaza una cabecera sin ID Subway (SPRINT-4A-T17)', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, { subwayStoreId: null }),
            }),
          ).rejects.toThrow(/debe indicar el ID Subway del local/);
        });
      });

      it('rechaza un ID Subway que no es el del local (SPRINT-4A-T17)', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, { subwayStoreId: fakeSubwayStoreId() }),
            }),
          ).rejects.toThrow(/no está asignado al local de la importación/);
        });
      });

      it('ya no exige store_external_codes: basta el ID Subway del local (SPRINT-4A-T17)', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          expect(
            await tx.storeExternalCode.count({
              where: { storeId: base.storeId },
            }),
          ).toBe(0);
          const importId = await crearImportacion(tx, base, {
            externalStoreCode: '777 - 1',
          });
          await confirmar(tx, base, importId);
          expect(
            (
              await tx.salesImport.findUniqueOrThrow({
                where: { id: importId },
              })
            ).status,
          ).toBe('ACTIVE');
        });
      });

      it('no asigna el identificador de un local a otro local', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, { storeId: base.otherStoreId }),
            }),
          ).rejects.toThrow(/no está asignado al local de la importación/);
        });
      });

      it('rechaza una línea cuya etiqueta no tiene alias', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const header = await tx.salesImport.create({
            data: headerData(base),
          });
          await expect(
            tx.salesImportLine.create({
              data: {
                importId: header.id,
                lineNumber: 1,
                originalLabel: 'JUNAEB DESCONOCIDO',
                normalizedLabel: 'JUNAEB DESCONOCIDO',
                amount: BigInt(1000),
                paymentMethodId: base.methodIds['CASH'],
              },
            }),
          ).rejects.toThrow(/no tiene un alias configurado/);
        });
      });

      it('rechaza una línea asignada a un medio distinto del alias', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const header = await tx.salesImport.create({
            data: headerData(base),
          });
          await expect(
            tx.salesImportLine.create({
              data: {
                importId: header.id,
                lineNumber: 1,
                originalLabel: 'T. DEBITO',
                normalizedLabel: 'T. DEBITO',
                amount: BigInt(1000),
                paymentMethodId: base.methodIds['CASH'],
              },
            }),
          ).rejects.toThrow(/no tiene un alias configurado/);
        });
      });

      it('rechaza un período cuya fecha de negocio no coincide', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, {
                businessDate: new Date('2026-11-06T00:00:00.000Z'),
              }),
            }),
          ).rejects.toThrow(/business_date_matches_period/);
        });
      });

      it('rechaza un período de más de un día', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, {
                periodEnd: new Date('2026-11-07T02:59:00.000Z'),
              }),
            }),
          ).rejects.toThrow(/sales_imports_valid_period/);
        });
      });

      it('rechaza crear una importación ya confirmada', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await expect(
            tx.salesImport.create({
              data: headerData(base, {
                status: 'ACTIVE',
                isCurrent: true,
                confirmedAt: new Date(),
                confirmedById: base.adminId,
              }),
            }),
          ).rejects.toThrow(/debe crearse en estado PENDING/);
        });
      });
    });

    describe('confirmación', () => {
      it('no confirma una importación sin líneas', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const header = await tx.salesImport.create({
            data: headerData(base),
          });
          await expect(confirmar(tx, base, header.id)).rejects.toThrow(
            /no tiene líneas/,
          );
        });
      });

      it('no confirma si las líneas no suman el total del reporte', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base, {
            totalAmount: BigInt(TOTAL + 1),
          });
          await expect(confirmar(tx, base, importId)).rejects.toThrow(
            /no coincide con el total del reporte/,
          );
        });
      });

      it('exige los datos de confirmación junto con el estado', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await expect(
            tx.salesImport.update({
              where: { id: importId },
              data: { status: 'ACTIVE', isCurrent: true },
            }),
          ).rejects.toThrow(/sales_imports_status_consistency/);
        });
      });
    });

    describe('versiones', () => {
      it('reimportar el mismo archivo no crea otra versión', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await crearImportacion(tx, base);
          await expect(
            tx.salesImport.create({ data: headerData(base, { version: 2 }) }),
          ).rejects.toThrow(/sha256_hash/);
        });
      });

      it('una nueva versión reemplaza a la vigente de forma atómica', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const v1 = await crearImportacion(tx, base);
          await confirmar(tx, base, v1);
          const v2 = await crearImportacion(tx, base, {
            version: 2,
            sha256Hash: 'b2'.repeat(32),
          });
          // Mientras la v2 está PENDING, la v1 sigue vigente.
          const vigentes = await tx.salesImport.findMany({
            where: {
              storeId: base.storeId,
              businessDate: BUSINESS_DATE,
              status: 'ACTIVE',
            },
          });
          expect(vigentes.map((i) => i.id)).toEqual([v1]);

          await reemplazar(tx, v1);
          await confirmar(tx, base, v2);

          const todas = await tx.salesImport.findMany({
            where: { storeId: base.storeId, businessDate: BUSINESS_DATE },
            orderBy: { version: 'asc' },
          });
          expect(todas.map((i) => [i.version, i.status])).toEqual([
            [1, 'SUPERSEDED'],
            [2, 'ACTIVE'],
          ]);
          expect(todas[0].confirmedById).toBe(base.adminId);
        });
      });

      it('no permite dos versiones vigentes para el mismo local y fecha', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const v1 = await crearImportacion(tx, base);
          await confirmar(tx, base, v1);
          const v2 = await crearImportacion(tx, base, {
            version: 2,
            sha256Hash: 'b2'.repeat(32),
          });
          await expect(confirmar(tx, base, v2)).rejects.toThrow(/is_current/);
        });
      });

      it('no repite el número de versión', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          await crearImportacion(tx, base);
          await expect(
            tx.salesImport.create({
              data: headerData(base, { sha256Hash: 'c3'.repeat(32) }),
            }),
          ).rejects.toThrow(/version/);
        });
      });

      it('una versión reemplazada no vuelve a quedar vigente', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const v1 = await crearImportacion(tx, base);
          await confirmar(tx, base, v1);
          await reemplazar(tx, v1);
          await expect(
            tx.salesImport.update({
              where: { id: v1 },
              data: {
                status: 'ACTIVE',
                isCurrent: true,
                supersededAt: null,
              },
            }),
          ).rejects.toThrow(/Transición de estado no permitida/);
        });
      });
    });

    describe('inmutabilidad', () => {
      it('los datos del archivo no cambian ni siquiera en PENDING', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await expect(
            tx.salesImport.update({
              where: { id: importId },
              data: { totalAmount: BigInt(1) },
            }),
          ).rejects.toThrow(/son inmutables/);
        });
      });

      it('guarda la fecha de emisión y no permite cambiarla (SPRINT-4R-T10)', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const issuedAt = new Date('2026-11-06T14:14:55.000Z');
          const importId = await crearImportacion(tx, base, { issuedAt });
          await confirmar(tx, base, importId);
          const saved = await tx.salesImport.findUniqueOrThrow({
            where: { id: importId },
          });
          expect(saved.issuedAt).toEqual(issuedAt);
          await expect(
            tx.salesImport.update({
              where: { id: importId },
              data: { issuedAt: new Date('2026-11-07T10:00:00.000Z') },
            }),
          ).rejects.toThrow(/son inmutables/);
        });
      });

      it('el ID Subway de la importación no cambia y no depende de cambios posteriores del local (SPRINT-4A-T17)', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          // Cambiar el ID Subway del local después no reescribe la importación
          // ni impide confirmarla: el trigger solo lo exige al insertar.
          await tx.store.update({
            where: { id: base.storeId },
            data: { subwayStoreId: fakeSubwayStoreId() },
          });
          await confirmar(tx, base, importId);
          const saved = await tx.salesImport.findUniqueOrThrow({
            where: { id: importId },
          });
          expect(saved.subwayStoreId).toBe(base.subwayStoreId);
          expect(saved.status).toBe('ACTIVE');
          await expect(
            tx.salesImport.update({
              where: { id: importId },
              data: { subwayStoreId: fakeSubwayStoreId() },
            }),
          ).rejects.toThrow(/son inmutables/);
        });
      });

      it('las líneas de una importación confirmada no cambian', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await confirmar(tx, base, importId);
          await expect(
            tx.salesImportLine.updateMany({
              where: { importId },
              data: { amount: BigInt(0) },
            }),
          ).rejects.toThrow(/sus líneas son inmutables/);
        });
      });

      it('no se agregan líneas a una importación confirmada', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await confirmar(tx, base, importId);
          await expect(
            tx.salesImportLine.create({
              data: {
                importId,
                lineNumber: 99,
                originalLabel: 'EFECTIVO ',
                normalizedLabel: 'EFECTIVO',
                amount: BigInt(1),
                paymentMethodId: base.methodIds['CASH'],
              },
            }),
          ).rejects.toThrow(/sus líneas son inmutables/);
        });
      });

      it('no se elimina una importación confirmada', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await confirmar(tx, base, importId);
          await expect(
            tx.salesImport.delete({ where: { id: importId } }),
          ).rejects.toThrow(/solo se descartan importaciones PENDING/);
        });
      });

      it('descartar una importación PENDING elimina también sus líneas', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await tx.salesImport.delete({ where: { id: importId } });
          expect(await tx.salesImportLine.count({ where: { importId } })).toBe(
            0,
          );
        });
      });

      it('cambiar o borrar un alias no reinterpreta una importación confirmada', async () => {
        await withinRollback(async (tx) => {
          const base = await crearBase(tx);
          const importId = await crearImportacion(tx, base);
          await confirmar(tx, base, importId);
          await tx.paymentMethodAlias.update({
            where: {
              system_normalizedLabel: {
                system: 'MRCOMANDA',
                normalizedLabel: 'T. DEBITO',
              },
            },
            data: { paymentMethodId: base.methodIds['CASH'] },
          });
          await tx.paymentMethodAlias.delete({
            where: {
              system_normalizedLabel: {
                system: 'MRCOMANDA',
                normalizedLabel: 'EFECTIVO',
              },
            },
          });
          const lines = await tx.salesImportLine.findMany({
            where: { importId },
            orderBy: { lineNumber: 'asc' },
          });
          expect(lines[0].originalLabel).toBe('T. DEBITO');
          expect(lines[0].paymentMethodId).toBe(base.methodIds['DEBIT_CARD']);
          expect(lines[1].paymentMethodId).toBe(base.methodIds['CASH']);
        });
      });

      it('rechaza TRUNCATE sobre importaciones y líneas', async () => {
        await withinRollback(async (tx) => {
          await expect(
            tx.$executeRawUnsafe(
              'TRUNCATE "sales_imports", "sales_import_lines"',
            ),
          ).rejects.toThrow(/no se permite TRUNCATE/);
        });
      });
    });
  },
);
