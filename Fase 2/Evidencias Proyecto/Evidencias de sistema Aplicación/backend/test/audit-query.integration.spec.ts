import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import type {
  AuditLogPage,
  AuditLogResponse,
} from '../src/audit/types/audit.types.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

interface ErrorResponse {
  message: string | string[];
}

// Tests de integración de la consulta de auditoría (SPRINT-1-T14) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual que en
// audit.integration.spec.ts, la API se ejercita por HTTP (no se puede envolver
// en una transacción revertida): los datos usan el dominio
// @audit-query-test.moi-food.cl, locales propios y fechas de julio de 2025
// (sin datos reales), y se eliminan al finalizar sin dejar residuos.
//
// En julio Chile está en horario de invierno (UTC-4): el día 2025-07-10 en
// Chile va de 2025-07-10T04:00Z a 2025-07-11T04:00Z.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@audit-query-test.moi-food.cl';
const STORE_PREFIX = 'Subway Audit Query Test';

describe.skipIf(!databaseUrl)('Consulta de auditoría (SPRINT-1-T14)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let adminToken: string;
  let storeA: { id: string; name: string };
  let storeB: { id: string; name: string };
  let admin: { id: string; email: string; firstName: string; lastName: string };
  let worker: { id: string };
  // IDs de los registros sembrados, por nombre del escenario.
  const ids: Record<string, string> = {};

  async function cleanup(): Promise<void> {
    // Primero la auditoría: con FK RESTRICT (SPRINT-1-T15) no se pueden borrar usuarios ni locales
    // que tengan registros, y estos se purgan con el helper porque audit_logs
    // es inmutable.
    await purgeTestAuditLogs(prisma, {
      OR: [
        { store: { name: { startsWith: STORE_PREFIX } } },
        { user: { email: { endsWith: DOMAIN } } },
        { detail: { path: ['email'], string_ends_with: DOMAIN } },
      ],
    });
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.store.deleteMany({
      where: { name: { startsWith: STORE_PREFIX } },
    });
  }

  function tokenFor(sub: string, role: RoleCode, storeId: string | null) {
    const payload: JwtPayload = {
      sub,
      email: `token${DOMAIN}`,
      role,
      storeId,
    };
    return jwt.signAsync(payload);
  }

  // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
  function listAuditLogs(query: string, token = adminToken) {
    return request(app.getHttpServer())
      .get(`/audit-logs${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function page(query: string): Promise<AuditLogPage> {
    const respuesta = await listAuditLogs(query).expect(200);
    return respuesta.body as AuditLogPage;
  }

  function itemIds(result: AuditLogPage): string[] {
    return result.items.map((item) => item.id);
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'secreto-de-pruebas';
    process.env.JWT_EXPIRES_IN = '1h';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';

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

    // Roles base por si la BD no está sembrada.
    for (const code of Object.values(ROLE)) {
      await prisma.role.upsert({
        where: { code },
        update: {},
        create: { code, name: code },
      });
    }
    const roles = await prisma.role.findMany();
    const roleId = (code: RoleCode): number => {
      const role = roles.find((r) => r.code === code);
      if (!role) throw new Error(`Falta el rol ${code}`);
      return role.id;
    };

    storeA = await prisma.store.create({
      data: { name: `${STORE_PREFIX} A`, city: 'Melipilla', address: 'A 1' },
      select: { id: true, name: true },
    });
    storeB = await prisma.store.create({
      data: { name: `${STORE_PREFIX} B`, city: 'Calera', address: 'B 2' },
      select: { id: true, name: true },
    });
    admin = await prisma.user.create({
      data: {
        email: `admin${DOMAIN}`,
        passwordHash: '$2b$04$hash-de-prueba',
        firstName: 'Admin',
        lastName: 'Consulta',
        roleId: roleId(ROLE.ADMINISTRADOR),
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    worker = await prisma.user.create({
      data: {
        email: `trabajador${DOMAIN}`,
        passwordHash: '$2b$04$hash-de-prueba',
        firstName: 'Ana',
        lastName: 'Auditada',
        roleId: roleId(ROLE.TRABAJADOR),
        storeId: storeA.id,
      },
      select: { id: true },
    });
    adminToken = await tokenFor(admin.id, ROLE.ADMINISTRADOR, null);

    const seed: Array<{
      key: string;
      action: string;
      createdAt: string;
      storeId: string | null;
      userId: string | null;
      detail?: Record<string, string>;
    }> = [
      // 09:00 del 09-07 en Chile.
      {
        key: 'creadoA09',
        action: AUDIT_ACTION.USER_CREATED,
        createdAt: '2025-07-09T13:00:00Z',
        storeId: storeA.id,
        userId: admin.id,
      },
      // 09:00 del 10-07 en Chile.
      {
        key: 'loginA10',
        action: AUDIT_ACTION.USER_LOGIN,
        createdAt: '2025-07-10T13:00:00Z',
        storeId: storeA.id,
        userId: worker.id,
      },
      // 11:00 del 10-07 en Chile, en el otro local.
      {
        key: 'desactivadoB10',
        action: AUDIT_ACTION.USER_DEACTIVATED,
        createdAt: '2025-07-10T15:00:00Z',
        storeId: storeB.id,
        userId: admin.id,
      },
      // 12:00 del 10-07 en Chile: operación global sin actor identificado.
      {
        key: 'fallidoGlobal10',
        action: AUDIT_ACTION.USER_LOGIN_FAILED,
        createdAt: '2025-07-10T16:00:00Z',
        storeId: null,
        userId: null,
        detail: { email: `desconocido${DOMAIN}` },
      },
      // 23:30 del 10-07 en Chile, que en UTC ya es el 11-07.
      {
        key: 'creadoA10Noche',
        action: AUDIT_ACTION.USER_CREATED,
        createdAt: '2025-07-11T03:30:00Z',
        storeId: storeA.id,
        userId: admin.id,
        detail: { email: `nuevo${DOMAIN}`, roleCode: ROLE.TRABAJADOR },
      },
      // 00:30 del 11-07 en Chile.
      {
        key: 'loginA11',
        action: AUDIT_ACTION.USER_LOGIN,
        createdAt: '2025-07-11T04:30:00Z',
        storeId: storeA.id,
        userId: worker.id,
      },
    ];
    for (const entry of seed) {
      const log = await prisma.auditLog.create({
        data: {
          action: entry.action,
          entityType: 'users',
          entityId: entry.userId,
          detail: entry.detail,
          ipAddress: '10.0.0.1',
          userAgent: 'agente-consulta-test',
          createdAt: new Date(entry.createdAt),
          userId: entry.userId,
          storeId: entry.storeId,
        },
      });
      ids[entry.key] = log.id.toString();
    }
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('exige autenticación', async () => {
    await request(app.getHttpServer()).get('/audit-logs').expect(401);
  });

  it('rechaza con 403 a los roles distintos del administrador', async () => {
    for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
      const storeId = role === ROLE.CONTADOR ? null : storeA.id;
      const token = await tokenFor(worker.id, role, storeId);
      await listAuditLogs('', token).expect(403);
    }
  });

  it('muestra cada operación con usuario responsable, fecha/hora, local y tipo', async () => {
    const resultado = await page(
      `?storeId=${storeA.id}&from=2025-07-10&to=2025-07-10`,
    );

    const creado = resultado.items.find(
      (item) => item.id === ids.creadoA10Noche,
    );
    expect(creado).toEqual<AuditLogResponse>({
      id: ids.creadoA10Noche,
      action: AUDIT_ACTION.USER_CREATED,
      entityType: 'users',
      entityId: admin.id,
      detail: { email: `nuevo${DOMAIN}`, roleCode: ROLE.TRABAJADOR },
      ipAddress: '10.0.0.1',
      userAgent: 'agente-consulta-test',
      // createdAt viaja como texto ISO 8601 en el JSON.
      createdAt: '2025-07-11T03:30:00.000Z' as unknown as Date,
      user: admin,
      store: storeA,
    });
  });

  it('filtra por local y por día de negocio en hora de Chile', async () => {
    // El registro de las 23:30 del 10-07 (03:30Z del 11-07) cae en el 10-07.
    const dia10 = await page(
      `?storeId=${storeA.id}&from=2025-07-10&to=2025-07-10`,
    );
    expect(itemIds(dia10)).toEqual([ids.creadoA10Noche, ids.loginA10]);
    expect(dia10.total).toBe(2);

    const dia11 = await page(
      `?storeId=${storeA.id}&from=2025-07-11&to=2025-07-11`,
    );
    expect(itemIds(dia11)).toEqual([ids.loginA11]);

    const localB = await page(`?storeId=${storeB.id}`);
    expect(itemIds(localB)).toEqual([ids.desactivadoB10]);
  });

  it('sin filtro de local incluye todos los locales y las operaciones globales', async () => {
    const resultado = await page('?from=2025-07-10&to=2025-07-10');
    expect(itemIds(resultado)).toEqual([
      ids.creadoA10Noche,
      ids.fallidoGlobal10,
      ids.desactivadoB10,
      ids.loginA10,
    ]);

    const fallido = resultado.items.find(
      (item) => item.id === ids.fallidoGlobal10,
    );
    expect(fallido?.user).toBeNull();
    expect(fallido?.store).toBeNull();
    expect(fallido?.detail).toEqual({ email: `desconocido${DOMAIN}` });
  });

  it('acepta rangos abiertos por un extremo', async () => {
    const desde = await page(`?storeId=${storeA.id}&from=2025-07-11`);
    expect(itemIds(desde)).toEqual([ids.loginA11]);

    const hasta = await page(`?storeId=${storeA.id}&to=2025-07-09`);
    expect(itemIds(hasta)).toEqual([ids.creadoA09]);
  });

  it('pagina del más reciente al más antiguo informando el total', async () => {
    const filtros = `storeId=${storeA.id}&from=2025-07-09&to=2025-07-11`;

    const primera = await page(`?${filtros}&limit=2`);
    expect(primera).toMatchObject({ total: 4, limit: 2, offset: 0 });
    expect(itemIds(primera)).toEqual([ids.loginA11, ids.creadoA10Noche]);

    const segunda = await page(`?${filtros}&limit=2&offset=2`);
    expect(segunda).toMatchObject({ total: 4, limit: 2, offset: 2 });
    expect(itemIds(segunda)).toEqual([ids.loginA10, ids.creadoA09]);

    const fueraDeRango = await page(`?${filtros}&limit=2&offset=10`);
    expect(fueraDeRango).toMatchObject({ total: 4, items: [] });
  });

  it('sin filtros aplica la paginación por defecto', async () => {
    const resultado = await page('');
    expect(resultado.limit).toBe(50);
    expect(resultado.offset).toBe(0);
    expect(resultado.items.length).toBeLessThanOrEqual(50);
    const fechas = resultado.items.map((item) =>
      new Date(item.createdAt).getTime(),
    );
    expect(fechas).toEqual([...fechas].sort((a, b) => b - a));
  });

  it.each([
    ['local que no es UUID', '?storeId=local-1'],
    ['fecha con formato inválido', '?from=10-07-2025'],
    ['fecha inexistente', '?from=2025-02-30'],
    ['from posterior a to', '?from=2025-07-11&to=2025-07-10'],
    ['limit cero', '?limit=0'],
    ['limit sobre el máximo', '?limit=201'],
    ['limit no numérico', '?limit=muchos'],
    ['offset negativo', '?offset=-1'],
    ['parámetro desconocido', '?userId=x'],
  ])('rechaza con 400: %s', async (_caso, query) => {
    const respuesta = await listAuditLogs(query).expect(400);
    expect((respuesta.body as ErrorResponse).message).toBeTruthy();
  });

  it('la consulta no genera registros de auditoría', async () => {
    // Conteo acotado al actor de este archivo: los demás archivos de test
    // corren en paralelo y también escriben auditoría.
    const delAdmin = { where: { userId: admin.id } };
    const antes = await prisma.auditLog.count(delAdmin);
    await listAuditLogs(`?storeId=${storeA.id}`).expect(200);
    expect(await prisma.auditLog.count(delAdmin)).toBe(antes);
  });

  // SPRINT-1-T15: la API no expone ninguna vía para alterar el registro.
  it('no expone rutas para modificar o eliminar registros, ni siquiera al administrador', async () => {
    const id = ids.loginA10;
    const server = app.getHttpServer();
    const auth = `Bearer ${adminToken}`;

    for (const path of ['/audit-logs', `/audit-logs/${id}`]) {
      await request(server).put(path).set('Authorization', auth).expect(404);
      await request(server)
        .patch(path)
        .set('Authorization', auth)
        .send({ action: 'HACK' })
        .expect(404);
      await request(server).delete(path).set('Authorization', auth).expect(404);
    }

    const log = await prisma.auditLog.findUniqueOrThrow({
      where: { id: BigInt(id) },
    });
    expect(log.action).toBe(AUDIT_ACTION.USER_LOGIN);
  });
});
