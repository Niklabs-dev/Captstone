import { PrismaPg } from '@prisma/adapter-pg';
import {
  DataRightType,
  DocumentStatus,
  InventoryMovementType,
  PaymentMethod,
  Prisma,
  PrismaClient,
  SaleChannel,
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

describe.skipIf(!databaseUrl)('Integración con PostgreSQL', () => {
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

  async function crearUsuarioBase(tx: Prisma.TransactionClient) {
    const store = await tx.store.create({
      data: {
        name: 'Subway Melipilla Centro',
        city: 'Melipilla',
        address: 'Av. Vicuña Mackenna 123',
      },
    });
    const role = await tx.role.create({
      data: { code: 'TRABAJADOR', name: 'Trabajador' },
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
      const tipo = await tx.documentType.create({
        data: { code: 'CONTRATO', name: 'Contrato de trabajo' },
      });
      expect(tipo.retentionYears).toBe(5);

      const documento = await tx.document.create({
        data: {
          title: 'Contrato Ana Pérez',
          storeId: store.id,
          subjectUserId: user.id,
          documentTypeId: tipo.id,
          createdById: user.id,
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
      const tipo = await tx.documentType.create({
        data: { code: 'FINIQUITO', name: 'Finiquito' },
      });
      const documento = await tx.document.create({
        data: {
          title: 'Finiquito',
          storeId: store.id,
          documentTypeId: tipo.id,
          createdById: user.id,
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
      const tipo = await tx.documentType.create({
        data: { code: 'ANEXO', name: 'Anexo de contrato' },
      });
      const documento = await tx.document.create({
        data: {
          title: 'Anexo',
          storeId: store.id,
          documentTypeId: tipo.id,
          createdById: user.id,
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
          openingCash: 50000,
          systemCash: 250000,
          responsibleId: user.id,
        },
      });
      expect(cierre.status).toBe('OPEN');

      await expect(
        tx.cashClosing.create({
          data: {
            storeId: store.id,
            businessDate: new Date('2026-09-24'),
            openingCash: 50000,
            systemCash: 100000,
            responsibleId: user.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  it('registra venta con propina asociada a un cierre de caja', async () => {
    await withinRollback(async (tx) => {
      const { user, store } = await crearUsuarioBase(tx);
      const cierre = await tx.cashClosing.create({
        data: {
          storeId: store.id,
          businessDate: new Date('2026-09-24'),
          openingCash: 50000,
          systemCash: 150000,
          responsibleId: user.id,
        },
      });
      const venta = await tx.sale.create({
        data: {
          storeId: store.id,
          soldAt: new Date('2026-09-24T13:30:00-03:00'),
          paymentMethod: PaymentMethod.CARD,
          channel: SaleChannel.IN_STORE,
          grossAmount: 12500,
          tipAmount: 1250,
          cashClosingId: cierre.id,
          registeredById: user.id,
        },
      });
      expect(Number(venta.tipAmount)).toBe(1250);
    });
  });

  it('calcula stock desde movimientos y registra conteo físico con diferencia', async () => {
    await withinRollback(async (tx) => {
      const { user, store } = await crearUsuarioBase(tx);
      const pan = await tx.product.create({
        data: {
          sku: 'PAN-ITALIANO',
          name: 'Pan italiano',
          unit: UnitOfMeasure.UNIT,
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
        data: { storeId: store.id, createdById: user.id },
      });
      const linea = await tx.inventoryCountLine.create({
        data: {
          countId: conteo.id,
          productId: pan.id,
          systemQuantity: stock,
          countedQuantity: 33,
          difference: -2,
        },
      });
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
});
