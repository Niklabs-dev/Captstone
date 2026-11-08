import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { normalizeExternalLabel } from '../src/sales-imports/normalization/normalize-external-label.js';
import {
  BASE_PAYMENT_METHOD_ALIASES,
  BASE_PAYMENT_METHODS,
  BASE_ROLES,
  BASE_STORES,
  DOCUMENT_TYPES,
  seedDatabase,
  type SeedOptions,
  TIP_DEMO_AGREEMENT,
  TIP_DEMO_ENTRIES,
  TIP_DEMO_IDS,
  TIP_DEMO_PERIOD,
  TIP_DEMO_POOL,
  TIP_DEMO_POOL_SOURCES,
  TIP_DEMO_STORE,
  TIP_DEMO_USERS,
  TIP_DEMO_WORKER_PERIODS,
} from '../prisma/seed.js';

// Tests de integración del seed (SPRINT-1-T05) contra PostgreSQL real,
// ampliados con las fixtures sintéticas del módulo de propinas
// (SPRINT-3-T09). Se omiten si no se define TEST_DATABASE_URL y cada
// test corre dentro de una transacción que se revierte, por lo que no
// dejan datos en la base.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

// El seed completo (roles, locales, catálogo y fixtures de propinas) es
// lento bajo carga paralela: timeout acorde al resto de la suite.
describe.skipIf(!databaseUrl)(
  'Seed de datos base (SPRINT-1-T05)',
  { timeout: 60_000 },
  () => {
    let prisma: PrismaClient;

    const opciones: SeedOptions = {
      adminEmail: 'admin-seed@moi-food.cl',
      adminPassword: 'clave-de-prueba-seed',
      adminFirstName: 'Admin',
      adminLastName: 'Seed',
    };
    const opcionesDemo: SeedOptions = { ...opciones, includeDemoData: true };

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
        // El seed completo compite por locks de catálogo y roles con los
        // demás archivos que corren en paralelo: timeout acorde (el valor por
        // defecto de 5 s se agota esperando bajo carga).
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

    it('crea los cuatro roles base con su nombre y descripción', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);

        for (const esperado of BASE_ROLES) {
          const rol = await tx.role.findUniqueOrThrow({
            where: { code: esperado.code },
          });
          expect(rol.name).toBe(esperado.name);
          expect(rol.description).toBe(esperado.description);
          expect(rol.isActive).toBe(true);
        }
      });
    });

    it('crea el usuario administrador global con contraseña bcrypt verificable', async () => {
      await withinRollback(async (tx) => {
        const resultado = await seedDatabase(tx, opciones);
        expect(resultado.adminCreated).toBe(true);

        const admin = await tx.user.findUniqueOrThrow({
          where: { email: opciones.adminEmail },
          include: { role: true },
        });
        expect(admin.role.code).toBe('ADMINISTRADOR');
        // Usuario global: sin local asignado (dueño/administrador).
        expect(admin.storeId).toBeNull();
        expect(admin.isActive).toBe(true);
        expect(admin.rut).toBeNull();
        // Nunca se guarda la contraseña en claro y el hash es verificable.
        expect(admin.passwordHash).not.toBe(opciones.adminPassword);
        await expect(
          bcrypt.compare(opciones.adminPassword, admin.passwordHash),
        ).resolves.toBe(true);
        await expect(
          bcrypt.compare('otra-clave', admin.passwordHash),
        ).resolves.toBe(false);
      });
    });

    it('crea los tipos de documento laboral con conservación de 5 años', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);

        for (const esperado of DOCUMENT_TYPES) {
          const tipo = await tx.documentType.findUniqueOrThrow({
            where: { code: esperado.code },
          });
          expect(tipo.name).toBe(esperado.name);
          expect(tipo.description).toBe(esperado.description);
          expect(tipo.isActive).toBe(true);
          // Conservación laboral por defecto (art. 9 bis CT).
          expect(tipo.retentionYears).toBe(5);
        }

        // El permiso sanitario vence: exige alertas de expiración.
        const permiso = await tx.documentType.findUniqueOrThrow({
          where: { code: 'PERMISO_SANITARIO' },
        });
        expect(permiso.requiresExpiration).toBe(true);
        // Los documentos laborales del trabajador no vencen.
        const contrato = await tx.documentType.findUniqueOrThrow({
          where: { code: 'CONTRATO' },
        });
        expect(contrato.requiresExpiration).toBe(false);
      });
    });

    it('marca los tipos que deben registrarse en la DT dentro de 15 días (SPRINT-2-T03)', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);

        const tipos = await tx.documentType.findMany({
          where: { code: { in: DOCUMENT_TYPES.map((t) => t.code) } },
        });
        const conRegistro = tipos
          .filter((t) => t.requiresDtRegistration)
          .map((t) => t.code)
          .sort();
        // Contratos, sus modificaciones y su término; el resto no se registra en la DT.
        expect(conRegistro).toEqual(['ANEXO', 'CONTRATO', 'FINIQUITO']);
        // Los pactos laborales (E1-H3) existen como tipo de documento.
        expect(tipos.map((t) => t.code)).toContain('PACTO');
      });
    });

    it('crea los tres locales de Moi-food con su UUID fijo (SPRINT-2-T26)', async () => {
      await withinRollback(async (tx) => {
        for (const esperado of BASE_STORES) {
          await tx.store.upsert({
            where: { id: esperado.id },
            update: { ...esperado, isActive: true },
            create: { ...esperado },
          });
        }

        const resultado = await seedDatabase(tx, opciones);
        expect(resultado.storeIds).toEqual(BASE_STORES.map((s) => s.id));

        for (const esperado of BASE_STORES) {
          const local = await tx.store.findUniqueOrThrow({
            where: { id: esperado.id },
          });
          expect(local.name).toBe(esperado.name);
          expect(local.city).toBe(esperado.city);
          expect(local.address).toBe(esperado.address);
          expect(local.isActive).toBe(true);
        }
      });
    });

    it('no duplica los locales ni sobrescribe sus cambios administrativos', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);
        await tx.store.update({
          where: { id: BASE_STORES[0].id },
          data: {
            name: 'Nombre administrado',
            city: 'Ciudad administrada',
            address: 'Dirección administrada',
            isActive: false,
          },
        });

        await seedDatabase(tx, opciones);

        const locales = await tx.store.findMany({
          where: { id: { in: BASE_STORES.map((s) => s.id) } },
        });
        expect(locales).toHaveLength(BASE_STORES.length);
        const administrado = await tx.store.findUniqueOrThrow({
          where: { id: BASE_STORES[0].id },
        });
        expect(administrado).toMatchObject({
          name: 'Nombre administrado',
          city: 'Ciudad administrada',
          address: 'Dirección administrada',
          isActive: false,
        });
      });
    });

    it('es idempotente: no duplica roles ni crea un segundo administrador', async () => {
      await withinRollback(async (tx) => {
        const primera = await seedDatabase(tx, opciones);
        const segunda = await seedDatabase(tx, opciones);

        expect(segunda.adminCreated).toBe(false);
        expect(segunda.adminUserId).toBe(primera.adminUserId);
        expect(segunda.roleIds).toEqual(primera.roleIds);
        expect(segunda.documentTypeIds).toEqual(primera.documentTypeIds);

        const admins = await tx.user.findMany({
          where: { email: opciones.adminEmail },
        });
        expect(admins).toHaveLength(1);
      });
    });

    it('no sobrescribe la contraseña de un administrador ya existente', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);
        const hashCambiado = await bcrypt.hash(
          'clave-cambiada-por-el-admin',
          12,
        );
        await tx.user.update({
          where: { email: opciones.adminEmail },
          data: { passwordHash: hashCambiado },
        });

        const resultado = await seedDatabase(tx, {
          ...opciones,
          adminPassword: 'otra-clave-distinta',
        });
        expect(resultado.adminCreated).toBe(false);

        const admin = await tx.user.findUniqueOrThrow({
          where: { email: opciones.adminEmail },
        });
        expect(admin.passwordHash).toBe(hashCambiado);
      });
    });

    it('reactualiza nombre y descripción de un rol si cambiaron', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);
        await tx.role.update({
          where: { code: 'TRABAJADOR' },
          data: { name: 'Nombre antiguo', isActive: false },
        });

        await seedDatabase(tx, { ...opciones, adminEmail: 'otro@moi-food.cl' });

        const rol = await tx.role.findUniqueOrThrow({
          where: { code: 'TRABAJADOR' },
        });
        expect(rol.name).toBe('Trabajador');
        expect(rol.isActive).toBe(true);
      });
    });

    it('no siembra usuarios ni propinas demo cuando la opción está apagada', async () => {
      await withinRollback(async (tx) => {
        async function countDemoData(): Promise<number[]> {
          return Promise.all([
            tx.user.count({
              where: { id: { in: TIP_DEMO_USERS.map((demo) => demo.id) } },
            }),
            tx.tipEntry.count({
              where: { id: { in: TIP_DEMO_ENTRIES.map((entry) => entry.id) } },
            }),
            tx.tipAgreement.count({ where: { id: TIP_DEMO_AGREEMENT.id } }),
            tx.workHoursRecord.count({
              where: {
                id: {
                  in: TIP_DEMO_WORKER_PERIODS.map((period) => period.hoursId),
                },
              },
            }),
            tx.tipPool.count({ where: { id: TIP_DEMO_POOL.id } }),
            tx.tipPoolSource.count({
              where: {
                id: { in: TIP_DEMO_POOL_SOURCES.map((source) => source.id) },
              },
            }),
          ]);
        }

        const before = await countDemoData();
        await seedDatabase(tx, opciones);
        expect(await countDemoData()).toEqual(before);
      });
    });

    it('siembra las fixtures de propinas con sus relaciones completas (SPRINT-3-T09)', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opcionesDemo);

        // Pacto demo vigente en el local demo, creado por el supervisor demo.
        const pacto = await tx.tipAgreement.findUniqueOrThrow({
          where: { id: TIP_DEMO_AGREEMENT.id },
        });
        expect(pacto.name).toBe(TIP_DEMO_AGREEMENT.name);
        expect(pacto.rule).toBe('PROPORTIONAL_TO_HOURS');
        expect(pacto.validFrom).toEqual(new Date('2026-01-01T00:00:00.000Z'));
        expect(pacto.validTo).toEqual(new Date('2026-12-31T00:00:00.000Z'));
        expect(pacto.storeId).toBe(TIP_DEMO_STORE.id);
        expect(pacto.createdById).toBe(TIP_DEMO_IDS.supervisor);

        // Entradas diarias con fecha, medio de pago, monto y responsable demo.
        for (const esperada of TIP_DEMO_ENTRIES) {
          const entrada = await tx.tipEntry.findUniqueOrThrow({
            where: { id: esperada.id },
          });
          expect(entrada.businessDate).toEqual(esperada.businessDate);
          // El medio se resuelve contra el catálogo por su código.
          const medioEsperado = BASE_PAYMENT_METHODS.find(
            (m) => m.code === esperada.paymentMethod,
          );
          expect(medioEsperado).toBeDefined();
          expect(entrada.paymentMethodId).toBe(medioEsperado?.id);
          expect(Number(entrada.amount)).toBe(esperada.amount);
          expect(entrada.storeId).toBe(TIP_DEMO_STORE.id);
          expect(entrada.responsibleId).toBe(TIP_DEMO_IDS.supervisor);
        }

        // Horas trabajadas por cada trabajador demo, registradas por el supervisor.
        for (const esperada of TIP_DEMO_WORKER_PERIODS) {
          const horas = await tx.workHoursRecord.findUniqueOrThrow({
            where: { id: esperada.hoursId },
          });
          expect(horas.workerId).toBe(esperada.workerId);
          expect(horas.recordedById).toBe(TIP_DEMO_IDS.supervisor);
          expect(horas.periodStart).toEqual(TIP_DEMO_PERIOD.start);
          expect(horas.periodEnd).toEqual(TIP_DEMO_PERIOD.end);
          expect(Number(horas.hoursWorked)).toBe(esperada.hoursWorked);
        }

        // Reparto DRAFT: total, snapshot del pacto aplicado y vínculo al pacto.
        const pool = await tx.tipPool.findUniqueOrThrow({
          where: { id: TIP_DEMO_POOL.id },
        });
        expect(pool.status).toBe('DRAFT');
        expect(Number(pool.totalAmount)).toBe(TIP_DEMO_POOL.totalAmount);
        expect(pool.periodStart).toEqual(TIP_DEMO_PERIOD.start);
        expect(pool.periodEnd).toEqual(TIP_DEMO_PERIOD.end);
        expect(pool.storeId).toBe(TIP_DEMO_STORE.id);
        expect(pool.calculatedById).toBe(TIP_DEMO_IDS.supervisor);
        expect(pool.agreementId).toBe(TIP_DEMO_AGREEMENT.id);
        expect(pool.agreementSnapshot).toEqual(TIP_DEMO_POOL.agreementSnapshot);

        // Líneas: cada trabajador con su monto y su registro de horas fuente.
        for (const esperada of TIP_DEMO_WORKER_PERIODS) {
          const linea = await tx.tipPoolLine.findUniqueOrThrow({
            where: { id: esperada.lineId },
          });
          expect(linea.poolId).toBe(TIP_DEMO_POOL.id);
          expect(linea.userId).toBe(esperada.workerId);
          expect(linea.workHoursRecordId).toBe(esperada.hoursId);
          expect(Number(linea.hoursWorked)).toBe(esperada.hoursWorked);
          expect(Number(linea.amount)).toBe(esperada.lineAmount);
        }

        // Fuentes: cada entrada diaria enlaza el pool con su registro diario.
        for (const esperada of TIP_DEMO_POOL_SOURCES) {
          const fuente = await tx.tipPoolSource.findUniqueOrThrow({
            where: { id: esperada.id },
          });
          expect(fuente.poolId).toBe(TIP_DEMO_POOL.id);
          expect(fuente.tipEntryId).toBe(esperada.entryId);
          expect(Number(fuente.amount)).toBe(esperada.amount);
        }
      });
    });

    it('las fixtures de propinas usan solo datos sintéticos (SPRINT-3-T09)', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opcionesDemo);

        for (const demo of TIP_DEMO_USERS) {
          const usuario = await tx.user.findUniqueOrThrow({
            where: { id: demo.id },
          });
          // Correo claramente demo: dominio .invalid reservado (RFC 2606).
          expect(usuario.email).toBe(demo.email);
          expect(usuario.email.endsWith('.invalid')).toBe(true);
          expect(`${usuario.firstName} ${usuario.lastName}`).toContain('Demo');
          // Sin RUT ni teléfono de personas reales; asignados al local demo.
          expect(usuario.rut).toBeNull();
          expect(usuario.phone).toBeNull();
          expect(usuario.storeId).toBe(TIP_DEMO_STORE.id);
          expect(usuario.isActive).toBe(true);
          // Contraseña aleatoria solo al crear: hash bcrypt, nunca en claro.
          expect(usuario.passwordHash).toMatch(/^\$2[ab]\$\d{2}\$/);
        }

        // Ningún correo fixture pertenece al dominio real de la empresa.
        const usuariosDemo = await tx.user.findMany({
          where: { id: { in: TIP_DEMO_USERS.map((u) => u.id) } },
        });
        expect(usuariosDemo).toHaveLength(TIP_DEMO_USERS.length);
        for (const usuario of usuariosDemo) {
          expect(usuario.email.endsWith('@moi-food.invalid')).toBe(true);
        }
      });
    });

    it('las fixtures de propinas son idempotentes y respetan cambios administrados (SPRINT-3-T09)', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opcionesDemo);

        // Cambio administrado vía API sobre una entrada fixture.
        const montoCorregido = 77777;
        await tx.tipEntry.update({
          where: { id: TIP_DEMO_IDS.entryCash },
          data: { amount: montoCorregido },
        });

        await seedDatabase(tx, opcionesDemo);

        // Mismos conteos de las filas propias del seed: nada se duplica al
        // repetirlo (se cuentan por UUID fijo para no mezclar datos ajenos
        // que ya existan en la base).
        const [pactos, entradas, horas, pools, lineas, fuentes, usuariosDemo] =
          await Promise.all([
            tx.tipAgreement.count({
              where: { id: TIP_DEMO_AGREEMENT.id },
            }),
            tx.tipEntry.count({
              where: { id: { in: TIP_DEMO_ENTRIES.map((e) => e.id) } },
            }),
            tx.workHoursRecord.count({
              where: {
                id: { in: TIP_DEMO_WORKER_PERIODS.map((r) => r.hoursId) },
              },
            }),
            tx.tipPool.count({ where: { id: TIP_DEMO_POOL.id } }),
            tx.tipPoolLine.count({ where: { poolId: TIP_DEMO_POOL.id } }),
            tx.tipPoolSource.count({ where: { poolId: TIP_DEMO_POOL.id } }),
            tx.user.count({
              where: { id: { in: TIP_DEMO_USERS.map((u) => u.id) } },
            }),
          ]);
        expect(pactos).toBe(1);
        expect(entradas).toBe(TIP_DEMO_ENTRIES.length);
        expect(horas).toBe(TIP_DEMO_WORKER_PERIODS.length);
        expect(pools).toBe(1);
        expect(lineas).toBe(TIP_DEMO_WORKER_PERIODS.length);
        expect(fuentes).toBe(TIP_DEMO_POOL_SOURCES.length);
        expect(usuariosDemo).toBe(TIP_DEMO_USERS.length);

        // El ID sigue siendo el fijo y el cambio administrado no se sobrescribe.
        const entrada = await tx.tipEntry.findUniqueOrThrow({
          where: { id: TIP_DEMO_IDS.entryCash },
        });
        expect(entrada.id).toBe(TIP_DEMO_IDS.entryCash);
        expect(Number(entrada.amount)).toBe(montoCorregido);
      });
    });

    it('crea el catálogo base de medios de pago con orden, comportamiento y propinas (SPRINT-4-T32)', async () => {
      await withinRollback(async (tx) => {
        const resultado = await seedDatabase(tx, opciones);

        expect(resultado.paymentMethodIds).toEqual(
          Object.fromEntries(BASE_PAYMENT_METHODS.map((m) => [m.code, m.id])),
        );
        for (const esperado of BASE_PAYMENT_METHODS) {
          const medio = await tx.paymentMethod.findUniqueOrThrow({
            where: { code: esperado.code },
          });
          expect(medio.id).toBe(esperado.id);
          expect(medio.name).toBe(esperado.name);
          expect(medio.sortOrder).toBe(esperado.sortOrder);
          expect(medio.behavior).toBe(esperado.behavior);
          // Los cuatro medios iniciales aceptan propinas, como el enum anterior.
          expect(medio.availableForTips).toBe(true);
          expect(medio.isActive).toBe(true);
        }
      });
    });

    it('el catálogo de medios de pago es idempotente y no revierte la administración (SPRINT-4-T32)', async () => {
      await withinRollback(async (tx) => {
        await seedDatabase(tx, opciones);

        // Cambio administrado vía API: renombrar, reordenar y desactivar un
        // medio, y crear uno nuevo (Junaeb, sin propinas).
        await tx.paymentMethod.update({
          where: { code: 'CASH' },
          data: {
            name: 'Efectivo administrado',
            sortOrder: 99,
            isActive: false,
          },
        });
        await tx.paymentMethod.create({
          data: {
            code: 'JUNAEB',
            name: 'Junaeb',
            sortOrder: 50,
            behavior: 'EXTERNAL_OTHER',
            availableForTips: false,
          },
        });

        await seedDatabase(tx, opciones);

        // Nada se duplica y los cambios administrados se respetan.
        const medios = await tx.paymentMethod.findMany({
          where: {
            code: {
              in: [...BASE_PAYMENT_METHODS.map((m) => m.code), 'JUNAEB'],
            },
          },
        });
        expect(medios).toHaveLength(BASE_PAYMENT_METHODS.length + 1);
        const efectivo = await tx.paymentMethod.findUniqueOrThrow({
          where: { code: 'CASH' },
        });
        expect(efectivo.name).toBe('Efectivo administrado');
        expect(efectivo.sortOrder).toBe(99);
        expect(efectivo.isActive).toBe(false);
        const juneb = await tx.paymentMethod.findUniqueOrThrow({
          where: { code: 'JUNAEB' },
        });
        expect(juneb.availableForTips).toBe(false);
      });
    });

    it('siembra los alias MrComanda conocidos sin asignar locales por suposición (SPRINT-4R-T08)', async () => {
      await withinRollback(async (tx) => {
        const resultado = await seedDatabase(tx, opciones);

        for (const esperado of BASE_PAYMENT_METHOD_ALIASES) {
          // El valor sembrado ya viene normalizado con la misma regla de la
          // función SQL (el CHECK de la base lo rechazaría si no).
          expect(esperado.normalizedLabel).toBe(
            normalizeExternalLabel(esperado.label),
          );
          const alias = await tx.paymentMethodAlias.findUniqueOrThrow({
            where: {
              system_normalizedLabel: {
                system: 'MRCOMANDA',
                normalizedLabel: esperado.normalizedLabel,
              },
            },
          });
          expect(alias.id).toBe(esperado.id);
          expect(alias.paymentMethodId).toBe(
            resultado.paymentMethodIds[esperado.paymentMethodCode],
          );
        }
        // «N.de Créd.» no tiene medio equivalente definido: no se siembra.
        const notaCredito = await tx.paymentMethodAlias.findUnique({
          where: {
            system_normalizedLabel: {
              system: 'MRCOMANDA',
              normalizedLabel: normalizeExternalLabel('N.de Créd.'),
            },
          },
        });
        expect(notaCredito).toBeNull();
        // Ningún local recibe un identificador MrComanda desde el seed.
        const codigos = await tx.storeExternalCode.count({
          where: { storeId: { in: resultado.storeIds } },
        });
        expect(codigos).toBe(0);
      });
    });

    it('los alias MrComanda son idempotentes y respetan cambios administrados (SPRINT-4R-T08)', async () => {
      await withinRollback(async (tx) => {
        const primero = await seedDatabase(tx, opciones);
        // Cambio administrado: «T. CREDITO» pasa a apuntar a otro medio.
        await tx.paymentMethodAlias.update({
          where: { id: BASE_PAYMENT_METHOD_ALIASES[2].id },
          data: { paymentMethodId: primero.paymentMethodIds['TRANSFER'] },
        });

        await seedDatabase(tx, opciones);

        const alias = await tx.paymentMethodAlias.findMany({
          where: { id: { in: BASE_PAYMENT_METHOD_ALIASES.map((a) => a.id) } },
        });
        expect(alias).toHaveLength(BASE_PAYMENT_METHOD_ALIASES.length);
        const credito = await tx.paymentMethodAlias.findUniqueOrThrow({
          where: { id: BASE_PAYMENT_METHOD_ALIASES[2].id },
        });
        expect(credito.paymentMethodId).toBe(
          primero.paymentMethodIds['TRANSFER'],
        );
      });
    });
  },
);
