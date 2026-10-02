import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AUDIT_ACTION } from '../src/audit/constants/audit-actions.constants.js';
import { ROLE } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import type { UserResponse } from '../src/users/types/users.types.js';

type App = Parameters<typeof request>[0];

// Tests de integración del interceptor de auditoría (SPRINT-1-T13) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual que en
// users.integration.spec.ts, los datos van por HTTP: usan el dominio
// @audit-test.moi-food.cl y un local propio, y se eliminan al finalizar.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@audit-test.moi-food.cl';
const ADMIN_EMAIL = `admin${DOMAIN}`;
const WORKER_EMAIL = `trabajador${DOMAIN}`;
const PASSWORD = 'ClaveInicial123';
const USER_AGENT = 'agente-auditoria-test';

describe.skipIf(!databaseUrl)('Interceptor de auditoría (SPRINT-1-T13)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let storeId: string;
  let adminId: string;
  let adminToken: string;
  let workerId: string;

  // Filtra solo los registros generados por este archivo: los del actor
  // (usuarios del dominio) y los que guardan el correo en detail (los logins
  // fallidos no tienen actor identificado).
  const scopedWhere: Prisma.AuditLogWhereInput = {
    OR: [
      { user: { email: { endsWith: DOMAIN } } },
      { detail: { path: ['email'], string_ends_with: DOMAIN } },
    ],
  };

  async function cleanup(): Promise<void> {
    // Primero la auditoría: borrar los usuarios deja userId en NULL (SetNull)
    // y se perdería el filtro por actor.
    await prisma.auditLog.deleteMany({ where: scopedWhere });
    // Borrar los usuarios elimina sus refresh tokens en cascada.
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.store.deleteMany({
      where: { name: { startsWith: 'Subway Audit Test' } },
    });
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

    const store = await prisma.store.create({
      data: {
        name: 'Subway Audit Test',
        city: 'Melipilla',
        address: 'Calle de prueba 123',
      },
    });
    storeId = store.id;

    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: ROLE.ADMINISTRADOR },
    });
    const admin = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        firstName: 'Admin',
        lastName: 'Auditoría',
        roleId: adminRole.id,
      },
    });
    adminId = admin.id;
    const payload: JwtPayload = {
      sub: adminId,
      email: ADMIN_EMAIL,
      role: ROLE.ADMINISTRADOR,
      storeId: null,
    };
    adminToken = await jwt.signAsync(payload);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  function auditCount(): Promise<number> {
    return prisma.auditLog.count({ where: scopedWhere });
  }

  // El último registro de una acción dentro del alcance de este archivo.
  function lastAudit(action: string) {
    return prisma.auditLog.findFirstOrThrow({
      where: { ...scopedWhere, action },
      orderBy: { createdAt: 'desc' },
    });
  }

  function createWorker() {
    return request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('User-Agent', USER_AGENT)
      .send({
        email: WORKER_EMAIL,
        password: PASSWORD,
        firstName: 'Juan',
        lastName: 'Auditado',
        roleCode: ROLE.TRABAJADOR,
        storeId,
      });
  }

  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('User-Agent', USER_AGENT)
      .send({ email, password });
  }

  it('registra la creación de usuarios con actor, entidad y detalle sin contraseña', async () => {
    const respuesta = await createWorker().expect(201);
    workerId = (respuesta.body as UserResponse).id;

    const log = await lastAudit(AUDIT_ACTION.USER_CREATED);
    expect(log.entityType).toBe('users');
    expect(log.entityId).toBe(workerId);
    // El actor es el administrador; el local es el del usuario creado.
    expect(log.userId).toBe(adminId);
    expect(log.storeId).toBe(storeId);
    expect(log.detail).toEqual({
      email: WORKER_EMAIL,
      roleCode: ROLE.TRABAJADOR,
    });
    expect(JSON.stringify(log.detail)).not.toContain('password');
    expect(log.ipAddress).not.toBeNull();
    expect(log.userAgent).toBe(USER_AGENT);
  });

  it('registra el inicio de sesión exitoso con el usuario y su local', async () => {
    await login(WORKER_EMAIL, PASSWORD).expect(200);

    const log = await lastAudit(AUDIT_ACTION.USER_LOGIN);
    expect(log.entityType).toBe('auth');
    expect(log.userId).toBe(workerId);
    expect(log.entityId).toBe(workerId);
    expect(log.storeId).toBe(storeId);
    expect(log.detail).toEqual({ email: WORKER_EMAIL });
    expect(log.ipAddress).not.toBeNull();
    expect(log.userAgent).toBe(USER_AGENT);
  });

  it('registra el inicio de sesión fallido sin identificar al usuario', async () => {
    await login(WORKER_EMAIL, 'ClaveEquivocada123').expect(401);

    const log = await lastAudit(AUDIT_ACTION.USER_LOGIN_FAILED);
    expect(log.entityType).toBe('auth');
    expect(log.userId).toBeNull();
    expect(log.entityId).toBeNull();
    expect(log.storeId).toBeNull();
    expect(log.detail).toEqual({ email: WORKER_EMAIL });
    expect(log.ipAddress).not.toBeNull();
  });

  it('no registra logins rechazados por validación (400) ni accesos bloqueados por los guards', async () => {
    const antes = await auditCount();

    // 400: el cuerpo no supera la validación del DTO (no es un intento real).
    await login('no-es-correo', PASSWORD).expect(400);
    // 401 del JwtAuthGuard: la solicitud ni siquiera llega al endpoint.
    await request(app.getHttpServer()).get('/users').expect(401);

    expect(await auditCount()).toBe(antes);
  });

  it('registra la desactivación con el ID de la ruta y el administrador como actor', async () => {
    await request(app.getHttpServer())
      .patch(`/users/${workerId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const log = await lastAudit(AUDIT_ACTION.USER_DEACTIVATED);
    expect(log.entityType).toBe('users');
    expect(log.entityId).toBe(workerId);
    expect(log.userId).toBe(adminId);
    expect(log.storeId).toBe(storeId);
    expect(log.detail).toBeNull();
  });

  it('no registra operaciones no marcadas con @Audited', async () => {
    const antes = await auditCount();

    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(await auditCount()).toBe(antes);
  });
});
