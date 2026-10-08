import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import {
  BASE_ROLES,
  DOCUMENT_TYPES,
  seedDatabase,
  type SeedOptions,
} from '../prisma/seed.js';

// Tests de integración del seed (SPRINT-1-T05) contra PostgreSQL real.
// Se omiten si no se define TEST_DATABASE_URL y cada test corre dentro de
// una transacción que se revierte, por lo que no dejan datos en la base.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

describe.skipIf(!databaseUrl)('Seed de datos base (SPRINT-1-T05)', () => {
  let prisma: PrismaClient;

  const opciones: SeedOptions = {
    adminEmail: 'admin-seed@moi-food.cl',
    adminPassword: 'clave-de-prueba-seed',
    adminFirstName: 'Admin',
    adminLastName: 'Seed',
  };

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
      // Contratos y sus modificaciones; el resto no se registra en la DT.
      expect(conRegistro).toEqual(['ANEXO', 'CONTRATO']);
      // Los pactos laborales (E1-H3) existen como tipo de documento.
      expect(tipos.map((t) => t.code)).toContain('PACTO');
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
      const hashCambiado = await bcrypt.hash('clave-cambiada-por-el-admin', 12);
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
});
