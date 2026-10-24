import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { DOCUMENT_TYPES } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import type { DocumentResponse } from '../src/documents/types/documents.types.js';
import { businessDateOf } from '../src/documents/utils/document-dates.util.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

interface ErrorResponse {
  message: string | string[];
}

// Tests de integración de la carga de documentos (SPRINT-2-T05) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual que en
// users.integration.spec.ts, los datos van por HTTP (no se pueden envolver en
// una transacción revertida): usan el dominio @documents-test.moi-food.cl y un
// local propio, y se eliminan al finalizar. Los archivos se guardan en una
// carpeta temporal que también se elimina.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@documents-test.moi-food.cl';
const STORE_NAME = 'Subway Documents Test';
const MAX_SIZE_MB = 1;

// PDF mínimo con contenido único: el hash SHA-256 es único en toda la base.
function uniquePdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% prueba ${randomUUID()}\n`);
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(!databaseUrl)(
  'Carga de documentos laborales (SPRINT-2-T05)',
  () => {
    let app: INestApplication<App>;
    let prisma: PrismaClient;
    let jwt: JwtService;
    let storagePath: string;
    let storeId: string;
    let workerId: string;
    let adminId: string;
    let adminToken: string;
    let supervisorToken: string;

    async function cleanup(): Promise<void> {
      // Las versiones son inmutables (trigger de SPRINT-2-T05): se purgan como
      // mantenimiento, con session_replication_role = replica (requiere el
      // superusuario de TEST_DATABASE_URL), igual que purgeTestAuditLogs.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        const where = { subjectUser: { email: { endsWith: DOMAIN } } };
        await tx.documentVersion.deleteMany({ where: { document: where } });
        await tx.document.deleteMany({ where });
      });
      // Las operaciones del gestor documental quedan auditadas (SPRINT-2-T09)
      // y audit_logs impide borrar usuarios o locales con historial.
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: STORE_NAME } },
        ],
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({ where: { name: STORE_NAME } });
    }

    async function createUser(
      roleCode: RoleCode,
      name: string,
      userStoreId: string | null,
    ): Promise<string> {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
      });
      const user = await prisma.user.create({
        data: {
          email: `${name}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: name,
          lastName: 'Test',
          roleId: role.id,
          storeId: userStoreId,
        },
      });
      return user.id;
    }

    function tokenFor(
      sub: string,
      role: RoleCode,
      tokenStoreId: string | null,
    ): Promise<string> {
      const payload: JwtPayload = {
        sub,
        email: `token${DOMAIN}`,
        role,
        storeId: tokenStoreId,
      };
      return jwt.signAsync(payload);
    }

    // Cantidad de archivos guardados en la carpeta temporal.
    async function storedFileCount(): Promise<number> {
      const entries = await fs.readdir(storagePath, {
        recursive: true,
        withFileTypes: true,
      });
      return entries.filter((entry) => entry.isFile()).length;
    }

    // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
    function upload(
      fields: Record<string, string>,
      file: { content: Buffer; name: string; type: string } | null,
      token = adminToken,
    ) {
      let req = request(app.getHttpServer())
        .post('/documents')
        .set('Authorization', `Bearer ${token}`);
      for (const [key, value] of Object.entries(fields)) {
        req = req.field(key, value);
      }
      if (file) {
        req = req.attach('file', file.content, {
          filename: file.name,
          contentType: file.type,
        });
      }
      return req;
    }

    function pdf(content = uniquePdf(), name = 'contrato.pdf') {
      return { content, name, type: 'application/pdf' };
    }

    beforeAll(async () => {
      storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'moi-food-docs-'));
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = storagePath;
      process.env.DOCUMENTS_MAX_SIZE_MB = String(MAX_SIZE_MB);

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      // Mismo pipe de validación que main.ts.
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
      jwt = app.get(JwtService);

      prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await cleanup();

      // Roles y tipos de documento base por si la BD no está sembrada; si ya
      // existen se mantienen sin cambios.
      for (const code of Object.values(ROLE)) {
        await prisma.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code },
        });
      }
      for (const type of DOCUMENT_TYPES) {
        await prisma.documentType.upsert({
          where: { code: type.code },
          update: {},
          create: type,
        });
      }

      const store = await prisma.store.create({
        data: {
          name: STORE_NAME,
          city: 'Melipilla',
          address: 'Calle de prueba 123',
        },
      });
      storeId = store.id;
      workerId = await createUser(ROLE.TRABAJADOR, 'trabajador', storeId);
      adminId = await createUser(ROLE.ADMINISTRADOR, 'admin', null);
      const supervisorId = await createUser(
        ROLE.SUPERVISOR,
        'supervisor',
        storeId,
      );
      adminToken = await tokenFor(adminId, ROLE.ADMINISTRADOR, null);
      supervisorToken = await tokenFor(supervisorId, ROLE.SUPERVISOR, storeId);
    }, 60_000);

    afterAll(async () => {
      await cleanup();
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storagePath, { recursive: true, force: true });
    });

    it('crea el documento con hash, versión 1 y fecha, asociado al trabajador y su local', async () => {
      const content = uniquePdf();
      const res = await upload(
        {
          workerId,
          documentTypeCode: 'CONTRATO',
          title: 'Contrato indefinido',
          issuedAt: '2026-10-01',
        },
        pdf(content, 'contrato-Pérez.pdf'),
      ).expect(201);
      const body = res.body as DocumentResponse;

      expect(body).toMatchObject({
        workerId,
        storeId,
        type: 'CONTRATO',
        title: 'Contrato indefinido',
        issuedAt: '2026-10-01',
        // 5 años de conservación y 15 días para registrar en la DT.
        retainUntil: '2031-10-01',
        dtRegistrationDueAt: '2026-10-16',
      });
      expect(body.latestVersion).toMatchObject({
        number: 1,
        fileName: 'contrato-Pérez.pdf',
        mime: 'application/pdf',
        size: content.length,
        sha256: sha256(content),
        changeNote: null,
        uploadedBy: 'admin Test',
      });
      expect(
        Number.isNaN(Date.parse(String(body.latestVersion.createdAt))),
      ).toBe(false);

      // Registro en la BD y archivo en disco con el mismo hash.
      const version = await prisma.documentVersion.findUniqueOrThrow({
        where: { id: body.latestVersion.id },
        include: { document: true },
      });
      expect(version.document.currentVersionId).toBe(version.id);
      expect(version.document.createdById).toBe(adminId);
      expect(version.uploadedById).toBe(adminId);
      const stored = await fs.readFile(
        path.join(storagePath, version.filePath),
      );
      expect(sha256(stored)).toBe(version.sha256Hash);
    });

    it('con documentId crea una nueva versión y conserva intacta la anterior', async () => {
      const first = await upload(
        { workerId, documentTypeCode: 'ANEXO', title: 'Anexo de jornada' },
        pdf(),
      ).expect(201);
      const v1 = (first.body as DocumentResponse).latestVersion;
      const documentId = (first.body as DocumentResponse).id;

      const content = uniquePdf();
      const res = await upload(
        {
          workerId,
          documentTypeCode: 'ANEXO',
          documentId,
          title: 'Título ignorado',
          changeNote: 'Versión firmada',
        },
        pdf(content, 'anexo-firmado.pdf'),
      ).expect(201);
      const body = res.body as DocumentResponse;

      expect(body.id).toBe(documentId);
      expect(body.title).toBe('Anexo de jornada');
      expect(body.latestVersion).toMatchObject({
        number: 2,
        fileName: 'anexo-firmado.pdf',
        sha256: sha256(content),
        changeNote: 'Versión firmada',
      });

      // La versión 1 sigue consultable y sin cambios.
      const versions = await prisma.documentVersion.findMany({
        where: { documentId },
        orderBy: { versionNumber: 'asc' },
      });
      expect(versions.map((v) => v.versionNumber)).toEqual([1, 2]);
      expect(versions[0]).toMatchObject({
        id: v1.id,
        sha256Hash: v1.sha256,
        fileName: v1.fileName,
      });
    });

    it('sin fecha de celebración usa el día de carga y omite el plazo DT si el tipo no lo exige', async () => {
      const res = await upload(
        { workerId, documentTypeCode: 'PACTO', title: 'Pacto de horas extra' },
        pdf(),
      ).expect(201);
      const body = res.body as DocumentResponse;
      const today = businessDateOf(new Date());
      const pad = (n: number): string => String(n).padStart(2, '0');

      expect(body.issuedAt).toBeNull();
      expect(body.dtRegistrationDueAt).toBeNull();
      // Para el 29-02 PostgreSQL y addYears dan el 28-02; basta el año y el mes.
      expect(body.retainUntil.slice(0, 7)).toBe(
        `${today.year + 5}-${pad(today.month)}`,
      );
    });

    it('rechaza con 409 un archivo ya registrado sin guardar una copia', async () => {
      const content = uniquePdf();
      const first = await upload(
        { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        pdf(content),
      ).expect(201);
      const filesBefore = await storedFileCount();

      const res = await upload(
        {
          workerId,
          documentTypeCode: 'CONTRATO',
          documentId: (first.body as DocumentResponse).id,
        },
        pdf(content),
      ).expect(409);

      expect((res.body as ErrorResponse).message).toContain(
        'Este archivo ya está registrado',
      );
      expect(await storedFileCount()).toBe(filesBefore);
      expect(
        await prisma.documentVersion.count({
          where: { documentId: (first.body as DocumentResponse).id },
        }),
      ).toBe(1);
    });

    it('exige rol ADMINISTRADOR (403) y token (401)', async () => {
      await upload(
        { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        pdf(),
        supervisorToken,
      ).expect(403);

      await request(app.getHttpServer())
        .post('/documents')
        .field('workerId', workerId)
        .expect(401);
    });

    it('responde 404 si el trabajador o el documento no existen', async () => {
      await upload(
        {
          workerId: randomUUID(),
          documentTypeCode: 'CONTRATO',
          title: 'Contrato',
        },
        pdf(),
      ).expect(404);

      await upload(
        { workerId, documentTypeCode: 'CONTRATO', documentId: randomUUID() },
        pdf(),
      ).expect(404);
    });

    it('responde 400 ante datos inválidos o inconsistentes', async () => {
      // Falta el archivo.
      await upload(
        { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        null,
      ).expect(400);
      // Documento nuevo sin título.
      await upload({ workerId, documentTypeCode: 'CONTRATO' }, pdf()).expect(
        400,
      );
      // Tipo no permitido para esta carga (lo carga el contador).
      await upload(
        { workerId, documentTypeCode: 'LIQUIDACION', title: 'Liquidación' },
        pdf(),
      ).expect(400);
      // Fecha inexistente.
      await upload(
        {
          workerId,
          documentTypeCode: 'CONTRATO',
          title: 'Contrato',
          issuedAt: '2026-02-30',
        },
        pdf(),
      ).expect(400);
      // Un administrador (rol global) no tiene carpeta de trabajador.
      await upload(
        { workerId: adminId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        pdf(),
      ).expect(400);

      // documentId de otro tipo de documento.
      const pacto = await upload(
        { workerId, documentTypeCode: 'PACTO', title: 'Pacto' },
        pdf(),
      ).expect(201);
      await upload(
        {
          workerId,
          documentTypeCode: 'CONTRATO',
          documentId: (pacto.body as DocumentResponse).id,
        },
        pdf(),
      ).expect(400);
    });

    it('rechaza documentos y versiones nuevas en un local inactivo', async () => {
      const existing = (
        await upload(
          { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato vigente' },
          pdf(),
        ).expect(201)
      ).body as DocumentResponse;
      await prisma.store.update({
        where: { id: storeId },
        data: { isActive: false },
      });

      try {
        const rejected = await upload(
          {
            workerId,
            documentTypeCode: 'PACTO',
            title: 'Documento de local inactivo',
          },
          pdf(),
        ).expect(400);
        expect((rejected.body as ErrorResponse).message).toBe(
          'El local indicado no existe o está inactivo',
        );
        await upload(
          {
            workerId,
            documentTypeCode: 'CONTRATO',
            documentId: existing.id,
          },
          pdf(),
        ).expect(400);

        expect(
          await prisma.documentVersion.count({
            where: { documentId: existing.id },
          }),
        ).toBe(1);
        expect(
          await prisma.document.count({
            where: { title: 'Documento de local inactivo' },
          }),
        ).toBe(0);
      } finally {
        await prisma.store.update({
          where: { id: storeId },
          data: { isActive: true },
        });
      }
    });

    it('responde 415 si el contenido no es PDF, PNG ni JPEG', async () => {
      await upload(
        { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        {
          content: Buffer.from('MZ ejecutable disfrazado'),
          name: 'contrato.pdf',
          type: 'application/pdf',
        },
      ).expect(415);
    });

    it('responde 413 si el archivo supera DOCUMENTS_MAX_SIZE_MB', async () => {
      const content = Buffer.concat([
        uniquePdf(),
        Buffer.alloc(MAX_SIZE_MB * 1024 * 1024),
      ]);
      await upload(
        { workerId, documentTypeCode: 'CONTRATO', title: 'Contrato' },
        pdf(content),
      ).expect(413);
    });
  },
);
