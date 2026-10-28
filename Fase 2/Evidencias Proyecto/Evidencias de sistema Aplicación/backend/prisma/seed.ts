// =============================================================
// Seed de datos base: roles del sistema, usuario administrador
// inicial y tipos de documento laboral (SPRINT-1-T05), los tres
// locales de Moi-food (SPRINT-2-T26) y las fixtures sintéticas del
// módulo de propinas (SPRINT-3-T09): pacto de reparto, entradas
// diarias, horas trabajadas y un reparto DRAFT con sus fuentes y
// líneas en el primer local.
//
// Ejecución: `npm run prisma:seed` (o `npx prisma db seed`).
// El script es idempotente: roles y tipos de documento se
// sincronizan por `code` (upsert); locales y fixtures de propinas
// por su UUID fijo con `update: {}` (no revierten cambios
// administrados por la API); el administrador solo se crea si el
// correo no existe, sin sobrescribir la contraseña de un usuario
// ya registrado. Las fixtures de propinas se siembran solo con
// SEED_DEMO_DATA=true y usan datos sintéticos (correos .invalid y
// contraseñas aleatorias no divulgadas); en producción quedan apagadas.
// =============================================================
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

// Factor de costo bcrypt acorde a la guía de seguridad del proyecto (>= 12).
const BCRYPT_ROUNDS = 12;

// Roles base del sistema (E1-H1): el dueño opera como administrador; el
// supervisor de turno y el trabajador se asignan por local; el contador es
// un usuario global al igual que el administrador.
export const BASE_ROLES = [
  {
    code: 'ADMINISTRADOR',
    name: 'Dueño/Administrador',
    description: 'Acceso total al sistema; usuario global sin local asignado.',
  },
  {
    code: 'SUPERVISOR',
    name: 'Supervisor de turno',
    description:
      'Gestiona ventas, cierre de caja e inventario de su local asignado.',
  },
  {
    code: 'TRABAJADOR',
    name: 'Trabajador',
    description: 'Accede al Portal del Trabajador: sus documentos y propinas.',
  },
  {
    code: 'CONTADOR',
    name: 'Contador',
    description:
      'Usuario global con acceso de consulta a ventas, propinas y auditoría.',
  },
] as const;

// Tipos de documento laboral del Gestor Documental. La conservación de 5 años
// corresponde al art. 9 bis del Código del Trabajo; requiresExpiration activa
// las alertas de vencimiento sobre documents.expires_at y requiresDtRegistration
// las de registro en la Dirección del Trabajo dentro de 15 días (contratos, sus
// modificaciones y su término; SPRINT-2-T03).
export const DOCUMENT_TYPES = [
  {
    code: 'CONTRATO',
    name: 'Contrato de trabajo',
    description: 'Contrato de trabajo firmado entre Moi-food y el trabajador.',
    requiresExpiration: false,
    requiresDtRegistration: true,
    retentionYears: 5,
  },
  {
    code: 'ANEXO',
    name: 'Anexo de contrato',
    description: 'Anexo que modifica o complementa el contrato vigente.',
    requiresExpiration: false,
    requiresDtRegistration: true,
    retentionYears: 5,
  },
  {
    code: 'PACTO',
    name: 'Pacto laboral',
    description:
      'Pacto acordado con el trabajador (ej. horas extraordinarias o jornada).',
    requiresExpiration: false,
    requiresDtRegistration: false,
    retentionYears: 5,
  },
  {
    code: 'FINIQUITO',
    name: 'Finiquito',
    description:
      'Finiquito ratificado ante notario al término de la relación laboral.',
    requiresExpiration: false,
    requiresDtRegistration: true,
    retentionYears: 5,
  },
  {
    code: 'LIQUIDACION',
    name: 'Liquidación de sueldo',
    description: 'Liquidación mensual de remuneraciones del trabajador.',
    requiresExpiration: false,
    requiresDtRegistration: false,
    retentionYears: 5,
  },
  {
    code: 'PERMISO_SANITARIO',
    name: 'Permiso sanitario',
    description:
      'Permiso sanitario del local; documento del local (sin trabajador titular).',
    requiresExpiration: true,
    requiresDtRegistration: false,
    retentionYears: 5,
  },
] as const;

// Locales iniciales de Moi-food (SPRINT-2-T26). Los UUID fijos mantienen la
// idempotencia y la coincidencia con los catálogos de docker-compose.yml.
// Desde SPRINT-3-T01 el seed solo crea los ausentes: no revierte los cambios
// administrados por API. Las direcciones iniciales son provisionales.
export const BASE_STORES = [
  {
    id: '1010021e-9bab-42d5-851c-417e9e2503bf',
    name: 'Santa María',
    city: 'Melipilla',
    address: 'Av. Santa María 1250',
  },
  {
    id: '73b590e0-11b2-4781-ba7b-4f7f8c2c6e35',
    name: 'Ugalde',
    city: 'Melipilla',
    address: 'Ugalde 680',
  },
  {
    id: '9ba7ac40-9463-47ec-b0b1-e53c79a185f9',
    name: 'Calera',
    city: 'Quillota',
    address: 'Av. Marathon 1450',
  },
] as const;

// -------------------------------------------------------------
// Datos sintéticos del módulo de propinas (SPRINT-3-T09): pacto
// vigente, entradas diarias, horas trabajadas y reparto de ejemplo
// para desarrollo y pruebas. Todo vive en BASE_STORES[0] con UUID
// fijos y correos .invalid (dominio reservado, RFC 2606): no usa
// datos reales de personas. Los tests importan estas constantes
// para verificar los valores sin duplicar la configuración.
// -------------------------------------------------------------

// Local que aloja las fixtures demo de propinas.
export const TIP_DEMO_STORE = BASE_STORES[0];

// UUID fijos (patrón a9000000-…) de usuarios y registros demo.
export const TIP_DEMO_IDS = {
  supervisor: 'a9000000-0000-4000-8000-000000000001',
  workerOne: 'a9000000-0000-4000-8000-000000000002',
  workerTwo: 'a9000000-0000-4000-8000-000000000003',
  agreement: 'a9000000-0000-4000-8000-000000000004',
  entryCash: 'a9000000-0000-4000-8000-000000000005',
  entryDebit: 'a9000000-0000-4000-8000-000000000006',
  hoursOne: 'a9000000-0000-4000-8000-000000000007',
  hoursTwo: 'a9000000-0000-4000-8000-000000000008',
  pool: 'a9000000-0000-4000-8000-000000000009',
  poolLineOne: 'a9000000-0000-4000-8000-00000000000a',
  poolLineTwo: 'a9000000-0000-4000-8000-00000000000b',
  poolSourceCash: 'a9000000-0000-4000-8000-00000000000c',
  poolSourceDebit: 'a9000000-0000-4000-8000-00000000000d',
} as const;

// Período común del reparto demo y de las horas trabajadas.
export const TIP_DEMO_PERIOD = {
  start: new Date('2026-01-05T00:00:00.000Z'),
  end: new Date('2026-01-11T00:00:00.000Z'),
} as const;

// Pacto demo: reparto proporcional a las horas, vigente todo 2026.
export const TIP_DEMO_AGREEMENT = {
  id: TIP_DEMO_IDS.agreement,
  name: 'Pacto de reparto proporcional a horas (demo)',
  rule: 'PROPORTIONAL_TO_HOURS' as const,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: new Date('2026-12-31T00:00:00.000Z'),
} as const;

// Usuarios sintéticos del local demo: un supervisor y dos trabajadores.
// Contraseña aleatoria no divulgada: los usuarios demo no pueden
// autenticarse (su hash se genera solo al crearlos).
export const TIP_DEMO_USERS = [
  {
    id: TIP_DEMO_IDS.supervisor,
    email: 'supervisor.demo@moi-food.invalid',
    firstName: 'Supervisor',
    lastName: 'Demo',
    roleCode: 'SUPERVISOR',
  },
  {
    id: TIP_DEMO_IDS.workerOne,
    email: 'trabajador.demo1@moi-food.invalid',
    firstName: 'Trabajador',
    lastName: 'Demo Uno',
    roleCode: 'TRABAJADOR',
  },
  {
    id: TIP_DEMO_IDS.workerTwo,
    email: 'trabajador.demo2@moi-food.invalid',
    firstName: 'Trabajador',
    lastName: 'Demo Dos',
    roleCode: 'TRABAJADOR',
  },
] as const;

// Entradas diarias de propinas demo (2026-01-05 y 2026-01-06).
export const TIP_DEMO_ENTRIES = [
  {
    id: TIP_DEMO_IDS.entryCash,
    businessDate: new Date('2026-01-05T00:00:00.000Z'),
    paymentMethod: 'CASH' as const,
    amount: 10000,
  },
  {
    id: TIP_DEMO_IDS.entryDebit,
    businessDate: new Date('2026-01-06T00:00:00.000Z'),
    paymentMethod: 'DEBIT_CARD' as const,
    amount: 15000,
  },
] as const;

// Horas trabajadas por cada trabajador demo en el período y su línea
// de reparto (proporcional a las horas: 40/60 sobre un total de 25000).
export const TIP_DEMO_WORKER_PERIODS = [
  {
    hoursId: TIP_DEMO_IDS.hoursOne,
    workerId: TIP_DEMO_IDS.workerOne,
    hoursWorked: 40,
    lineId: TIP_DEMO_IDS.poolLineOne,
    lineAmount: 10000,
  },
  {
    hoursId: TIP_DEMO_IDS.hoursTwo,
    workerId: TIP_DEMO_IDS.workerTwo,
    hoursWorked: 60,
    lineId: TIP_DEMO_IDS.poolLineTwo,
    lineAmount: 15000,
  },
] as const;

// Reparto demo (DRAFT): suma las dos entradas diarias (25000) y
// conserva el pacto aplicado como snapshot JSON.
export const TIP_DEMO_POOL = {
  id: TIP_DEMO_IDS.pool,
  totalAmount: 25000,
  status: 'DRAFT' as const,
  notes: 'Reparto demo con datos sintéticos (SPRINT-3-T09)',
  agreementSnapshot: {
    id: TIP_DEMO_AGREEMENT.id,
    name: TIP_DEMO_AGREEMENT.name,
    rule: TIP_DEMO_AGREEMENT.rule,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
  },
} as const;

// Fuentes del reparto demo: cada entrada diaria se usa una sola vez.
export const TIP_DEMO_POOL_SOURCES = [
  {
    id: TIP_DEMO_IDS.poolSourceCash,
    entryId: TIP_DEMO_IDS.entryCash,
    amount: 10000,
  },
  {
    id: TIP_DEMO_IDS.poolSourceDebit,
    entryId: TIP_DEMO_IDS.entryDebit,
    amount: 15000,
  },
] as const;

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
  includeDemoData?: boolean;
}

export interface SeedResult {
  roleIds: Record<string, string>;
  documentTypeIds: Record<string, string>;
  storeIds: string[];
  adminUserId: string;
  adminCreated: boolean;
}

// Acepta el cliente completo o una transacción (los tests de integración
// corren el seed dentro de una transacción que se revierte).
type SeedClient = PrismaClient | Prisma.TransactionClient;

export async function seedDatabase(
  db: SeedClient,
  options: SeedOptions,
): Promise<SeedResult> {
  const roleIds: Record<string, string> = {};
  for (const role of BASE_ROLES) {
    const guardado = await db.role.upsert({
      where: { code: role.code },
      update: {
        name: role.name,
        description: role.description,
        isActive: true,
      },
      create: { ...role },
    });
    roleIds[guardado.code] = guardado.id;
  }

  const documentTypeIds: Record<string, string> = {};
  for (const tipo of DOCUMENT_TYPES) {
    const guardado = await db.documentType.upsert({
      where: { code: tipo.code },
      update: {
        name: tipo.name,
        description: tipo.description,
        requiresExpiration: tipo.requiresExpiration,
        requiresDtRegistration: tipo.requiresDtRegistration,
        retentionYears: tipo.retentionYears,
        isActive: true,
      },
      create: { ...tipo },
    });
    documentTypeIds[guardado.code] = guardado.id;
  }

  const storeIds: string[] = [];
  for (const local of BASE_STORES) {
    const guardado = await db.store.upsert({
      where: { id: local.id },
      update: {},
      create: { ...local },
    });
    storeIds.push(guardado.id);
  }

  // Los datos demo son opt-in para no introducir usuarios, pactos ni
  // propinas artificiales en despliegues productivos.
  if (options.includeDemoData === true) {
    await seedTipDemoFixtures(db, roleIds);
  }

  const existente = await db.user.findUnique({
    where: { email: options.adminEmail },
  });
  if (existente) {
    return {
      roleIds,
      documentTypeIds,
      storeIds,
      adminUserId: existente.id,
      adminCreated: false,
    };
  }

  // storeId queda NULL: el administrador es un usuario global (ver schema).
  const admin = await db.user.create({
    data: {
      email: options.adminEmail,
      passwordHash: await bcrypt.hash(options.adminPassword, BCRYPT_ROUNDS),
      firstName: options.adminFirstName,
      lastName: options.adminLastName,
      roleId: roleIds['ADMINISTRADOR'],
    },
  });
  return {
    roleIds,
    documentTypeIds,
    storeIds,
    adminUserId: admin.id,
    adminCreated: true,
  };
}

// Siembra las fixtures sintéticas del módulo de propinas (SPRINT-3-T09) en
// el local demo. Todo se upsertea por UUID fijo con `update: {}`: repetir el
// seed no duplica filas ni revierte cambios administrados por la API. Los
// usuarios demo reciben una contraseña aleatoria (bcrypt) solo al crearse y
// jamás se divulga ni se reemplaza la de un usuario existente.
async function seedTipDemoFixtures(
  db: SeedClient,
  roleIds: Record<string, string>,
): Promise<void> {
  const storeId = TIP_DEMO_STORE.id;

  for (const demo of TIP_DEMO_USERS) {
    await db.user.upsert({
      where: { id: demo.id },
      update: {},
      create: {
        id: demo.id,
        email: demo.email,
        passwordHash: await bcrypt.hash(
          randomBytes(32).toString('hex'),
          BCRYPT_ROUNDS,
        ),
        firstName: demo.firstName,
        lastName: demo.lastName,
        roleId: roleIds[demo.roleCode],
        storeId,
      },
    });
  }

  await db.tipAgreement.upsert({
    where: { id: TIP_DEMO_AGREEMENT.id },
    update: {},
    create: {
      id: TIP_DEMO_AGREEMENT.id,
      name: TIP_DEMO_AGREEMENT.name,
      rule: TIP_DEMO_AGREEMENT.rule,
      validFrom: TIP_DEMO_AGREEMENT.validFrom,
      validTo: TIP_DEMO_AGREEMENT.validTo,
      storeId,
      createdById: TIP_DEMO_IDS.supervisor,
    },
  });

  for (const entrada of TIP_DEMO_ENTRIES) {
    await db.tipEntry.upsert({
      where: { id: entrada.id },
      update: {},
      create: {
        id: entrada.id,
        businessDate: entrada.businessDate,
        paymentMethod: entrada.paymentMethod,
        amount: entrada.amount,
        storeId,
        responsibleId: TIP_DEMO_IDS.supervisor,
      },
    });
  }

  for (const registro of TIP_DEMO_WORKER_PERIODS) {
    await db.workHoursRecord.upsert({
      where: { id: registro.hoursId },
      update: {},
      create: {
        id: registro.hoursId,
        periodStart: TIP_DEMO_PERIOD.start,
        periodEnd: TIP_DEMO_PERIOD.end,
        hoursWorked: registro.hoursWorked,
        storeId,
        workerId: registro.workerId,
        recordedById: TIP_DEMO_IDS.supervisor,
      },
    });
  }

  // El reparto demo, sus líneas y sus fuentes se crean solo si el reparto no
  // existe (SPRINT-3-T13): una vez creado su ciclo lo administra la API
  // (recálculo, confirmación y pago) y los triggers impiden tocar la foto de
  // un reparto confirmado o pagado, así que repetir el seed no lo modifica.
  const existingPool = await db.tipPool.findUnique({
    where: { id: TIP_DEMO_POOL.id },
    select: { id: true },
  });
  if (existingPool) return;

  await db.tipPool.create({
    data: {
      id: TIP_DEMO_POOL.id,
      periodStart: TIP_DEMO_PERIOD.start,
      periodEnd: TIP_DEMO_PERIOD.end,
      totalAmount: TIP_DEMO_POOL.totalAmount,
      status: TIP_DEMO_POOL.status,
      notes: TIP_DEMO_POOL.notes,
      // El spread materializa el snapshot como objeto mutable JSON.
      agreementSnapshot: { ...TIP_DEMO_POOL.agreementSnapshot },
      storeId,
      calculatedById: TIP_DEMO_IDS.supervisor,
      agreementId: TIP_DEMO_AGREEMENT.id,
    },
  });

  await db.tipPoolLine.createMany({
    data: TIP_DEMO_WORKER_PERIODS.map((registro) => ({
      id: registro.lineId,
      poolId: TIP_DEMO_POOL.id,
      userId: registro.workerId,
      workHoursRecordId: registro.hoursId,
      hoursWorked: registro.hoursWorked,
      amount: registro.lineAmount,
    })),
  });

  await db.tipPoolSource.createMany({
    data: TIP_DEMO_POOL_SOURCES.map((fuente) => ({
      id: fuente.id,
      poolId: TIP_DEMO_POOL.id,
      tipEntryId: fuente.entryId,
      amount: fuente.amount,
    })),
  });
}

async function main(): Promise<void> {
  // Mismo fallback que prisma.config.ts: PostgreSQL local de docker compose
  // (puerto 5433 del host); en Docker/producción DATABASE_URL viene definida.
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgresql://postgres:cambiar-en-produccion@localhost:5433/subway_gestion';

  const options: SeedOptions = {
    adminEmail: process.env.ADMIN_EMAIL ?? 'admin@moi-food.cl',
    adminPassword: process.env.ADMIN_PASSWORD ?? 'admin-cambiar-en-produccion',
    adminFirstName: process.env.ADMIN_FIRST_NAME ?? 'Administrador',
    adminLastName: process.env.ADMIN_LAST_NAME ?? 'Moi-food',
    includeDemoData: process.env.SEED_DEMO_DATA === 'true',
  };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const result = await seedDatabase(prisma, options);
    console.log(
      `Seed OK: ${BASE_ROLES.length} roles sincronizados (${BASE_ROLES.map(
        (r) => r.code,
      ).join(
        ', ',
      )}) y ${DOCUMENT_TYPES.length} tipos de documento (${DOCUMENT_TYPES.map(
        (t) => t.code,
      ).join(', ')}).`,
    );
    console.log(
      `Locales sincronizados: ${BASE_STORES.map((s) => s.name).join(', ')}.`,
    );
    if (options.includeDemoData === true) {
      console.log(
        `Fixtures demo de propinas sincronizadas (SPRINT-3-T09) en ` +
          `${TIP_DEMO_STORE.name}: pacto, ${TIP_DEMO_ENTRIES.length} entradas, ` +
          `${TIP_DEMO_WORKER_PERIODS.length} registros de horas y reparto ` +
          `${TIP_DEMO_POOL.status} de ${TIP_DEMO_POOL.totalAmount} CLP (datos sintéticos).`,
      );
    } else {
      console.log('Fixtures demo desactivadas: SEED_DEMO_DATA no es true.');
    }
    console.log(
      result.adminCreated
        ? `Usuario administrador creado: ${options.adminEmail}`
        : `Usuario administrador ya existía, se mantiene sin cambios: ${options.adminEmail}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error('Error al ejecutar el seed:', error);
    process.exitCode = 1;
  });
}
