import { PrismaPg } from '@prisma/adapter-pg';
import {
  DataRightType,
  DocumentStatus,
  InventoryMovementType,
  PaymentMethodBehavior,
  Prisma,
  PrismaClient,
  SaleChannel,
  SaleSource,
  TipPoolStatus,
  UnitOfMeasure,
} from '../src/generated/prisma/client.js';

// Tests de integración contra PostgreSQL real. Se omiten si no se define
// TEST_DATABASE_URL (ej.: TEST_DATABASE_URL="postgresql://postgres:...@localhost:5433/subway_gestion").
// Cada test corre dentro de una transacción que se revierte al finalizar,
// por lo que no dejan datos en la base.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

// Los tests crean usuarios con el rol compartido TRABAJADOR: cada INSERT
// retiene un KEY SHARE sobre la fila del rol hasta commit, así que el
// DELETE del test de Restrict espera a las transacciones concurrentes de los
// demás archivos. Bajo carga paralela eso supera el timeout por defecto.
describe.skipIf(!databaseUrl)(
  'Integración con PostgreSQL',
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
        // Algunos tests esperan locks compartidos (p. ej. el DELETE del rol
        // TRABAJADOR compite con los KEY SHARE de usuarios creados en
        // paralelo): timeout acorde al resto de la suite.
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

    async function crearUsuarioBase(tx: Prisma.TransactionClient) {
      const store = await tx.store.create({
        data: {
          name: 'Subway Melipilla Centro',
          city: 'Melipilla',
          address: 'Av. Vicuña Mackenna 123',
        },
      });
      // Upsert: la base puede venir ya sembrada (SPRINT-1-T05) con el rol
      // TRABAJADOR creado; el test solo necesita un rol al que asociar usuarios.
      const role = await tx.role.upsert({
        where: { code: 'TRABAJADOR' },
        update: {},
        create: { code: 'TRABAJADOR', name: 'Trabajador' },
      });
      const user = await tx.user.create({
        data: {
          email: 'trabajador@moi-food.cl',
          passwordHash: '$2b$10$hash-de-prueba',
          firstName: 'Ana',
          lastName: 'Pérez',
          rut: '12.345.678-5',
          roleId: role.id,
          storeId: store.id,
        },
      });
      return { store, role, user };
    }

    // Resuelve un medio de pago del catálogo por código (SPRINT-4-T32): la base
    // puede venir ya sembrada (catálogo base idempotente); el test solo
    // necesita el medio para asociar ventas, propinas o líneas de cierre.
    async function asegurarMedioDePago(
      tx: Prisma.TransactionClient,
      code: string,
    ) {
      const catalogo: Record<
        string,
        { name: string; sortOrder: number; behavior: PaymentMethodBehavior }
      > = {
        CASH: {
          name: 'Efectivo',
          sortOrder: 10,
          behavior: PaymentMethodBehavior.CASH,
        },
        DEBIT_CARD: {
          name: 'Tarjeta de débito',
          sortOrder: 20,
          behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
        },
        CREDIT_CARD: {
          name: 'Tarjeta de crédito',
          sortOrder: 30,
          behavior: PaymentMethodBehavior.RECONCILABLE_CARD,
        },
        TRANSFER: {
          name: 'Transferencia',
          sortOrder: 40,
          behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
        },
      };
      const datos = catalogo[code] ?? {
        name: code,
        sortOrder: 100,
        behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
      };
      return tx.paymentMethod.upsert({
        where: { code },
        update: {},
        create: {
          code,
          name: datos.name,
          sortOrder: datos.sortOrder,
          behavior: datos.behavior,
          availableForTips: true,
        },
      });
    }

    it('crea un usuario con rol y local, y lee sus relaciones', async () => {
      await withinRollback(async (tx) => {
        const { user } = await crearUsuarioBase(tx);
        const encontrado = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
          include: { role: true, store: true },
        });
        expect(encontrado.role.code).toBe('TRABAJADOR');
        expect(encontrado.store?.name).toBe('Subway Melipilla Centro');
        expect(encontrado.isActive).toBe(true);
        expect(encontrado.anonymizedAt).toBeNull();
      });
    });

    it('rechaza correo duplicado (restricción única)', async () => {
      await withinRollback(async (tx) => {
        const { role, store } = await crearUsuarioBase(tx);
        const duplicado = tx.user.create({
          data: {
            email: 'trabajador@moi-food.cl',
            passwordHash: 'otro-hash',
            firstName: 'Otro',
            lastName: 'Usuario',
            roleId: role.id,
            storeId: store.id,
          },
        });
        await expect(duplicado).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('rechaza RUT duplicado pero permite varios usuarios anonimizados (rut NULL)', async () => {
      await withinRollback(async (tx) => {
        const { role, store } = await crearUsuarioBase(tx);
        const rutDuplicado = tx.user.create({
          data: {
            email: 'otro@moi-food.cl',
            passwordHash: 'hash',
            firstName: 'Copia',
            lastName: 'Rut',
            rut: '12.345.678-5',
            roleId: role.id,
            storeId: store.id,
          },
        });
        await expect(rutDuplicado).rejects.toMatchObject({ code: 'P2002' });
      });

      await withinRollback(async (tx) => {
        const { role, store } = await crearUsuarioBase(tx);
        // Ley 21.719: la cancelación anonimiza (rut y teléfono a NULL), no borra.
        for (const correo of [
          'anon1@anon.moi-food.cl',
          'anon2@anon.moi-food.cl',
        ]) {
          const anonimo = await tx.user.create({
            data: {
              email: correo,
              passwordHash: 'hash',
              firstName: 'Usuario',
              lastName: 'Anonimizado',
              rut: null,
              phone: null,
              anonymizedAt: new Date(),
              isActive: false,
              roleId: role.id,
              storeId: store.id,
            },
          });
          expect(anonimo.anonymizedAt).not.toBeNull();
        }
      });
    });

    it('impide eliminar un rol con usuarios asociados (Restrict protege la trazabilidad)', async () => {
      await withinRollback(async (tx) => {
        const { role } = await crearUsuarioBase(tx);
        await expect(
          tx.role.delete({ where: { id: role.id } }),
        ).rejects.toMatchObject({ code: 'P2003' });
      });
    });

    it('registra documento con versionado, hash SHA-256 y versión vigente', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        // Upsert: la base puede venir ya sembrada (SPRINT-1-T05) con los tipos
        // de documento creados; el test solo necesita un tipo para asociar.
        const tipo = await tx.documentType.upsert({
          where: { code: 'CONTRATO' },
          update: {},
          create: { code: 'CONTRATO', name: 'Contrato de trabajo' },
        });
        expect(tipo.retentionYears).toBe(5);

        const documento = await tx.document.create({
          data: {
            title: 'Contrato Ana Pérez',
            storeId: store.id,
            subjectUserId: user.id,
            documentTypeId: tipo.id,
            createdById: user.id,
            retainUntil: new Date('2031-10-08'),
          },
        });
        expect(documento.status).toBe(DocumentStatus.ACTIVE);

        const hashV1 = 'a'.repeat(64);
        const hashV2 = 'b'.repeat(64);
        await tx.documentVersion.create({
          data: {
            documentId: documento.id,
            versionNumber: 1,
            fileName: 'contrato.pdf',
            filePath: 'docs/contrato-v1.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            sha256Hash: hashV1,
            uploadedById: user.id,
          },
        });
        const v2 = await tx.documentVersion.create({
          data: {
            documentId: documento.id,
            versionNumber: 2,
            fileName: 'contrato-firmado.pdf',
            filePath: 'docs/contrato-v2.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            sha256Hash: hashV2,
            changeNote: 'Versión firmada por ambas partes',
            uploadedById: user.id,
          },
        });
        await tx.document.update({
          where: { id: documento.id },
          data: { currentVersionId: v2.id },
        });

        const conVersion = await tx.document.findUniqueOrThrow({
          where: { id: documento.id },
          include: { currentVersion: true, versions: true },
        });
        expect(conVersion.versions).toHaveLength(2);
        expect(conVersion.currentVersion?.sha256Hash).toBe(hashV2);
      });
    });

    it('rechaza hash SHA-256 duplicado y número de versión duplicado', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const tipo = await tx.documentType.upsert({
          where: { code: 'FINIQUITO' },
          update: {},
          create: { code: 'FINIQUITO', name: 'Finiquito' },
        });
        const documento = await tx.document.create({
          data: {
            title: 'Finiquito',
            storeId: store.id,
            documentTypeId: tipo.id,
            createdById: user.id,
            retainUntil: new Date('2031-10-08'),
          },
        });
        const version = {
          documentId: documento.id,
          versionNumber: 1,
          fileName: 'finiquito.pdf',
          filePath: 'docs/finiquito.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 512,
          sha256Hash: 'c'.repeat(64),
          uploadedById: user.id,
        };
        await tx.documentVersion.create({ data: version });
        await expect(
          tx.documentVersion.create({ data: { ...version, versionNumber: 2 } }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });

      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const tipo = await tx.documentType.upsert({
          where: { code: 'ANEXO' },
          update: {},
          create: { code: 'ANEXO', name: 'Anexo de contrato' },
        });
        const documento = await tx.document.create({
          data: {
            title: 'Anexo',
            storeId: store.id,
            documentTypeId: tipo.id,
            createdById: user.id,
            retainUntil: new Date('2031-10-08'),
          },
        });
        const version = {
          documentId: documento.id,
          versionNumber: 1,
          fileName: 'anexo.pdf',
          filePath: 'docs/anexo.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 256,
          sha256Hash: 'd'.repeat(64),
          uploadedById: user.id,
        };
        await tx.documentVersion.create({ data: version });
        await expect(
          tx.documentVersion.create({
            data: { ...version, sha256Hash: 'e'.repeat(64) },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('registra los plazos del documento: conservación y registro en la DT (SPRINT-2-T03)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const tipo = await tx.documentType.upsert({
          where: { code: 'CONTRATO' },
          update: {},
          create: {
            code: 'CONTRATO',
            name: 'Contrato de trabajo',
            requiresDtRegistration: true,
          },
        });

        // Contrato firmado el 01-10-2026: plazo de 15 días para la DT y
        // conservación de 5 años desde su celebración.
        const documento = await tx.document.create({
          data: {
            title: 'Contrato Ana Pérez',
            storeId: store.id,
            subjectUserId: user.id,
            documentTypeId: tipo.id,
            createdById: user.id,
            issuedAt: new Date('2026-10-01'),
            retainUntil: new Date('2031-10-01'),
            dtRegistrationDueAt: new Date('2026-10-16'),
          },
        });
        // Pendiente de registro: la alerta sigue activa.
        expect(documento.dtRegisteredAt).toBeNull();
        expect(documento.dtRegisteredById).toBeNull();

        const registrado = await tx.document.update({
          where: { id: documento.id },
          data: { dtRegisteredAt: new Date(), dtRegisteredById: user.id },
          include: { dtRegisteredBy: true },
        });
        expect(registrado.dtRegisteredBy?.id).toBe(user.id);
        expect(registrado.retainUntil.toISOString().slice(0, 10)).toBe(
          '2031-10-01',
        );

        // Quien marcó el registro en la DT no se puede borrar (Restrict).
        await expect(
          tx.user.delete({ where: { id: user.id } }),
        ).rejects.toMatchObject({ code: 'P2003' });
      });
    });

    it('rechaza un registro en la DT inconsistente (CHECK)', async () => {
      const casos = [
        // Registrado sin indicar quién lo marcó.
        { dtRegistrationDueAt: new Date('2026-10-16'), sinResponsable: true },
        // Registrado en un documento cuyo tipo no tiene plazo en la DT.
        { dtRegistrationDueAt: null, sinResponsable: false },
      ];
      for (const caso of casos) {
        await withinRollback(async (tx) => {
          const { user, store } = await crearUsuarioBase(tx);
          const tipo = await tx.documentType.upsert({
            where: { code: 'LIQUIDACION' },
            update: {},
            create: { code: 'LIQUIDACION', name: 'Liquidación de sueldo' },
          });
          await expect(
            tx.document.create({
              data: {
                title: 'Documento inconsistente',
                storeId: store.id,
                documentTypeId: tipo.id,
                createdById: user.id,
                retainUntil: new Date('2031-10-08'),
                dtRegistrationDueAt: caso.dtRegistrationDueAt,
                dtRegisteredAt: new Date(),
                dtRegisteredById: caso.sinResponsable ? null : user.id,
              },
            }),
          ).rejects.toThrow(/documents_dt_registered_/);
        });
      }
    });

    it('graba auditoría con detalle JSONB y permite acciones del sistema (sin usuario)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const log = await tx.auditLog.create({
          data: {
            action: 'DOCUMENT_UPLOADED',
            entityType: 'documents',
            entityId: crypto.randomUUID(),
            detail: { sha256: 'f'.repeat(64), version: 2 },
            ipAddress: '192.168.1.10',
            userId: user.id,
            storeId: store.id,
          },
        });
        expect(log.id).toBeGreaterThan(0);

        const delSistema = await tx.auditLog.create({
          data: {
            action: 'TIP_POOL_RECALCULATED',
            entityType: 'tip_pools',
            detail: { motivo: 'job nocturno' },
          },
        });
        expect(delSistema.userId).toBeNull();

        const leido = await tx.auditLog.findUniqueOrThrow({
          where: { id: log.id },
        });
        expect(leido.detail).toEqual({ sha256: 'f'.repeat(64), version: 2 });
      });
    });

    it('registra reparto de propinas con líneas por trabajador (art. 64 CT)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const pool = await tx.tipPool.create({
          data: {
            storeId: store.id,
            periodStart: new Date('2026-09-01'),
            periodEnd: new Date('2026-09-15'),
            totalAmount: 300000,
            calculatedById: user.id,
          },
        });
        expect(pool.status).toBe(TipPoolStatus.DRAFT);

        await tx.tipPoolLine.create({
          data: {
            poolId: pool.id,
            userId: user.id,
            hoursWorked: 90,
            amount: 300000,
          },
        });

        const conLineas = await tx.tipPool.findUniqueOrThrow({
          where: { id: pool.id },
          include: { lines: true },
        });
        const totalRepartido = conLineas.lines.reduce(
          (suma, linea) => suma + Number(linea.amount),
          0,
        );
        expect(totalRepartido).toBe(300000);

        await expect(
          tx.tipPoolLine.create({
            data: {
              poolId: pool.id,
              userId: user.id,
              hoursWorked: 10,
              amount: 1000,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('permite un solo cierre de caja por local y día, con responsable asociado', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const cierre = await tx.cashClosing.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            shift: 1,
            openingCash: 50000,
            responsibleId: user.id,
          },
        });
        expect(cierre.status).toBe('OPEN');

        await expect(
          tx.cashClosing.create({
            data: {
              storeId: store.id,
              businessDate: new Date('2026-09-24'),
              shift: 1,
              openingCash: 50000,
              responsibleId: user.id,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('registra venta con propina asociada a un cierre de caja', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const debito = await asegurarMedioDePago(tx, 'DEBIT_CARD');
        const cierre = await tx.cashClosing.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            shift: 1,
            openingCash: 50000,
            responsibleId: user.id,
          },
        });
        const venta = await tx.sale.create({
          data: {
            storeId: store.id,
            soldAt: new Date('2026-09-24T13:30:00-03:00'),
            paymentMethodId: debito.id,
            channel: SaleChannel.IN_STORE,
            grossAmount: 12500,
            tipAmount: 1250,
            cashClosingId: cierre.id,
            registeredById: user.id,
          },
        });
        expect(Number(venta.tipAmount)).toBe(1250);
        expect(venta.source).toBe(SaleSource.MANUAL);
        expect(venta.periodStart).toBeNull();
        expect(venta.periodEnd).toBeNull();

        const conMedio = await tx.sale.findUniqueOrThrow({
          where: { id: venta.id },
          include: { paymentMethod: true },
        });
        expect(conMedio.paymentMethod.code).toBe('DEBIT_CARD');
      });
    });

    it('desglosa el cierre por medio de pago: esperado vs contado con diferencia por línea', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const efectivo = await asegurarMedioDePago(tx, 'CASH');
        const debito = await asegurarMedioDePago(tx, 'DEBIT_CARD');
        const credito = await asegurarMedioDePago(tx, 'CREDIT_CARD');
        // Fondo de caja $50.000; ventas del día: $100.000 efectivo,
        // $140.000 débito y $160.000 crédito.
        const cierre = await tx.cashClosing.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            shift: 1,
            openingCash: 50000,
            responsibleId: user.id,
          },
        });

        const ventas: Array<[string, number]> = [
          [efectivo.id, 100000],
          [debito.id, 140000],
          [credito.id, 160000],
        ];
        for (const [paymentMethodId, grossAmount] of ventas) {
          await tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-09-24T20:00:00-03:00'),
              paymentMethodId,
              grossAmount,
              cashClosingId: cierre.id,
              registeredById: user.id,
            },
          });
        }

        // Esperado por medio = suma de ventas del medio (+ fondo si es efectivo).
        const esperadoPorMedio = new Map<string, number>([
          [efectivo.id, 150000],
          [debito.id, 140000],
          [credito.id, 160000],
        ]);

        // El supervisor declara lo contado; crédito cuadra con $1.000 menos.
        const contado: Array<[string, number]> = [
          [efectivo.id, 150000],
          [debito.id, 140000],
          [credito.id, 159000],
        ];
        for (const [medioId, montoContado] of contado) {
          const esperado = esperadoPorMedio.get(medioId) ?? 0;
          await tx.cashClosingLine.create({
            data: {
              closingId: cierre.id,
              paymentMethodId: medioId,
              expectedAmount: esperado,
              countedAmount: montoContado,
              difference: montoContado - esperado,
            },
          });
        }

        const conLineas = await tx.cashClosing.findUniqueOrThrow({
          where: { id: cierre.id },
          include: { lines: { include: { paymentMethod: true } } },
        });
        expect(conLineas.lines).toHaveLength(3);
        // La diferencia total del cierre es la suma de las diferencias por línea.
        const diferenciaTotal = conLineas.lines.reduce(
          (suma, linea) => suma + Number(linea.difference),
          0,
        );
        expect(diferenciaTotal).toBe(-1000);
        // Las respuestas exponen código y nombre desde el catálogo.
        for (const linea of conLineas.lines) {
          expect(linea.paymentMethod.code.length).toBeGreaterThan(0);
          expect(linea.paymentMethod.name.length).toBeGreaterThan(0);
        }

        // Un solo medio de pago por línea dentro del mismo cierre.
        await expect(
          tx.cashClosingLine.create({
            data: {
              closingId: cierre.id,
              paymentMethodId: efectivo.id,
              expectedAmount: 0,
              countedAmount: 0,
              difference: 0,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('calcula stock desde movimientos y registra conteo físico con diferencia', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        // Caja de 60 panes con 6 bolsas de 10 (SPRINT-5-T01).
        const pan = await tx.product.create({
          data: {
            sku: 'PAN-ITALIANO',
            name: 'Pan italiano',
            unit: UnitOfMeasure.UNIT,
            packageName: 'bolsa',
            boxContent: 60,
            packagesPerBox: 6,
            packageContent: 10,
          },
        });

        const movimientos: Array<[InventoryMovementType, number]> = [
          [InventoryMovementType.PURCHASE, 100],
          [InventoryMovementType.CONSUMPTION, 60],
          [InventoryMovementType.WASTE, 5],
        ];
        for (const [type, quantity] of movimientos) {
          await tx.inventoryMovement.create({
            data: {
              storeId: store.id,
              productId: pan.id,
              type,
              quantity,
              createdById: user.id,
            },
          });
        }

        const todos = await tx.inventoryMovement.findMany({
          where: { storeId: store.id, productId: pan.id },
        });
        const stock = todos.reduce((total, mov) => {
          const signo =
            mov.type === InventoryMovementType.PURCHASE ||
            mov.type === InventoryMovementType.ADJUSTMENT
              ? 1
              : -1;
          return total + signo * Number(mov.quantity);
        }, 0);
        expect(stock).toBe(35);

        const conteo = await tx.inventoryCount.create({
          data: {
            storeId: store.id,
            createdById: user.id,
            countDate: new Date('2026-11-11T00:00:00.000Z'),
          },
        });
        expect(conteo.status).toBe('OPEN');
        // 0 cajas + 3 bolsas de 10 + 3 sueltos = 33, con la copia del formato.
        const linea = await tx.inventoryCountLine.create({
          data: {
            countId: conteo.id,
            productId: pan.id,
            boxes: 0,
            packages: 3,
            looseQuantity: 3,
            countedQuantity: 33,
            systemQuantity: stock,
            difference: -2,
            productSku: pan.sku,
            productName: pan.name,
            unit: pan.unit,
            packageName: pan.packageName,
            boxContent: pan.boxContent,
            packagesPerBox: pan.packagesPerBox,
            packageContent: pan.packageContent,
            savedById: user.id,
          },
        });
        expect(Number(linea.countedQuantity)).toBe(33);
        expect(Number(linea.difference)).toBe(-2);
      });
    });

    it('registra solicitud de derecho ARCO con plazo de respuesta', async () => {
      await withinRollback(async (tx) => {
        const { user } = await crearUsuarioBase(tx);
        const solicitud = await tx.dataRightsRequest.create({
          data: {
            subjectId: user.id,
            type: DataRightType.CANCELLATION,
            description: 'Solicito la eliminación de mis datos personales',
            dueAt: new Date('2026-10-08'),
          },
        });
        expect(solicitud.status).toBe('PENDING');
        expect(solicitud.resolvedAt).toBeNull();
      });
    });

    it('catálogo de medios de pago: código único, comportamiento y disponibilidad para propinas (SPRINT-4-T32)', async () => {
      await withinRollback(async (tx) => {
        const junaeb = await tx.paymentMethod.create({
          data: {
            code: 'JUNAEB',
            name: 'Junaeb',
            sortOrder: 50,
            behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
            availableForTips: false,
          },
        });
        expect(junaeb.isActive).toBe(true);

        // Desactivar no borra: el medio sigue existiendo para el historial.
        const desactivado = await tx.paymentMethod.update({
          where: { id: junaeb.id },
          data: { isActive: false },
        });
        expect(desactivado.isActive).toBe(false);
        expect(
          await tx.paymentMethod.count({ where: { code: 'JUNAEB' } }),
        ).toBe(1);

        // El código es único: este rechazo aborta la transacción, así que es la
        // última operación del bloque.
        await expect(
          tx.paymentMethod.create({
            data: {
              code: 'JUNAEB',
              name: 'Junaeb duplicado',
              sortOrder: 60,
              behavior: PaymentMethodBehavior.EXTERNAL_OTHER,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('impide borrar un medio de pago con movimientos asociados (Restrict)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const efectivo = await asegurarMedioDePago(tx, 'CASH');
        await tx.tipEntry.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            paymentMethodId: efectivo.id,
            amount: 5000,
            responsibleId: user.id,
          },
        });
        await expect(
          tx.paymentMethod.delete({ where: { id: efectivo.id } }),
        ).rejects.toMatchObject({ code: 'P2003' });
      });
    });

    it('registra totales MrComanda únicos por local, medio y período (SPRINT-4-T32)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const debito = await asegurarMedioDePago(tx, 'DEBIT_CARD');
        const credito = await asegurarMedioDePago(tx, 'CREDIT_CARD');
        const periodo = {
          periodStart: new Date('2026-11-04T10:00:00-03:00'),
          periodEnd: new Date('2026-11-04T14:00:00-03:00'),
        };

        const carga = await tx.sale.create({
          data: {
            storeId: store.id,
            soldAt: new Date('2026-11-04T14:00:00-03:00'),
            paymentMethodId: debito.id,
            grossAmount: 125500,
            tipAmount: 0,
            source: SaleSource.MRCOMANDA,
            registeredById: user.id,
            ...periodo,
          },
        });
        expect(carga.source).toBe(SaleSource.MRCOMANDA);

        // Otro medio o período distinto sí puede cargarse.
        await expect(
          tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-11-04T14:00:00-03:00'),
              paymentMethodId: credito.id,
              grossAmount: 80000,
              tipAmount: 0,
              source: SaleSource.MRCOMANDA,
              registeredById: user.id,
              ...periodo,
            },
          }),
        ).resolves.toMatchObject({ source: SaleSource.MRCOMANDA });
        await expect(
          tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-11-04T22:00:00-03:00'),
              paymentMethodId: debito.id,
              grossAmount: 90000,
              tipAmount: 0,
              source: SaleSource.MRCOMANDA,
              registeredById: user.id,
              periodStart: new Date('2026-11-04T18:00:00-03:00'),
              periodEnd: new Date('2026-11-04T22:00:00-03:00'),
            },
          }),
        ).resolves.toMatchObject({ source: SaleSource.MRCOMANDA });

        // Las ventas manuales no tienen período y no colisionan entre sí.
        for (let i = 0; i < 2; i += 1) {
          await expect(
            tx.sale.create({
              data: {
                storeId: store.id,
                soldAt: new Date('2026-11-04T12:00:00-03:00'),
                paymentMethodId: debito.id,
                grossAmount: 5000,
                registeredById: user.id,
              },
            }),
          ).resolves.toBeDefined();
        }

        // El reintento idéntico viola la unicidad por local, medio y período:
        // este rechazo aborta la transacción, así que es la última operación.
        await expect(
          tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-11-04T14:00:00-03:00'),
              paymentMethodId: debito.id,
              grossAmount: 125500,
              tipAmount: 0,
              source: SaleSource.MRCOMANDA,
              registeredById: user.id,
              ...periodo,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('exige origen y período coherentes y sin propina en cargas MrComanda (CHECK)', async () => {
      // Cada caso corre en su propia transacción: el rechazo del CHECK aborta
      // el bloque y las siguientes operaciones fallarían con la transacción
      // abortada.
      const casos = [
        {
          nombre: 'MrComanda sin período',
          data: {
            tipAmount: 0,
            source: SaleSource.MRCOMANDA,
          },
          check: /sales_source_period_consistency/,
        },
        {
          nombre: 'manual con período',
          data: {
            tipAmount: 0,
            source: SaleSource.MANUAL,
            periodStart: new Date('2026-11-04T10:00:00-03:00'),
            periodEnd: new Date('2026-11-04T14:00:00-03:00'),
          },
          check: /sales_source_period_consistency/,
        },
        {
          nombre: 'período invertido',
          data: {
            tipAmount: 0,
            source: SaleSource.MRCOMANDA,
            periodStart: new Date('2026-11-04T14:00:00-03:00'),
            periodEnd: new Date('2026-11-04T10:00:00-03:00'),
          },
          check: /sales_valid_period/,
        },
        {
          nombre: 'MrComanda con propina',
          data: {
            tipAmount: 100,
            source: SaleSource.MRCOMANDA,
            periodStart: new Date('2026-11-04T10:00:00-03:00'),
            periodEnd: new Date('2026-11-04T14:00:00-03:00'),
          },
          check: /sales_mrcomanda_no_tip/,
        },
      ] as const;
      for (const caso of casos) {
        await withinRollback(async (tx) => {
          const { user, store } = await crearUsuarioBase(tx);
          const debito = await asegurarMedioDePago(tx, 'DEBIT_CARD');
          await expect(
            tx.sale.create({
              data: {
                storeId: store.id,
                soldAt: new Date('2026-11-04T14:00:00-03:00'),
                paymentMethodId: debito.id,
                grossAmount: 1000,
                registeredById: user.id,
                ...caso.data,
              },
            }),
          ).rejects.toThrow(caso.check);
        });
      }
    });

    it('reconcilia la venta solo con un registro del mismo local, medio y día (trigger con FK)', async () => {
      await withinRollback(async (tx) => {
        const { user, store } = await crearUsuarioBase(tx);
        const efectivo = await asegurarMedioDePago(tx, 'CASH');
        const debito = await asegurarMedioDePago(tx, 'DEBIT_CARD');

        const entrada = await tx.tipEntry.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            paymentMethodId: efectivo.id,
            amount: 1250,
            responsibleId: user.id,
          },
        });

        // Medio correcto: la venta se reconcilia con el registro diario.
        await expect(
          tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-09-24T13:30:00-03:00'),
              paymentMethodId: efectivo.id,
              grossAmount: 12500,
              tipAmount: 1250,
              registeredById: user.id,
              tipEntryId: entrada.id,
            },
          }),
        ).resolves.toBeDefined();

        // Medio distinto: el trigger rechaza la reconciliación.
        await expect(
          tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: new Date('2026-09-24T13:30:00-03:00'),
              paymentMethodId: debito.id,
              grossAmount: 12500,
              tipAmount: 1250,
              registeredById: user.id,
              tipEntryId: entrada.id,
            },
          }),
        ).rejects.toThrow(/local, fecha y medio de pago/);
      });
    });
  },
);
