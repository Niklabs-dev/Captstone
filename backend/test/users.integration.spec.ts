import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { UserResponse } from '../src/users/types/users.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

interface ErrorResponse {
  message: string | string[];
}

// Tests de integración de la gestión de usuarios (SPRINT-1-T08) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Igual que en
// auth.integration.spec.ts, los datos van por HTTP (no se pueden envolver en
// una transacción revertida): usan el dominio @users-test.moi-food.cl y un
// local propio, y se eliminan al finalizar sin dejar residuos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const DOMAIN = '@users-test.moi-food.cl';
const ADMIN_EMAIL = `admin${DOMAIN}`;
const PASSWORD = 'ClaveInicial123';

describe.skipIf(!databaseUrl)('Gestión de usuarios (SPRINT-1-T08)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let jwt: JwtService;
  let storeId: string;
  let inactiveStoreId: string;
  let adminId: string;
  let adminToken: string;

  async function cleanup(): Promise<void> {
    // Primero la auditoría que generan estos flujos (SPRINT-1-T13): con FK RESTRICT (SPRINT-1-T15) no se pueden borrar usuarios ni locales
    // que tengan registros, y estos se purgan con el helper porque audit_logs
    // es inmutable.
    await purgeTestAuditLogs(prisma, {
      OR: [
        { user: { email: { endsWith: DOMAIN } } },
        { detail: { path: ['email'], string_ends_with: DOMAIN } },
      ],
    });
    // Borrar los usuarios elimina sus refresh tokens en cascada.
    await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
    await prisma.store.deleteMany({
      where: { name: { startsWith: 'Subway Users Test' } },
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
        name: 'Subway Users Test',
        city: 'Melipilla',
        address: 'Calle de prueba 123',
      },
    });
    storeId = store.id;
    const inactiveStore = await prisma.store.create({
      data: {
        name: 'Subway Users Test Inactivo',
        city: 'Calera',
        address: 'Calle de prueba 456',
        isActive: false,
      },
    });
    inactiveStoreId = inactiveStore.id;

    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { code: ROLE.ADMINISTRADOR },
    });
    const admin = await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        firstName: 'Admin',
        lastName: 'Test',
        roleId: adminRole.id,
      },
    });
    adminId = admin.id;
    adminToken = await tokenFor(adminId, ROLE.ADMINISTRADOR, null);
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

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

  // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
  function createUser(body: object, token = adminToken) {
    return request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  function listUsers(query: string, token = adminToken) {
    return request(app.getHttpServer())
      .get(`/users${query}`)
      .set('Authorization', `Bearer ${token}`);
  }

  function deactivate(id: string, token = adminToken) {
    return request(app.getHttpServer())
      .patch(`/users/${id}/deactivate`)
      .set('Authorization', `Bearer ${token}`);
  }

  function login(email: string, password = PASSWORD) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
  }

  function worker(suffix: string, extra: object = {}): object {
    return {
      email: `${suffix}${DOMAIN}`,
      password: PASSWORD,
      firstName: 'Juan',
      lastName: `Pérez ${suffix}`,
      roleCode: ROLE.TRABAJADOR,
      storeId,
      ...extra,
    };
  }

  it('crea un trabajador con rol, local y credenciales iniciales que permiten iniciar sesión', async () => {
    const respuesta = await createUser(
      worker('trabajador', {
        rut: '12.345.678-5',
        phone: '+56912345678',
        hiredAt: '2026-03-01',
      }),
    ).expect(201);
    const user = respuesta.body as UserResponse & { passwordHash?: string };

    expect(user).toMatchObject({
      email: `trabajador${DOMAIN}`,
      rut: '12345678-5',
      phone: '+56912345678',
      hiredAt: '2026-03-01',
      isActive: true,
      role: { code: ROLE.TRABAJADOR },
      store: { id: storeId, name: 'Subway Users Test' },
    });
    expect(user.passwordHash).toBeUndefined();

    // La contraseña se guarda solo como hash bcrypt.
    const guardado = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(guardado.passwordHash).not.toBe(PASSWORD);
    expect(await bcrypt.compare(PASSWORD, guardado.passwordHash)).toBe(true);

    const sesion = await login(`trabajador${DOMAIN}`).expect(200);
    expect((sesion.body as { user: { storeId: string } }).user.storeId).toBe(
      storeId,
    );
  });

  it('crea un usuario global (contador) sin local', async () => {
    const respuesta = await createUser({
      email: `contador${DOMAIN}`,
      password: PASSWORD,
      firstName: 'Ana',
      lastName: 'Contreras',
      roleCode: ROLE.CONTADOR,
    }).expect(201);
    expect((respuesta.body as UserResponse).store).toBeNull();
  });

  it('valida la coherencia entre rol y local', async () => {
    // Rol de local sin local.
    await createUser(worker('sin-local', { storeId: undefined })).expect(400);
    // Rol global con local.
    await createUser(
      worker('global-con-local', { roleCode: ROLE.ADMINISTRADOR }),
    ).expect(400);
    // Local inexistente o inactivo.
    await createUser(
      worker('local-inexistente', {
        storeId: '00000000-0000-4000-8000-000000000000',
      }),
    ).expect(400);
    await createUser(
      worker('local-inactivo', { storeId: inactiveStoreId }),
    ).expect(400);
  });

  it('rechaza datos inválidos (400)', async () => {
    for (const extra of [
      { email: 'no-es-correo' },
      { password: 'corta' },
      { roleCode: 'SUPERUSUARIO' },
      { rut: '12345678-9' },
      { hiredAt: '2026-02-30' },
      { hiredAt: '01-03-2026' },
      { campoExtra: 'no permitido' },
    ]) {
      await createUser(worker('invalido', extra)).expect(400);
    }
    const count = await prisma.user.count({
      where: { email: `invalido${DOMAIN}` },
    });
    expect(count).toBe(0);
  });

  it('responde 409 si el correo o el RUT ya existen', async () => {
    await createUser(worker('duplicado', { rut: '10000013-K' })).expect(201);

    const mismoCorreo = await createUser(worker('duplicado')).expect(409);
    expect((mismoCorreo.body as ErrorResponse).message).toBe(
      'Ya existe un usuario con ese correo o RUT',
    );
    await createUser(worker('otro-correo', { rut: '10.000.013-k' })).expect(
      409,
    );
  });

  it('lista usuarios sin exponer el hash y permite filtrar por local, rol y estado', async () => {
    await createUser(worker('listado-a')).expect(201);
    await createUser(worker('listado-b', { roleCode: ROLE.SUPERVISOR })).expect(
      201,
    );

    const todos = (await listUsers('').expect(200)).body as (UserResponse & {
      passwordHash?: string;
    })[];
    expect(todos.some((u) => u.email === ADMIN_EMAIL)).toBe(true);
    expect(todos.every((u) => u.passwordHash === undefined)).toBe(true);

    const delLocal = (await listUsers(`?storeId=${storeId}`).expect(200))
      .body as UserResponse[];
    expect(delLocal.length).toBeGreaterThanOrEqual(2);
    expect(delLocal.every((u) => u.store?.id === storeId)).toBe(true);

    const supervisores = (
      await listUsers(`?storeId=${storeId}&roleCode=SUPERVISOR`).expect(200)
    ).body as UserResponse[];
    expect(supervisores.map((u) => u.email)).toEqual([`listado-b${DOMAIN}`]);

    await listUsers('?isActive=quizas').expect(400);
    await listUsers('?storeId=no-uuid').expect(400);
  });

  it('desactiva la cuenta: bloquea login y refresh sin borrar sus datos', async () => {
    const creado = (await createUser(worker('desactivar')).expect(201))
      .body as UserResponse;
    const sesion = (await login(`desactivar${DOMAIN}`).expect(200)).body as {
      refreshToken: string;
    };

    // Un documento asociado al trabajador debe conservarse.
    const docType = await prisma.documentType.upsert({
      where: { code: 'CONTRATO' },
      update: {},
      create: { code: 'CONTRATO', name: 'Contrato de trabajo' },
    });
    const documento = await prisma.document.create({
      data: {
        title: 'Contrato de prueba',
        documentTypeId: docType.id,
        storeId,
        subjectUserId: creado.id,
        createdById: adminId,
        retainUntil: new Date('2031-10-08'),
      },
    });

    const respuesta = await deactivate(creado.id).expect(200);
    expect((respuesta.body as UserResponse).isActive).toBe(false);

    // Sin acceso: no puede iniciar sesión ni renovar la sesión abierta.
    await login(`desactivar${DOMAIN}`).expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: sesion.refreshToken })
      .expect(401);

    // Los datos y documentos se conservan.
    const usuario = await prisma.user.findUnique({ where: { id: creado.id } });
    expect(usuario).not.toBeNull();
    expect(usuario?.isActive).toBe(false);
    expect(
      await prisma.document.findUnique({ where: { id: documento.id } }),
    ).not.toBeNull();

    // Aparece en el listado de desactivados y la operación es idempotente.
    const inactivos = (await listUsers('?isActive=false').expect(200))
      .body as UserResponse[];
    expect(inactivos.some((u) => u.id === creado.id)).toBe(true);
    await deactivate(creado.id).expect(200);

    await prisma.document.delete({ where: { id: documento.id } });
  });

  it('no permite desactivar la cuenta propia ni usuarios inexistentes', async () => {
    await deactivate(adminId).expect(400);
    await deactivate('00000000-0000-4000-8000-000000000000').expect(404);
    await deactivate('no-uuid').expect(400);
  });

  it('restringe la gestión de usuarios al administrador', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);

    for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
      const token = await tokenFor(
        adminId,
        role,
        role === ROLE.CONTADOR ? null : storeId,
      );
      await listUsers('', token).expect(403);
      await createUser(worker('sin-permiso'), token).expect(403);
      await deactivate(adminId, token).expect(403);
    }
  });
});
