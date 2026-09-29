// =============================================================
// Seed de datos base (SPRINT-1-T05): roles del sistema y usuario
// administrador inicial.
//
// Ejecución: `npm run prisma:seed` (o `npx prisma db seed`).
// El script es idempotente: los roles se sincronizan por `code`
// (upsert) y el administrador solo se crea si el correo no existe,
// sin sobrescribir la contraseña de un usuario ya registrado.
// =============================================================
import 'dotenv/config';
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

export interface SeedOptions {
  adminEmail: string;
  adminPassword: string;
  adminFirstName: string;
  adminLastName: string;
}

export interface SeedResult {
  roleIds: Record<string, string>;
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

  const existente = await db.user.findUnique({
    where: { email: options.adminEmail },
  });
  if (existente) {
    return { roleIds, adminUserId: existente.id, adminCreated: false };
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
  return { roleIds, adminUserId: admin.id, adminCreated: true };
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
  };

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const result = await seedDatabase(prisma, options);
    console.log(
      `Seed OK: ${BASE_ROLES.length} roles sincronizados (${BASE_ROLES.map(
        (r) => r.code,
      ).join(', ')}).`,
    );
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
