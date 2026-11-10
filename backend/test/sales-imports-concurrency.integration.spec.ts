import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { ParsedMrComandaReport } from '../src/sales-imports/parser/mrcomanda-report.types.js';
import {
  type ResolvedSalesReport,
  SalesImportResolverService,
} from '../src/sales-imports/sales-import-resolver.service.js';
import type { SalesImportPreview } from '../src/sales-imports/types/sales-imports.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';
import { fakeSubwayStoreId } from './helpers/subway-store-id.js';
import {
  buildReportSheet,
  buildReportXlsx,
} from './helpers/mrcomanda-report-fixture.js';

type App = Parameters<typeof request>[0];

// Concurrencia y rollback reales de la importación de ventas MrComanda
// (SPRINT-4R-T10) contra PostgreSQL, sin el harness withinRollback: cada
// solicitud abre su propia transacción y la carrera es genuina.
// - Dos cargas simultáneas del mismo archivo: una sola importación, un solo
//   archivo (201 + 200 con el mismo ID).
// - Dos cargas simultáneas de archivos distintos: versiones 1 y 2 sin error.
// - Dos confirmaciones simultáneas que pretenden ser la primera vigente: una
//   gana y la otra recibe 409; nunca dos vigentes.
// - Una línea que la base rechaza a mitad de la transacción: no queda ni la
//   cabecera, ni líneas, ni el archivo.
// Los datos usan un local, un identificador externo y etiquetas de medios
// propios de la corrida (no tocan equivalencias reales) y se eliminan al
// final; las importaciones confirmadas y la auditoría son inmutables, así que
// se purgan como mantenimiento con session_replication_role = replica
// (superusuario de TEST_DATABASE_URL).
const databaseUrl = process.env.TEST_DATABASE_URL;

const STORE_PREFIX = 'Subway Importación Concurrencia';
const DOMAIN = '@sales-imports-concurrency-test.invalid';

describe.skipIf(!databaseUrl)(
  'Concurrencia y rollback de la importación de ventas (SPRINT-4R-T10)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let storageRoot: string;
    let storeId: string;
    let admin: AuthUser;
    let externalCode: string;
    let labels: { debit: string; cash: string };
    let methodIds: { debit: string; cash: string };

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    // Reporte ficticio de un día con dos medios propios de la corrida.
    async function excel(day: number, debit: number): Promise<Buffer> {
      const date = `${String(day).padStart(2, '0')}/03/2026`;
      return buildReportXlsx([
        buildReportSheet({
          title: null,
          period: `${date} al ${date}`,
          filters: ` - Todas las Empresas - Local: ${externalCode} - Todos los Sectores`,
          salesTotal: debit + 50_000,
          paymentsTotal: debit + 50_000,
          lines: [
            { label: labels.debit, amount: debit },
            { label: labels.cash, amount: 50_000 },
          ],
        }),
      ]);
    }

    function preview(file: Buffer): request.Test {
      return request(app.getHttpServer())
        .post('/sales-imports/preview')
        .set('Authorization', `Bearer ${token(admin)}`)
        .attach('file', file, 'ventas.xlsx');
    }

    function confirm(id: string, expected: string | null): request.Test {
      return request(app.getHttpServer())
        .post(`/sales-imports/${id}/confirm`)
        .set('Authorization', `Bearer ${token(admin)}`)
        .send({ expectedActiveImportId: expected });
    }

    async function countStoredFiles(): Promise<number> {
      const entries = await fs
        .readdir(path.join(storageRoot, 'sales-imports'), {
          recursive: true,
          withFileTypes: true,
        })
        .catch(() => []);
      return entries.filter((entry) => entry.isFile()).length;
    }

    function dbDate(day: number): Date {
      return new Date(`2026-03-${String(day).padStart(2, '0')}T00:00:00.000Z`);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      storageRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moifood-imp-race-'),
      );
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
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

      const run = randomInt(100_000, 999_999);
      // El local se identifica por su ID Subway (SPRINT-4A-T17).
      const subwayStoreId = fakeSubwayStoreId();
      externalCode = `8${randomInt(10, 99)} - ${subwayStoreId}`;
      labels = { debit: `T10 DEBITO ${run}`, cash: `T10 EFECTIVO ${run}` };

      const store = await prisma.store.create({
        data: {
          name: `${STORE_PREFIX} ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
          subwayStoreId,
        },
      });
      storeId = store.id;
      const methods = await prisma.paymentMethod.findMany({
        where: { code: { in: ['DEBIT_CARD', 'CASH'] } },
        select: { id: true, code: true },
      });
      const byCode = new Map(methods.map((m) => [m.code, m.id]));
      methodIds = {
        debit: byCode.get('DEBIT_CARD') ?? '',
        cash: byCode.get('CASH') ?? '',
      };
      for (const [label, methodId] of [
        [labels.debit, methodIds.debit],
        [labels.cash, methodIds.cash],
      ] as const) {
        await prisma.paymentMethodAlias.create({
          data: {
            system: 'MRCOMANDA',
            label,
            normalizedLabel: label,
            paymentMethodId: methodId,
          },
        });
      }

      const role = await prisma.role.upsert({
        where: { code: ROLE.ADMINISTRADOR },
        update: {},
        create: { code: ROLE.ADMINISTRADOR, name: ROLE.ADMINISTRADOR },
      });
      const id = randomUUID();
      await prisma.user.create({
        data: {
          id,
          email: `${id}${DOMAIN}`,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: 'Admin',
          lastName: 'Concurrencia',
          roleId: role.id,
        },
      });
      admin = {
        id,
        email: `${id}${DOMAIN}`,
        role: ROLE.ADMINISTRADOR,
        storeId: null,
      };
    }, 60_000);

    afterAll(async () => {
      await purgeTestAuditLogs(prisma, {
        OR: [
          { user: { email: { endsWith: DOMAIN } } },
          { store: { name: { startsWith: STORE_PREFIX } } },
        ],
      });
      // Las importaciones confirmadas son inmutables (trigger): se eliminan
      // como mantenimiento, igual que la auditoría.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.salesImportLine.deleteMany({ where: { import: { storeId } } });
        await tx.salesImport.deleteMany({ where: { storeId } });
      });
      await prisma.paymentMethodAlias.deleteMany({
        where: { normalizedLabel: { in: [labels.debit, labels.cash] } },
      });
      await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
      await prisma.store.deleteMany({
        where: { name: { startsWith: STORE_PREFIX } },
      });
      await prisma.$disconnect();
      await app.close();
      await fs.rm(storageRoot, { recursive: true, force: true });
    });

    it('dos cargas simultáneas del mismo archivo crean una sola importación', async () => {
      const file = await excel(1, 100_000);
      const filesBefore = await countStoredFiles();

      const [first, second] = await Promise.all([preview(file), preview(file)]);

      expect([first.status, second.status].sort()).toEqual([200, 201]);
      const ids = [first, second].map(
        (res) => (res.body as SalesImportPreview).import?.id,
      );
      expect(ids[0]).toBeDefined();
      expect(ids[0]).toBe(ids[1]);
      expect(
        await prisma.salesImport.count({
          where: { storeId, businessDate: dbDate(1) },
        }),
      ).toBe(1);
      // El archivo de la carga perdedora se eliminó.
      expect(await countStoredFiles()).toBe(filesBefore + 1);
    });

    it('dos archivos distintos simultáneos quedan como versiones 1 y 2', async () => {
      const [first, second] = await Promise.all([
        preview(await excel(2, 100_000)),
        preview(await excel(2, 110_000)),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      const versions = await prisma.salesImport.findMany({
        where: { storeId, businessDate: dbDate(2) },
        select: { version: true, status: true },
        orderBy: { version: 'asc' },
      });
      expect(versions).toEqual([
        { version: 1, status: 'PENDING' },
        { version: 2, status: 'PENDING' },
      ]);
    });

    it('dos confirmaciones simultáneas nunca dejan dos versiones vigentes', async () => {
      const a = (await preview(await excel(3, 100_000)).expect(201))
        .body as SalesImportPreview;
      const b = (await preview(await excel(3, 120_000)).expect(201))
        .body as SalesImportPreview;

      const [first, second] = await Promise.all([
        confirm(a.import?.id ?? '', null),
        confirm(b.import?.id ?? '', null),
      ]);

      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const active = await prisma.salesImport.findMany({
        where: { storeId, businessDate: dbDate(3), status: 'ACTIVE' },
      });
      expect(active).toHaveLength(1);
    });

    it('si una línea falla dentro de la transacción no queda nada a medias', async () => {
      const resolver = app.get(SalesImportResolverService);
      const original = resolver.resolve.bind(resolver);
      // Simula que la equivalencia cambió entre la resolución y el guardado:
      // la segunda línea apunta a un medio que no corresponde a su alias, y
      // el trigger de T08 la rechaza después de crear cabecera y primera línea.
      const spy = vi
        .spyOn(resolver, 'resolve')
        .mockImplementationOnce(
          async (
            report: ParsedMrComandaReport,
          ): Promise<ResolvedSalesReport> => {
            const resolved = await original(report);
            resolved.lines[1] = {
              ...resolved.lines[1],
              paymentMethod: {
                id: methodIds.debit,
                code: 'DEBIT_CARD',
                name: 'Tarjeta de débito',
              },
            };
            return resolved;
          },
        );
      const filesBefore = await countStoredFiles();
      try {
        const response = await preview(await excel(4, 100_000));
        expect(response.status).toBe(409);
        expect((response.body as { message: string }).message).toContain(
          'vuelve a subir el archivo',
        );
      } finally {
        spy.mockRestore();
      }

      expect(
        await prisma.salesImport.count({
          where: { storeId, businessDate: dbDate(4) },
        }),
      ).toBe(0);
      expect(
        await prisma.salesImportLine.count({
          where: { import: { storeId, businessDate: dbDate(4) } },
        }),
      ).toBe(0);
      expect(await countStoredFiles()).toBe(filesBefore);

      // Con la equivalencia correcta, la misma carga funciona después.
      await preview(await excel(4, 100_000)).expect(201);
    });
  },
);
