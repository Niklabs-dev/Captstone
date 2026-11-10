import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import readXlsxFile from 'read-excel-file/node';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  CLP_FORMAT,
  listPeriodDays,
  XLSX_MIME_TYPE,
} from '../src/tips/export/daily-tips-workbook.js';
import type {
  DailyTipDaysResponse,
  DailyTipSummaryResponse,
} from '../src/tips/types/daily-tips.types.js';
import {
  createDailyTipsFixture,
  TIPS_D1,
  TIPS_D2,
  type DailyTipsFixture,
} from './helpers/daily-tips-fixture.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';
import { cellReference, readCellFormats } from './helpers/xlsx-entries.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;
type Fixture = DailyTipsFixture & { tx: Tx };

// Tests de integración HTTP de la exportación a Excel de las propinas del
// período (SPRINT-4A-T05) contra PostgreSQL real con datos ficticios: abre el
// archivo generado y valida sus hojas, que los montos sean celdas numéricas
// con formato CLP y que los totales cuadren con GET /daily-tips/summary y
// /days; nombre del archivo, acceso por rol, validación del rango y
// auditoría sin montos ni datos personales. Todo corre dentro de
// withinRollback: la base se revierte.
const databaseUrl = process.env.TEST_DATABASE_URL;

const FROM = '2026-11-01';
const TO = '2026-11-30';
const STORE_PREFIX = 'Exportación Ñuñoa';
const DOMAIN = '@daily-tips-export-test.invalid';

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

function binary(
  res: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe.skipIf(!databaseUrl)(
  'Exportación a Excel de propinas del período (SPRINT-4A-T05)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;

    function get(path: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).get(path);
      if (!user) return req;
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return req.set('Authorization', `Bearer ${jwt.sign(payload)}`);
    }

    function exportPath(params: Record<string, string>): string {
      return `/daily-tips/export?${new URLSearchParams(params).toString()}`;
    }

    function download(f: Fixture, user: AuthUser): request.Test {
      return get(exportPath({ storeId: f.storeId, from: FROM, to: TO }), user)
        .buffer(true)
        .parse(binary);
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            const fixture = await createDailyTipsFixture(tx, {
              storePrefix: STORE_PREFIX,
              emailDomain: DOMAIN,
              payFirstDay: true,
            });
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await run({ ...fixture, tx });
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 50_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
      }
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
      process.env.DOCUMENTS_MAX_SIZE_MB = '1';

      switchable = createSwitchablePrisma();
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue(switchable.service)
        .compile();
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
    });

    afterAll(async () => {
      await prisma.$disconnect();
      await app.close();
    });

    it('abre el archivo y valida hojas, formato CLP y totales contra la API', async () => {
      await withinRollback(async (f) => {
        const response = await download(f, f.admin).expect(200);
        expect(response.headers['content-type']).toContain(XLSX_MIME_TYPE);
        const slug = f.storeName
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toLowerCase()
          .replace(/\s+/g, '-');
        expect(slug).toMatch(/^exportacion-nunoa-[0-9a-f-]{36}$/);
        expect(response.headers['content-disposition']).toBe(
          `attachment; filename="propinas_${slug}_${FROM}_${TO}.xlsx"`,
        );
        expect(response.headers['cache-control']).toBe('private, no-store');
        const file = response.body as Buffer;

        const summaryApi = (
          await get(
            `/daily-tips/summary?${new URLSearchParams({ storeId: f.storeId, from: FROM, to: TO }).toString()}`,
            f.accountant,
          ).expect(200)
        ).body as DailyTipSummaryResponse;
        const daysApi = (
          await get(
            `/daily-tips/days?${new URLSearchParams({ storeId: f.storeId, from: FROM, to: TO }).toString()}`,
            f.accountant,
          ).expect(200)
        ).body as DailyTipDaysResponse;

        const sheets = await readXlsxFile(file);
        expect(sheets.map((sheet) => sheet.sheet)).toEqual([
          'Resumen',
          'Detalle',
        ]);
        const [summary, detail] = sheets.map((sheet) => sheet.data);

        // Resumen: encabezado con un día por columna (30 días corridos).
        const days = listPeriodDays(FROM, TO);
        expect(days).toHaveLength(30);
        expect(summary[0]).toEqual([
          'Trabajador',
          'RUT',
          ...days.map((day) => day.split('-').reverse().join('-')),
          'Total',
        ]);
        const totalColumn = days.length + 2;

        // Una fila por trabajador (mismo orden y totales que la API) con su
        // nombre y RUT; cada fila suma su total.
        const workerRows = summary.slice(1, -1);
        expect(workerRows.map((row) => row[0])).toEqual(
          summaryApi.workers.map((worker) => worker.worker.name),
        );
        summaryApi.workers.forEach((worker, index) => {
          const row = workerRows[index];
          expect(row[1]).toBe(f.rutByUser.get(worker.worker.id));
          expect(row[totalColumn]).toBe(worker.totalAmount);
          const perDay = row.slice(2, totalColumn) as number[];
          expect(perDay.reduce((sum, value) => sum + value, 0)).toBe(
            worker.totalAmount,
          );
        });
        expect(workerRows[0].slice(0, 2)).toEqual([
          'Ana Ficticia',
          f.rutByUser.get(f.ana.id),
        ]);
        // Ana: $10.000 el D1 y su parte de $10.000 entre 3 el D2.
        const d1Column = days.indexOf(TIPS_D1) + 2;
        const d2Column = days.indexOf(TIPS_D2) + 2;
        expect(workerRows[0][d1Column]).toBe(10_000);
        expect([3_333, 3_334]).toContain(workerRows[0][d2Column]);

        // Fila final: total por día (cuadra con /days) y total general.
        const totals = summary[summary.length - 1];
        expect(totals[0]).toBe('Total por día');
        days.forEach((day, index) => {
          const apiDay = daysApi.days.find((item) => item.businessDate === day);
          expect(totals[index + 2]).toBe(apiDay?.totalAmount ?? 0);
        });
        expect(totals[totalColumn]).toBe(summaryApi.totals.totalAmount);
        expect(totals[totalColumn]).toBe(50_000);

        // Detalle: una fila por propina con fecha, trabajador, monto, estado
        // y lote; suma el total general.
        expect(detail[0]).toEqual([
          'Fecha',
          'Trabajador',
          'Monto',
          'Estado',
          'Lote de pago',
        ]);
        const detailRows = detail.slice(1);
        const stored = await f.tx.dailyTipAllocation.count({
          where: { storeId: f.storeId },
        });
        expect(detailRows).toHaveLength(stored);
        expect(
          detailRows.reduce((sum, row) => sum + (row[2] as number), 0),
        ).toBe(summaryApi.totals.totalAmount);
        for (const row of detailRows) {
          expect(row[0]).toBeInstanceOf(Date);
          if (row[3] === 'Pagada') {
            expect(row[4]).toBe(f.batchId);
          } else {
            expect(row[3]).toBe('No pagada');
            expect(row[4]).toBeNull();
          }
        }
        expect(detailRows.filter((row) => row[3] === 'Pagada')).toHaveLength(5);
        expect(detailRows[0][1]).toBe('Ana Ficticia');

        // Los montos son celdas numéricas (sin t="s") con formato CLP.
        const summaryFormats = readCellFormats(file, 1);
        for (let rowIndex = 1; rowIndex < summary.length; rowIndex += 1) {
          for (let column = 2; column <= totalColumn; column += 1) {
            expect(
              summaryFormats.get(cellReference(rowIndex, column)),
              cellReference(rowIndex, column),
            ).toEqual({ type: undefined, formatCode: CLP_FORMAT });
          }
        }
        const detailFormats = readCellFormats(file, 2);
        for (let rowIndex = 1; rowIndex < detail.length; rowIndex += 1) {
          expect(detailFormats.get(cellReference(rowIndex, 2))).toEqual({
            type: undefined,
            formatCode: CLP_FORMAT,
          });
        }
      });
    });

    it('audita la descarga con local, rango y cantidades, sin montos ni datos personales', async () => {
      await withinRollback(async (f) => {
        await download(f, f.accountant).expect(200);
        const audits = await f.tx.auditLog.findMany({
          where: {
            action: AUDIT_ACTION.DAILY_TIPS_EXPORTED,
            storeId: f.storeId,
          },
        });
        expect(audits).toHaveLength(1);
        const [audit] = audits;
        expect(audit).toMatchObject({
          userId: f.accountant.id,
          entityType: 'daily_tip_allocations',
          entityId: f.storeId,
        });
        expect(audit.detail).toEqual({
          storeId: f.storeId,
          from: FROM,
          to: TO,
          workerCount: 4,
          allocationCount: 7,
        });
        const serialized = JSON.stringify(audit.detail);
        for (const value of ['10000', '40000', '50000', 'Ana', 'Ficticia']) {
          expect(serialized).not.toContain(value);
        }
        for (const rut of f.rutByUser.values()) {
          expect(serialized).not.toContain(rut);
        }
      });
    });

    it('solo ADMINISTRADOR y CONTADOR exportan: SUPERVISOR y TRABAJADOR reciben 403', async () => {
      await withinRollback(async (f) => {
        await download(f, f.accountant).expect(200);
        await download(f, f.supervisor).expect(403);
        await download(f, f.ana).expect(403);
        await get(
          exportPath({ storeId: f.storeId, from: FROM, to: TO }),
          null,
        ).expect(401);
      });
    });

    it('valida el rango como /days (400) y el local (404)', async () => {
      await withinRollback(async (f) => {
        for (const params of [
          { storeId: f.storeId, from: '2026-11-10', to: '2026-11-01' },
          { storeId: f.storeId, from: '2026-11-01', to: '2027-01-02' },
          { storeId: f.storeId, from: '2026-02-30', to: '2026-03-01' },
          { storeId: 'no-es-uuid', from: FROM, to: TO },
        ]) {
          await get(exportPath(params), f.admin).expect(400);
        }
        await get(
          exportPath({
            storeId: '00000000-0000-4000-8000-000000000000',
            from: FROM,
            to: TO,
          }),
          f.admin,
        ).expect(404);
        // 62 días es el máximo permitido.
        await get(
          exportPath({
            storeId: f.storeId,
            from: '2026-11-01',
            to: '2027-01-01',
          }),
          f.admin,
        )
          .buffer(true)
          .parse(binary)
          .expect(200);
      });
    });
  },
);
