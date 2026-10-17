import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DOCUMENT_TYPES } from '../prisma/seed.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser } from '../src/auth/types/auth.types.js';
import { DocumentsService } from '../src/documents/documents.service.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';

// Tests de integración de la consulta de documentos (SPRINT-2-T06) contra
// PostgreSQL real, llamando al servicio directamente. Se omiten si no se
// define TEST_DATABASE_URL. Cada test corre dentro de una transacción que se
// revierte (patrón withinRollback): el servicio recibe el cliente de esa
// transacción, por lo que no deja datos. Los archivos van a una carpeta
// temporal que se elimina al finalizar.
const databaseUrl = process.env.TEST_DATABASE_URL;

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  service: DocumentsService;
  storeA: string;
  storeB: string;
  worker1: AuthUser;
  worker2: AuthUser;
  admin: AuthUser;
}

describe.skipIf(!databaseUrl)('Consulta de documentos (SPRINT-2-T06)', () => {
  let prisma: PrismaClient;
  let storagePath: string;
  let storage: StorageService;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    storagePath = await fs.mkdtemp(
      path.join(os.tmpdir(), 'moi-food-docs-query-'),
    );
    storage = new StorageService(
      new ConfigService({ DOCUMENTS_STORAGE_PATH: storagePath }),
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await fs.rm(storagePath, { recursive: true, force: true });
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
        { timeout: 20_000 },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  }

  async function createUser(
    tx: Prisma.TransactionClient,
    roleCode: RoleCode,
    name: string,
    storeId: string | null,
  ): Promise<AuthUser> {
    const role = await tx.role.upsert({
      where: { code: roleCode },
      update: {},
      create: { code: roleCode, name: roleCode },
    });
    const user = await tx.user.create({
      data: {
        email: `${name}@documents-query-test.moi-food.cl`,
        passwordHash: '$2b$04$hash-de-prueba',
        firstName: name,
        lastName: 'Test',
        roleId: role.id,
        storeId,
      },
    });
    return { id: user.id, email: user.email, role: roleCode, storeId };
  }

  async function createFixture(tx: Prisma.TransactionClient): Promise<Fixture> {
    for (const type of DOCUMENT_TYPES) {
      await tx.documentType.upsert({
        where: { code: type.code },
        update: {},
        create: type,
      });
    }
    const [storeA, storeB] = await Promise.all(
      ['Subway Query Test A', 'Subway Query Test B'].map((name) =>
        tx.store.create({
          data: { name, city: 'Melipilla', address: 'Calle de prueba 1' },
        }),
      ),
    );
    const worker1 = await createUser(
      tx,
      ROLE.TRABAJADOR,
      'trabajador1',
      storeA.id,
    );
    const worker2 = await createUser(
      tx,
      ROLE.TRABAJADOR,
      'trabajador2',
      storeB.id,
    );
    const admin = await createUser(tx, ROLE.ADMINISTRADOR, 'admin', null);
    // El servicio solo usa operaciones que el cliente de la transacción
    // también tiene (las consultas, sin $transaction).
    const service = new DocumentsService(
      tx as unknown as PrismaService,
      storage,
      new ConfigService({ DOCUMENTS_MAX_SIZE_MB: '5' }),
    );
    return {
      service,
      storeA: storeA.id,
      storeB: storeB.id,
      worker1,
      worker2,
      admin,
    };
  }

  // Documento con sus versiones (contenido real guardado en disco).
  async function createDocument(
    tx: Prisma.TransactionClient,
    options: {
      typeCode: string;
      storeId: string;
      subjectUserId: string | null;
      createdById: string;
      createdAt: Date;
      versions?: number;
    },
  ): Promise<{ id: string; versionIds: string[]; filePaths: string[] }> {
    const type = await tx.documentType.findUniqueOrThrow({
      where: { code: options.typeCode },
    });
    const document = await tx.document.create({
      data: {
        title: `Documento ${options.typeCode}`,
        retainUntil: new Date('2031-10-17'),
        storeId: options.storeId,
        subjectUserId: options.subjectUserId,
        documentTypeId: type.id,
        createdById: options.createdById,
        createdAt: options.createdAt,
      },
    });
    const versionIds: string[] = [];
    const filePaths: string[] = [];
    for (let number = 1; number <= (options.versions ?? 1); number++) {
      const stored = await storage.save(
        Buffer.from(`%PDF-1.7\n${randomBytes(16).toString('hex')}`),
      );
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          versionNumber: number,
          fileName: `archivo-v${number}.pdf`,
          filePath: stored.relativePath,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          sha256Hash: stored.sha256Hash,
          uploadedById: options.createdById,
        },
      });
      versionIds.push(version.id);
      filePaths.push(stored.relativePath);
    }
    if (versionIds.length > 0) {
      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: versionIds[versionIds.length - 1] },
      });
    }
    return { id: document.id, versionIds, filePaths };
  }

  it('el administrador lista solo documentos laborales, con filtros por trabajador, tipo y local', async () => {
    await withinRollback(async (tx) => {
      const f = await createFixture(tx);
      const base = { createdById: f.admin.id };
      const contrato = await createDocument(tx, {
        ...base,
        typeCode: 'CONTRATO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdAt: new Date('2026-10-01T12:00:00Z'),
      });
      const pacto = await createDocument(tx, {
        ...base,
        typeCode: 'PACTO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdAt: new Date('2026-10-05T12:00:00Z'),
      });
      const otro = await createDocument(tx, {
        ...base,
        typeCode: 'CONTRATO',
        storeId: f.storeB,
        subjectUserId: f.worker2.id,
        createdAt: new Date('2026-10-03T12:00:00Z'),
      });
      // No deben aparecer: liquidación, documento del local y documento sin versión.
      await createDocument(tx, {
        ...base,
        typeCode: 'LIQUIDACION',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdAt: new Date('2026-10-06T12:00:00Z'),
      });
      await createDocument(tx, {
        ...base,
        typeCode: 'PERMISO_SANITARIO',
        storeId: f.storeA,
        subjectUserId: null,
        createdAt: new Date('2026-10-06T12:00:00Z'),
      });
      await createDocument(tx, {
        ...base,
        typeCode: 'ANEXO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdAt: new Date('2026-10-06T12:00:00Z'),
        versions: 0,
      });

      const ids = async (query: object): Promise<string[]> =>
        (await f.service.list(query, f.admin)).items
          .map((item) => item.id)
          .filter((id) => [contrato.id, pacto.id, otro.id].includes(id));

      // Del más reciente al más antiguo.
      expect(await ids({ workerId: f.worker1.id })).toEqual([
        pacto.id,
        contrato.id,
      ]);
      expect(
        (await f.service.list({ workerId: f.worker1.id }, f.admin)).items,
      ).toHaveLength(2);
      expect(
        await ids({ workerId: f.worker1.id, documentTypeCode: 'CONTRATO' }),
      ).toEqual([contrato.id]);
      expect(await ids({ storeId: f.storeB })).toEqual([otro.id]);
      expect(await ids({})).toEqual([pacto.id, otro.id, contrato.id]);

      const { policy } = await f.service.list({}, f.admin);
      expect(policy).toEqual({
        maxBytes: 5 * 1024 * 1024,
        allowedMimes: ['application/pdf', 'image/png', 'image/jpeg'],
        canUpload: true,
      });
    });
  });

  it('un trabajador solo lista sus propios documentos', async () => {
    await withinRollback(async (tx) => {
      const f = await createFixture(tx);
      const propio = await createDocument(tx, {
        typeCode: 'CONTRATO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdById: f.admin.id,
        createdAt: new Date(),
      });
      await createDocument(tx, {
        typeCode: 'CONTRATO',
        storeId: f.storeB,
        subjectUserId: f.worker2.id,
        createdById: f.admin.id,
        createdAt: new Date(),
      });

      const result = await f.service.list({}, f.worker1);
      expect(result.items.map((item) => item.id)).toEqual([propio.id]);
      expect(result.policy.canUpload).toBe(false);
      // Pedir los de otro trabajador se rechaza.
      await expect(
        f.service.list({ workerId: f.worker2.id }, f.worker1),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('muestra el historial de versiones del más nuevo al más antiguo y protege los ajenos', async () => {
    await withinRollback(async (tx) => {
      const f = await createFixture(tx);
      const document = await createDocument(tx, {
        typeCode: 'ANEXO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdById: f.admin.id,
        createdAt: new Date(),
        versions: 3,
      });

      const history = await f.service.getVersionHistory(document.id, f.worker1);
      expect(history.workerId).toBe(f.worker1.id);
      expect(history.versions.map((v) => v.number)).toEqual([3, 2, 1]);
      expect(history.versions.map((v) => v.id)).toEqual(
        [...document.versionIds].reverse(),
      );

      await expect(
        f.service.getVersionHistory(document.id, f.worker2),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        f.service.getVersionHistory(randomUUID(), f.admin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('verifica la integridad: VALID, ALTERED y MISSING', async () => {
    await withinRollback(async (tx) => {
      const f = await createFixture(tx);
      const document = await createDocument(tx, {
        typeCode: 'CONTRATO',
        storeId: f.storeA,
        subjectUserId: f.worker1.id,
        createdById: f.admin.id,
        createdAt: new Date(),
        versions: 3,
      });
      const [validId, alteredId, missingId] = document.versionIds;
      const [, alteredPath, missingPath] = document.filePaths;
      await fs.appendFile(path.join(storagePath, alteredPath), 'alterado');
      await fs.rm(path.join(storagePath, missingPath));

      const valid = await f.service.checkIntegrity(validId, f.worker1);
      expect(valid).toMatchObject({ status: 'VALID', valid: true });
      expect(valid.actualHash).toBe(valid.expectedHash);

      const altered = await f.service.checkIntegrity(alteredId, f.admin);
      expect(altered).toMatchObject({ status: 'ALTERED', valid: false });
      expect(altered.actualHash).toMatch(/^[a-f0-9]{64}$/);
      expect(altered.actualHash).not.toBe(altered.expectedHash);

      const missing = await f.service.checkIntegrity(missingId, f.admin);
      expect(missing).toMatchObject({
        status: 'MISSING',
        valid: false,
        actualHash: null,
      });

      // La descarga advierte el archivo alterado y falla si no existe.
      const download = await f.service.download(alteredId, f.admin);
      expect(download.integrity).toBe('ALTERED');
      await expect(f.service.download(missingId, f.admin)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        f.service.checkIntegrity(validId, f.worker2),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
