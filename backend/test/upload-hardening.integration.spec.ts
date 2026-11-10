import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomInt, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import request from 'supertest';
import { DOCUMENT_TYPES } from '../prisma/seed.js';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { AuthUser, JwtPayload } from '../src/auth/types/auth.types.js';
import { MAX_VOUCHER_BYTES } from '../src/daily-operations/types/daily-operations.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { MAX_REPORT_FILE_BYTES } from '../src/sales-imports/parser/xlsx-workbook.reader.js';
import { MAX_UNCOMPRESSED_BYTES } from '../src/sales-imports/parser/xlsx-zip-guard.js';
import {
  buildReportSheet,
  buildReportXlsx,
  type FixtureLine,
} from './helpers/mrcomanda-report-fixture.js';
import {
  minimalJpeg,
  truncatedJpeg as truncatedJpegOf,
} from './helpers/jpeg.js';
import { paymentMethodIdOf } from './helpers/payment-methods.js';
import {
  createSwitchablePrisma,
  type SwitchablePrisma,
} from './helpers/switchable-prisma.js';
import { fakeSubwayStoreId } from './helpers/subway-store-id.js';

type App = Parameters<typeof request>[0];
type Tx = Prisma.TransactionClient;

// Regresión de seguridad de las cargas de archivos (SPRINT-4R-T18) contra
// PostgreSQL real. Recorre las CUATRO cargas del sistema con los mismos
// casos, para demostrar que todas se comportan igual:
// - documento laboral (POST /documents, ADMINISTRADOR, PDF/PNG/JPEG),
// - liquidación de sueldo (POST /payroll, CONTADOR, solo PDF),
// - voucher de la operación diaria (POST /daily-operations, SUPERVISOR,
//   JPEG/PNG/WebP),
// - Excel de ventas MrComanda (POST /sales-imports/preview, ADMINISTRADOR).
// Casos: carga válida, tamaño excedido (413), extensión o tipo falsos (415),
// archivo cortado (422), dos archivos en una solicitud (400), sin sesión
// (401) o con un rol ajeno (403), bomba zip en el Excel (413), acceso
// directo a la carpeta privada (404), descarga autorizada íntegra (mismos
// bytes e integridad VALID), descarga negada entre locales, entre dueños y
// por rol (403/404 sin filtrar el archivo) y descarga de un archivo ausente
// en disco (404). En TODAS las respuestas,
// de éxito y de error, se verifica que no aparezcan rutas internas del
// servidor, y tras cada rechazo que no quedó ningún archivo en disco.
// Todo corre dentro de withinRollback; los archivos se escriben en una
// carpeta temporal que se elimina al terminar.
const databaseUrl = process.env.TEST_DATABASE_URL;

// Límite de documentos y liquidaciones en este test (DOCUMENTS_MAX_SIZE_MB).
const DOCUMENTS_LIMIT_MB = 1;
const DOCUMENTS_LIMIT_BYTES = DOCUMENTS_LIMIT_MB * 1024 * 1024;

// Archivos mínimos completos y sus variantes.
function pdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% carga ${randomUUID()}\n%%EOF\n`);
}
function truncatedPdf(): Buffer {
  return Buffer.from(`%PDF-1.7\n% cortado ${randomUUID()}\n1 0 obj\n<<`);
}
function jpeg(): Buffer {
  return minimalJpeg(randomUUID());
}
function truncatedJpeg(): Buffer {
  return truncatedJpegOf(randomUUID());
}
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
// Ejecutable de Windows («MZ») disfrazado con otra extensión.
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00ejecutable disfrazado');
const CSV = Buffer.from('Fecha;Monto\n05/11/2026;1000\n');

// Archivo que supera el límite y empieza con una firma válida.
// «Bomba zip»: un .xlsx de decenas de KB cuya hoja se descomprime a
// `uncompressedBytes` de espacios. ZIP mínimo de una entrada deflate.
function zipBomb(uncompressedBytes: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml', 'latin1');
  const data = deflateRawSync(Buffer.alloc(uncompressedBytes, 0x20));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(uncompressedBytes, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(uncompressedBytes, 24);
  central.writeUInt16LE(name.length, 28);
  const localBlock = Buffer.concat([local, name, data]);
  const centralBlock = Buffer.concat([central, name]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, end]);
}

function oversized(head: Buffer, limitBytes: number): Buffer {
  return Buffer.concat([head, Buffer.alloc(limitBytes + 1 - head.length + 1)]);
}

class Rollback extends Error {
  constructor() {
    super('rollback de prueba');
    this.name = 'Rollback';
  }
}

interface Fixture {
  tx: Tx;
  storeId: string;
  externalCode: string;
  reportLines: FixtureLine[];
  admin: AuthUser;
  accountant: AuthUser;
  supervisor: AuthUser;
  worker: AuthUser;
  // Trabajador del mismo local que no es dueño de los archivos y supervisor
  // de otro local (cruce entre dueños y entre locales en las descargas).
  otherWorker: AuthUser;
  otherSupervisor: AuthUser;
}

interface UploadFile {
  content: Buffer;
  filename: string;
  contentType: string;
}

// Una carga del sistema: cómo enviarla y qué archivos de prueba usar.
interface UploadTarget {
  name: string;
  field: string;
  uploader: (f: Fixture) => AuthUser;
  send: (
    f: Fixture,
    user: AuthUser | null,
    files: UploadFile[],
  ) => request.Test;
  valid: () => Promise<UploadFile> | UploadFile;
  tooBig: () => UploadFile;
  disguised: () => UploadFile[];
  truncated: () => Promise<UploadFile> | UploadFile;
  successStatus: number;
}

describe.skipIf(!databaseUrl)(
  'Regresión de cargas de archivos (SPRINT-4R-T18)',
  { timeout: 120_000 },
  () => {
    let app: INestApplication<App>;
    let jwt: JwtService;
    let prisma: PrismaClient;
    let switchable: SwitchablePrisma;
    let storageRoot: string;

    function token(user: AuthUser): string {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        storeId: user.storeId,
      };
      return jwt.sign(payload);
    }

    function post(url: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).post(url);
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    function get(url: string, user: AuthUser | null): request.Test {
      const req = request(app.getHttpServer()).get(url);
      return user ? req.set('Authorization', `Bearer ${token(user)}`) : req;
    }

    // Descarga con el cuerpo como bytes crudos, sea cual sea el tipo (PDF,
    // imagen, .xlsx o el JSON de un error).
    function download(url: string, user: AuthUser | null): request.Test {
      return get(url, user)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
    }

    function attachAll(
      req: request.Test,
      field: string,
      files: UploadFile[],
    ): request.Test {
      let result = req;
      for (const file of files) {
        result = result.attach(field, file.content, {
          filename: file.filename,
          contentType: file.contentType,
        });
      }
      return result;
    }

    // Excel ficticio con el identificador de local del fixture y un día
    // propio para que cada carga válida sea un archivo distinto.
    async function excel(f: Fixture): Promise<Buffer> {
      const day = String(randomInt(1, 28)).padStart(2, '0');
      return buildReportXlsx([
        buildReportSheet({
          title: null,
          period: `${day}/03/2026 al ${day}/03/2026`,
          filters: ` - Todas las Empresas - Local: ${f.externalCode} - Todos los Sectores`,
          lines: f.reportLines,
        }),
      ]);
    }

    let fixtureRef: Fixture | null = null;

    const TARGETS: UploadTarget[] = [
      {
        name: 'documento laboral',
        field: 'file',
        uploader: (f) => f.admin,
        send: (f, user, files) =>
          attachAll(
            post('/documents', user)
              .field('workerId', f.worker.id)
              .field('documentTypeCode', 'CONTRATO')
              .field('title', 'Contrato de prueba'),
            'file',
            files,
          ),
        valid: () => ({
          content: pdf(),
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        }),
        tooBig: () => ({
          content: oversized(pdf(), DOCUMENTS_LIMIT_BYTES),
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        }),
        disguised: () => [
          {
            content: EXE,
            filename: 'contrato.pdf',
            contentType: 'application/pdf',
          },
          // PNG real declarado como PDF.
          {
            content: PNG,
            filename: 'contrato.pdf',
            contentType: 'application/pdf',
          },
        ],
        truncated: () => ({
          content: truncatedPdf(),
          filename: 'contrato.pdf',
          contentType: 'application/pdf',
        }),
        successStatus: 201,
      },
      {
        name: 'liquidación de sueldo',
        field: 'file',
        uploader: (f) => f.accountant,
        send: (f, user, files) =>
          attachAll(
            post('/payroll', user)
              .field('workerId', f.worker.id)
              .field('period', `2026-0${randomInt(1, 9)}`),
            'file',
            files,
          ),
        valid: () => ({
          content: pdf(),
          filename: 'liquidacion.pdf',
          contentType: 'application/pdf',
        }),
        tooBig: () => ({
          content: oversized(pdf(), DOCUMENTS_LIMIT_BYTES),
          filename: 'liquidacion.pdf',
          contentType: 'application/pdf',
        }),
        disguised: () => [
          {
            content: EXE,
            filename: 'liquidacion.pdf',
            contentType: 'application/pdf',
          },
          // Las liquidaciones solo aceptan PDF: una imagen renombrada no pasa.
          {
            content: PNG,
            filename: 'liquidacion.pdf',
            contentType: 'application/pdf',
          },
        ],
        truncated: () => ({
          content: truncatedPdf(),
          filename: 'liquidacion.pdf',
          contentType: 'application/pdf',
        }),
        successStatus: 201,
      },
      {
        name: 'voucher de la operación diaria',
        field: 'voucher',
        uploader: (f) => f.supervisor,
        send: (f, user, files) =>
          attachAll(
            post('/daily-operations', user)
              .field('storeId', f.storeId)
              .field('businessDate', '2026-03-10')
              .field('cardTipAmount', '1000')
              .field('cashTipAmount', '0')
              .field('cashDifference', '0')
              .field('participantIds', f.worker.id),
            'voucher',
            files,
          ),
        valid: () => ({
          content: jpeg(),
          filename: 'voucher.jpg',
          contentType: 'image/jpeg',
        }),
        tooBig: () => ({
          content: oversized(jpeg(), MAX_VOUCHER_BYTES),
          filename: 'voucher.jpg',
          contentType: 'image/jpeg',
        }),
        disguised: () => [
          { content: EXE, filename: 'voucher.jpg', contentType: 'image/jpeg' },
          // PDF real renombrado como foto.
          {
            content: pdf(),
            filename: 'voucher.jpg',
            contentType: 'image/jpeg',
          },
        ],
        truncated: () => ({
          content: truncatedJpeg(),
          filename: 'voucher.jpg',
          contentType: 'image/jpeg',
        }),
        successStatus: 201,
      },
      {
        name: 'Excel de ventas MrComanda',
        field: 'file',
        uploader: (f) => f.admin,
        send: (_f, user, files) =>
          attachAll(post('/sales-imports/preview', user), 'file', files),
        valid: async () => ({
          content: await excel(fixture()),
          filename: 'ventas.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        tooBig: () => ({
          content: oversized(
            Buffer.from([0x50, 0x4b, 0x03, 0x04]),
            MAX_REPORT_FILE_BYTES,
          ),
          filename: 'ventas.xlsx',
          contentType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        disguised: () => [
          {
            content: EXE,
            filename: 'ventas.xlsx',
            contentType: 'application/octet-stream',
          },
          { content: CSV, filename: 'ventas.xlsx', contentType: 'text/csv' },
          {
            content: pdf(),
            filename: 'ventas.xlsx',
            contentType: 'application/pdf',
          },
        ],
        truncated: async () => {
          const full = await excel(fixture());
          return {
            content: full.subarray(0, Math.floor(full.length / 2)),
            filename: 'ventas.xlsx',
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
        },
        successStatus: 201,
      },
    ];

    function fixture(): Fixture {
      if (!fixtureRef) throw new Error('No hay fixture activo');
      return fixtureRef;
    }

    async function createUser(
      tx: Tx,
      role: RoleCode,
      storeId: string | null,
    ): Promise<AuthUser> {
      const roleRecord = await tx.role.upsert({
        where: { code: role },
        update: {},
        create: { code: role, name: role },
      });
      const id = randomUUID();
      const email = `${id}@upload-hardening-test.invalid`;
      await tx.user.create({
        data: {
          id,
          email,
          passwordHash: '$2b$04$hash-de-prueba',
          firstName: role,
          lastName: 'Cargas',
          roleId: roleRecord.id,
          storeId,
        },
      });
      return { id, email, role, storeId };
    }

    async function createFixture(tx: Tx): Promise<Fixture> {
      for (const type of DOCUMENT_TYPES) {
        await tx.documentType.upsert({
          where: { code: type.code },
          update: {},
          create: type,
        });
      }
      const store = await tx.store.create({
        data: {
          name: `Subway Cargas ${randomUUID()}`,
          city: 'Melipilla',
          address: 'Calle sintética 123',
        },
      });
      // Segundo local para probar el cruce entre locales en las descargas.
      const otherStore = await tx.store.create({
        data: {
          name: `Subway Cargas Otro ${randomUUID()}`,
          city: 'Calera',
          address: 'Calle sintética 456',
        },
      });
      // El local se identifica por su ID Subway (SPRINT-4A-T17).
      const subwayStoreId = fakeSubwayStoreId();
      await tx.store.update({
        where: { id: store.id },
        data: { subwayStoreId },
      });
      const externalCode = `6${randomInt(10, 99)} - ${subwayStoreId}`;
      // Etiquetas propias en el Excel y en sus alias: no se escriben los
      // alias compartidos (EFECTIVO, T. DEBITO, ...), porque la transacción
      // de rollback retendría su bloqueo y provocaría deadlocks con el seed
      // y otros tests que corren en paralelo. Los medios base los siembra la
      // migración: solo se leen. Este test cubre la seguridad de las cargas;
      // la lectura de las etiquetas reales la cubren SPRINT-4R-T09 y T10.
      const suffix = randomUUID().slice(0, 8).toUpperCase();
      const reportAliases = [
        { label: `T18 DEBITO ${suffix}`, code: 'DEBIT_CARD', amount: 400_000 },
        { label: `T18 EFECTIVO ${suffix}`, code: 'CASH', amount: 150_000 },
        {
          label: `T18 CREDITO ${suffix}`,
          code: 'CREDIT_CARD',
          amount: 100_000,
        },
      ] as const;
      for (const alias of reportAliases) {
        await tx.paymentMethodAlias.create({
          data: {
            system: 'MRCOMANDA',
            label: alias.label,
            normalizedLabel: alias.label,
            paymentMethodId: await paymentMethodIdOf(tx, alias.code),
          },
        });
      }
      return {
        tx,
        storeId: store.id,
        externalCode,
        reportLines: reportAliases.map(({ label, amount }) => ({
          label,
          amount,
        })),
        admin: await createUser(tx, ROLE.ADMINISTRADOR, null),
        accountant: await createUser(tx, ROLE.CONTADOR, null),
        supervisor: await createUser(tx, ROLE.SUPERVISOR, store.id),
        worker: await createUser(tx, ROLE.TRABAJADOR, store.id),
        otherWorker: await createUser(tx, ROLE.TRABAJADOR, store.id),
        otherSupervisor: await createUser(tx, ROLE.SUPERVISOR, otherStore.id),
      };
    }

    async function withinRollback(
      run: (fixture: Fixture) => Promise<void>,
    ): Promise<void> {
      try {
        await prisma.$transaction(
          async (tx) => {
            switchable.use(tx);
            fixtureRef = await createFixture(tx);
            await run(fixtureRef);
            throw new Rollback();
          },
          { maxWait: 30_000, timeout: 110_000 },
        );
      } catch (error) {
        if (!(error instanceof Rollback)) throw error;
      } finally {
        switchable.use(null);
        fixtureRef = null;
      }
    }

    async function storedFiles(): Promise<string[]> {
      const entries = await fs
        .readdir(storageRoot, { recursive: true, withFileTypes: true })
        .catch(() => []);
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name));
    }

    // Ninguna respuesta puede mostrar la carpeta privada, rutas físicas
    // relativas (AAAA/MM/<uuid>.<ext>) ni el campo interno filePath.
    function expectNoInternalPaths(body: unknown, context: string): void {
      const text = JSON.stringify(body ?? '');
      const variants = [
        storageRoot,
        storageRoot.replace(/\\/g, '/'),
        storageRoot.replace(/\\/g, '\\\\'),
        os.tmpdir(),
      ];
      for (const variant of variants) {
        expect(text, context).not.toContain(variant);
      }
      expect(text, context).not.toMatch(
        /\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+/,
      );
      expect(text, context).not.toMatch(/(vouchers|sales-imports)\//);
      expect(text, context).not.toContain('filePath');
      expect(text, context).not.toContain('node_modules');
    }

    // Envía una carga que debe rechazarse y verifica estado, ausencia de
    // rutas internas y que no quedó ningún archivo en disco.
    async function expectRejected(
      target: UploadTarget,
      user: AuthUser | null,
      files: UploadFile[],
      status: number,
      label: string,
    ): Promise<void> {
      const before = await storedFiles();
      const response = await target.send(fixture(), user, files);
      const context = `${target.name}: ${label}`;
      expect(response.status, context).toBe(status);
      expectNoInternalPaths(response.body, context);
      expect(await storedFiles(), context).toEqual(before);
    }

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      process.env.JWT_SECRET = 'secreto-de-pruebas';
      process.env.JWT_EXPIRES_IN = '1h';
      process.env.JWT_REFRESH_EXPIRES_IN = '7d';
      storageRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'moifood-uploads-'),
      );
      process.env.DOCUMENTS_STORAGE_PATH = storageRoot;
      process.env.DOCUMENTS_MAX_SIZE_MB = String(DOCUMENTS_LIMIT_MB);

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
      await fs.rm(storageRoot, { recursive: true, force: true });
    });

    beforeEach(async () => {
      await fs.rm(storageRoot, { recursive: true, force: true });
      await fs.mkdir(storageRoot, { recursive: true });
    });

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: una carga válida se acepta y su respuesta no expone rutas',
      async (_name, target) => {
        await withinRollback(async (f) => {
          const response = await target.send(f, target.uploader(f), [
            await target.valid(),
          ]);
          expect(response.status, target.name).toBe(target.successStatus);
          expectNoInternalPaths(response.body, target.name);
          // El archivo quedó guardado en la carpeta privada.
          expect(await storedFiles()).toHaveLength(1);
        });
      },
    );

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: tamaño excedido responde 413 sin guardar nada',
      async (_name, target) => {
        await withinRollback(async (f) => {
          await expectRejected(
            target,
            target.uploader(f),
            [target.tooBig()],
            413,
            'tamaño excedido',
          );
        });
      },
    );

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: extensión o tipo falsos responden 415 sin guardar nada',
      async (_name, target) => {
        await withinRollback(async (f) => {
          for (const [index, file] of target.disguised().entries()) {
            await expectRejected(
              target,
              target.uploader(f),
              [file],
              415,
              `disfraz ${index + 1}`,
            );
          }
        });
      },
    );

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: un archivo cortado responde 422 sin guardar nada',
      async (_name, target) => {
        await withinRollback(async (f) => {
          await expectRejected(
            target,
            target.uploader(f),
            [await target.truncated()],
            422,
            'archivo cortado',
          );
        });
      },
    );

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: dos archivos en una solicitud responden 400',
      async (_name, target) => {
        await withinRollback(async (f) => {
          await expectRejected(
            target,
            target.uploader(f),
            [await target.valid(), await target.valid()],
            400,
            'dos archivos',
          );
        });
      },
    );

    it.each(TARGETS.map((target) => [target.name, target] as const))(
      '%s: sin sesión responde 401 y con un rol ajeno 403',
      async (_name, target) => {
        await withinRollback(async (f) => {
          const file = await target.valid();
          await expectRejected(target, null, [file], 401, 'sin sesión');
          await expectRejected(target, f.worker, [file], 403, 'rol ajeno');
        });
      },
    );

    it('Excel de ventas MrComanda: una bomba zip responde 413 sin guardar nada', async () => {
      await withinRollback(async (f) => {
        const bomb = zipBomb(MAX_UNCOMPRESSED_BYTES + 5 * 1024 * 1024);
        // Pesa menos que el límite de carga: solo el tope descomprimido la
        // detiene.
        expect(bomb.length).toBeLessThan(MAX_REPORT_FILE_BYTES);
        const before = await storedFiles();
        const response = await attachAll(
          post('/sales-imports/preview', f.admin),
          'file',
          [
            {
              content: bomb,
              filename: 'ventas.xlsx',
              contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            },
          ],
        );
        expect(response.status).toBe(413);
        expect(response.body).toMatchObject({ code: 'FILE_TOO_LARGE' });
        expectNoInternalPaths(response.body, 'bomba zip');
        expect(await storedFiles()).toEqual(before);
      });
    });

    it('la carpeta privada no se sirve por URL directa', async () => {
      await withinRollback(async (f) => {
        const uploaded = await TARGETS[2].send(f, f.supervisor, [
          await TARGETS[2].valid(),
        ]);
        expect(uploaded.status).toBe(201);
        const [stored] = await storedFiles();
        const relative = path
          .relative(storageRoot, stored)
          .split(path.sep)
          .join('/');
        for (const url of [
          `/${relative}`,
          `/storage/${relative}`,
          `/storage/documents/${relative}`,
          `/api/${relative}`,
        ]) {
          const response = await get(url, f.admin);
          expect(response.status, url).toBe(404);
          // El 404 de Nest repite la URL que pidió el propio cliente («Cannot
          // GET …»); eso no es una ruta del servidor, así que se descuenta
          // antes de buscar rutas internas.
          const echoed = JSON.stringify(response.body).replace(url, '');
          expectNoInternalPaths(echoed, url);
        }
      });
    });

    // Carga un archivo de cada tipo y devuelve su URL de descarga con el
    // contenido exacto que se subió. La liquidación se publica para que su
    // dueño pueda descargarla.
    interface Uploaded {
      url: string;
      content: Buffer;
      filename: string;
      integrityHeader: string;
    }

    async function uploadAll(f: Fixture): Promise<{
      document: Uploaded;
      payslip: Uploaded;
      voucher: Uploaded;
      excel: Uploaded;
    }> {
      const [documentTarget, payslipTarget, voucherTarget, excelTarget] =
        TARGETS;
      const documentFile = await documentTarget.valid();
      const document = await documentTarget.send(f, f.admin, [documentFile]);
      expect(document.status).toBe(201);
      const payslipFile = await payslipTarget.valid();
      const payslip = await payslipTarget.send(f, f.accountant, [payslipFile]);
      expect(payslip.status).toBe(201);
      const uploadedPayslip = payslip.body as { id: string; revision: number };
      await request(app.getHttpServer())
        .post(`/payroll/${uploadedPayslip.id}/publish`)
        .set('Authorization', `Bearer ${token(f.accountant)}`)
        .send({ revision: uploadedPayslip.revision })
        .expect(200);
      const voucherFile = await voucherTarget.valid();
      const voucher = await voucherTarget.send(f, f.supervisor, [voucherFile]);
      expect(voucher.status).toBe(201);
      const excelFile = await excelTarget.valid();
      const excel = await excelTarget.send(f, f.admin, [excelFile]);
      expect(excel.status).toBe(201);

      const versionId = (document.body as { latestVersion: { id: string } })
        .latestVersion.id;
      return {
        document: {
          url: `/documents/versions/${versionId}/download`,
          content: documentFile.content,
          integrityHeader: 'x-document-integrity',
        },
        payslip: {
          url: `/payroll/mine/${uploadedPayslip.id}/download`,
          content: payslipFile.content,
          integrityHeader: 'x-document-integrity',
        },
        voucher: {
          url: `/daily-operations/${(voucher.body as { id: string }).id}/voucher`,
          content: voucherFile.content,
          integrityHeader: 'x-voucher-integrity',
        },
        excel: {
          url: `/sales-imports/${(excel.body as { import: { id: string } }).import.id}/file`,
          content: excelFile.content,
          integrityHeader: 'x-file-integrity',
        },
      };
    }

    it('la descarga autorizada entrega el archivo íntegro y sin rutas', async () => {
      await withinRollback(async (f) => {
        const files = await uploadAll(f);
        const allowed: [Uploaded, AuthUser, string][] = [
          [files.document, f.admin, 'documento: administrador'],
          [files.document, f.worker, 'documento: trabajador dueño'],
          [files.payslip, f.worker, 'liquidación: trabajador dueño'],
          [files.voucher, f.supervisor, 'voucher: supervisor del local'],
          [files.voucher, f.accountant, 'voucher: contador'],
          [files.voucher, f.admin, 'voucher: administrador'],
          [files.excel, f.admin, 'Excel: administrador'],
        ];
        for (const [file, user, context] of allowed) {
          const response = await download(file.url, user);
          expect(response.status, context).toBe(200);
          expect(
            (response.body as Buffer).equals(file.content),
            `${context}: mismos bytes que se subieron`,
          ).toBe(true);
          expect(response.headers[file.integrityHeader], context).toBe('VALID');
          expect(response.headers['x-content-type-options'], context).toBe(
            'nosniff',
          );
          const disposition = String(response.headers['content-disposition']);
          expect(disposition, context).toMatch(/^attachment;/);
          expectNoInternalPaths(disposition, context);
        }
      });
    });

    it('la descarga se niega entre locales, entre dueños y por rol sin filtrar el archivo', async () => {
      await withinRollback(async (f) => {
        const files = await uploadAll(f);
        const denied: [Uploaded, AuthUser, number, string][] = [
          [
            files.voucher,
            f.otherSupervisor,
            403,
            'voucher: supervisor de otro local',
          ],
          [files.document, f.otherWorker, 403, 'documento: otro trabajador'],
          [
            files.document,
            f.otherSupervisor,
            403,
            'documento: supervisor de otro local',
          ],
          [files.payslip, f.otherWorker, 404, 'liquidación: otro trabajador'],
          [files.excel, f.supervisor, 403, 'Excel: supervisor'],
          [files.excel, f.accountant, 403, 'Excel: contador'],
        ];
        for (const [file, user, status, context] of denied) {
          const response = await download(file.url, user);
          expect(response.status, context).toBe(status);
          const body = response.body as Buffer;
          expect(body.includes(file.content), context).toBe(false);
          expectNoInternalPaths(body.toString('utf8'), context);
        }
      });
    });

    it('la descarga de un archivo ausente en disco responde 404 sin rutas', async () => {
      await withinRollback(async (f) => {
        // Documento y voucher cargados, y luego borrados del volumen.
        const document = await TARGETS[0].send(f, f.admin, [
          await TARGETS[0].valid(),
        ]);
        const voucher = await TARGETS[2].send(f, f.supervisor, [
          await TARGETS[2].valid(),
        ]);
        const excel = await TARGETS[3].send(f, f.admin, [
          await TARGETS[3].valid(),
        ]);
        for (const stored of await storedFiles()) await fs.rm(stored);

        const versionId = (document.body as { latestVersion: { id: string } })
          .latestVersion.id;
        const operationId = (voucher.body as { id: string }).id;
        const importId = (excel.body as { import: { id: string } }).import.id;
        for (const url of [
          `/documents/versions/${versionId}/download`,
          `/daily-operations/${operationId}/voucher`,
          `/sales-imports/${importId}/file`,
        ]) {
          const response = await get(url, f.admin);
          expect(response.status, url).toBe(404);
          expectNoInternalPaths(response.body, url);
        }
      });
    });
  },
);
