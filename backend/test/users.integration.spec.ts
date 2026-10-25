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
    // AppModule incluye el gestor documental (SPRINT-2-T05); estos tests no suben archivos.
    process.env.DOCUMENTS_STORAGE_PATH = './storage/test-documents';
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

    // El contrato está en su plazo de conservación (SPRINT-2-T07): se purga
    // como mantenimiento, omitiendo los triggers.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.document.delete({ where: { id: documento.id } });
    });
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

  // Edición completa y reactivación (SPRINT-3-T03). Usa un segundo local
  // activo ("Subway Users Test B"), que el cleanup() general también borra.
  describe('Edición y reactivación (SPRINT-3-T03)', () => {
    let otherStoreId: string;

    beforeAll(async () => {
      const otherStore = await prisma.store.create({
        data: {
          name: 'Subway Users Test B',
          city: 'Melipilla',
          address: 'Calle de prueba 789',
        },
      });
      otherStoreId = otherStore.id;
    });

    function updateUser(id: string, body: object, token = adminToken) {
      return request(app.getHttpServer())
        .patch(`/users/${id}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function reactivate(id: string, token = adminToken) {
      return request(app.getHttpServer())
        .patch(`/users/${id}/reactivate`)
        .set('Authorization', `Bearer ${token}`);
    }

    function refresh(refreshToken: string) {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
    }

    async function createWorker(
      suffix: string,
      extra: object = {},
    ): Promise<UserResponse> {
      return (await createUser(worker(suffix, extra)).expect(201))
        .body as UserResponse;
    }

    async function refreshTokenOf(suffix: string): Promise<string> {
      const sesion = (await login(`${suffix}${DOMAIN}`).expect(200)).body as {
        refreshToken: string;
      };
      return sesion.refreshToken;
    }

    // Crea un contrato asociado al usuario en el local indicado y devuelve su ID.
    async function createContract(
      subjectUserId: string,
      docStoreId: string,
    ): Promise<string> {
      const docType = await prisma.documentType.upsert({
        where: { code: 'CONTRATO' },
        update: {},
        create: { code: 'CONTRATO', name: 'Contrato de trabajo' },
      });
      const documento = await prisma.document.create({
        data: {
          title: 'Contrato de prueba',
          documentTypeId: docType.id,
          storeId: docStoreId,
          subjectUserId,
          createdById: adminId,
          retainUntil: new Date('2031-10-08'),
        },
      });
      return documento.id;
    }

    // El contrato está en su plazo de conservación (SPRINT-2-T07): se purga
    // como mantenimiento, omitiendo los triggers.
    async function purgeDocument(id: string): Promise<void> {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.document.delete({ where: { id } });
      });
    }

    it('edita los datos personales sin exponer el hash', async () => {
      const creado = await createWorker('editar');

      const respuesta = await updateUser(creado.id, {
        email: `editado${DOMAIN}`,
        firstName: 'Pedro',
        lastName: 'Soto',
        rut: '15.000.000-9',
        phone: '+56987654321',
        hiredAt: '2026-04-15',
      }).expect(200);
      const user = respuesta.body as UserResponse & { passwordHash?: string };

      expect(user).toMatchObject({
        id: creado.id,
        email: `editado${DOMAIN}`,
        firstName: 'Pedro',
        lastName: 'Soto',
        rut: '15000000-9',
        phone: '+56987654321',
        hiredAt: '2026-04-15',
        role: { code: ROLE.TRABAJADOR },
        store: { id: storeId },
      });
      expect(user.passwordHash).toBeUndefined();

      // null borra los datos opcionales, pero no se admite en los obligatorios.
      const borrado = (
        await updateUser(creado.id, { phone: null, hiredAt: null }).expect(200)
      ).body as UserResponse;
      expect(borrado.phone).toBeNull();
      expect(borrado.hiredAt).toBeNull();
      for (const field of ['email', 'firstName', 'lastName', 'roleCode']) {
        await updateUser(creado.id, { [field]: null }).expect(400);
      }
    });

    it('cambiar el rol o el local revoca las sesiones abiertas', async () => {
      const creado = await createWorker('revocar');

      const antesDeLocal = await refreshTokenOf('revocar');
      const cambioLocal = (
        await updateUser(creado.id, { storeId: otherStoreId }).expect(200)
      ).body as UserResponse;
      expect(cambioLocal.store?.id).toBe(otherStoreId);
      await refresh(antesDeLocal).expect(401);

      const antesDeRol = await refreshTokenOf('revocar');
      await updateUser(creado.id, { roleCode: ROLE.SUPERVISOR }).expect(200);
      await refresh(antesDeRol).expect(401);

      // El nuevo inicio de sesión ya lleva el local actualizado en sus claims.
      const sesion = (await login(`revocar${DOMAIN}`).expect(200)).body as {
        user: { storeId: string; role: string };
      };
      expect(sesion.user).toMatchObject({
        storeId: otherStoreId,
        role: ROLE.SUPERVISOR,
      });
    });

    it('editar solo datos personales, o reenviar el mismo local, no revoca las sesiones', async () => {
      const creado = await createWorker('sin-revocar');
      const refreshToken = await refreshTokenOf('sin-revocar');

      await updateUser(creado.id, { phone: '+56911112222' }).expect(200);
      // Mismo rol y local que ya tenía: no hay cambio real de asignación.
      await updateUser(creado.id, {
        roleCode: ROLE.TRABAJADOR,
        storeId,
      }).expect(200);

      await refresh(refreshToken).expect(200);
    });

    it('valida la coherencia entre el rol y el local finales', async () => {
      const creado = await createWorker('incompatible');

      // Rol de local sin local.
      await updateUser(creado.id, { storeId: null }).expect(400);
      // Rol global con local.
      await updateUser(creado.id, {
        roleCode: ROLE.ADMINISTRADOR,
        storeId,
      }).expect(400);
      // Local inactivo o inexistente.
      await updateUser(creado.id, { storeId: inactiveStoreId }).expect(400);
      await updateUser(creado.id, {
        storeId: '00000000-0000-4000-8000-000000000000',
      }).expect(400);

      // Pasar a un rol global sin enviar storeId deja el local en null.
      const contador = (
        await updateUser(creado.id, { roleCode: ROLE.CONTADOR }).expect(200)
      ).body as UserResponse;
      expect(contador.store).toBeNull();

      // De un rol global a uno de local sin enviar storeId: 400.
      const sinLocal = await updateUser(creado.id, {
        roleCode: ROLE.SUPERVISOR,
      }).expect(400);
      expect((sinLocal.body as ErrorResponse).message).toBe(
        'El rol SUPERVISOR requiere un local asignado',
      );
      const conLocal = (
        await updateUser(creado.id, {
          roleCode: ROLE.SUPERVISOR,
          storeId,
        }).expect(200)
      ).body as UserResponse;
      expect(conLocal.store?.id).toBe(storeId);
    });

    it('responde 409 si el correo o el RUT ya existen y 400 si el RUT es inválido', async () => {
      await createWorker('dup-a', { rut: '16000000-7' });
      const otro = await createWorker('dup-b');

      const mismoCorreo = await updateUser(otro.id, {
        email: `dup-a${DOMAIN}`,
      }).expect(409);
      expect((mismoCorreo.body as ErrorResponse).message).toBe(
        'Ya existe un usuario con ese correo o RUT',
      );
      await updateUser(otro.id, { rut: '16.000.000-7' }).expect(409);
      await updateUser(otro.id, { rut: '12345678-9' }).expect(400);
    });

    it('no permite editar ni reactivar una cuenta anonimizada', async () => {
      const creado = await createWorker('anonimizada');
      await prisma.user.update({
        where: { id: creado.id },
        data: { isActive: false, anonymizedAt: new Date() },
      });

      const edicion = await updateUser(creado.id, {
        phone: '+56900000000',
      }).expect(409);
      expect((edicion.body as ErrorResponse).message).toBe(
        'La cuenta está anonimizada y no se puede modificar',
      );
      await reactivate(creado.id).expect(409);
    });

    it('responde 404 si no existe y 400 ante id no UUID, body vacío o campos extra', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      await updateUser(inexistente, { phone: '+56900000000' }).expect(404);
      await reactivate(inexistente).expect(404);
      await updateUser('no-uuid', { phone: '+56900000000' }).expect(400);
      await reactivate('no-uuid').expect(400);

      const vacio = await updateUser(adminId, {}).expect(400);
      expect((vacio.body as ErrorResponse).message).toBe(
        'No hay campos para actualizar',
      );
      // La contraseña no se edita aquí (SPRINT-3-T04).
      await updateUser(adminId, { password: 'OtraClave123' }).expect(400);
      await updateUser(adminId, { campoExtra: 'no permitido' }).expect(400);
    });

    it('el administrador no puede cambiar su propio rol', async () => {
      const respuesta = await updateUser(adminId, {
        roleCode: ROLE.CONTADOR,
      }).expect(400);
      expect((respuesta.body as ErrorResponse).message).toBe(
        'No puedes cambiar tu propio rol',
      );
      // Sí puede editar sus datos personales.
      await updateUser(adminId, { phone: '+56933334444' }).expect(200);
    });

    it('reactiva la cuenta sin restaurar las sesiones antiguas y es idempotente', async () => {
      const creado = await createWorker('reactivar');
      const refreshToken = await refreshTokenOf('reactivar');
      await deactivate(creado.id).expect(200);

      const respuesta = await reactivate(creado.id).expect(200);
      expect((respuesta.body as UserResponse).isActive).toBe(true);

      // La sesión anterior sigue revocada; debe iniciar sesión de nuevo.
      await refresh(refreshToken).expect(401);
      await login(`reactivar${DOMAIN}`).expect(200);

      const otraVez = await reactivate(creado.id).expect(200);
      expect((otraVez.body as UserResponse).isActive).toBe(true);
    });

    it('no reactiva si el local asignado está desactivado', async () => {
      const store = await prisma.store.create({
        data: {
          name: 'Subway Users Test C',
          city: 'Calera',
          address: 'Calle de prueba 321',
        },
      });
      const creado = await createWorker('reactivar-sin-local', {
        storeId: store.id,
      });
      await deactivate(creado.id).expect(200);
      await prisma.store.update({
        where: { id: store.id },
        data: { isActive: false },
      });

      await reactivate(creado.id).expect(400);
      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: creado.id },
      });
      expect(usuario.isActive).toBe(false);
    });

    it('reactivar una cuenta ya activa no tiene efecto ni revalida la asignación', async () => {
      const store = await prisma.store.create({
        data: {
          name: 'Subway Users Test D',
          city: 'Calera',
          address: 'Calle de prueba 654',
        },
      });
      const creado = await createWorker('activa-local-inactivo', {
        storeId: store.id,
      });
      // Asignación inválida: el local se desactiva con la cuenta aún activa.
      await prisma.store.update({
        where: { id: store.id },
        data: { isActive: false },
      });

      const respuesta = await reactivate(creado.id).expect(200);
      expect(respuesta.body as UserResponse).toMatchObject({
        id: creado.id,
        isActive: true,
        store: { id: store.id },
      });
      // Sin efecto no se audita; la asignación se corrige con PATCH /users/:id.
      expect(
        await prisma.auditLog.count({
          where: { action: 'USER_REACTIVATED', entityId: creado.id },
        }),
      ).toBe(0);
      await updateUser(creado.id, { storeId: otherStoreId }).expect(200);
    });

    it('restringe la edición y la reactivación al administrador', async () => {
      await request(app.getHttpServer())
        .patch(`/users/${adminId}`)
        .send({ phone: '+56900000000' })
        .expect(401);

      for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
        const token = await tokenFor(
          adminId,
          role,
          role === ROLE.CONTADOR ? null : storeId,
        );
        await updateUser(adminId, { phone: '+56900000000' }, token).expect(403);
        await reactivate(adminId, token).expect(403);
      }
    });

    it('cambiar el local no altera los documentos existentes del trabajador', async () => {
      const creado = await createWorker('documentos');
      const documentoId = await createContract(creado.id, storeId);

      await updateUser(creado.id, { storeId: otherStoreId }).expect(200);

      const guardado = await prisma.document.findUniqueOrThrow({
        where: { id: documentoId },
      });
      expect(guardado.storeId).toBe(storeId);
      expect(guardado.subjectUserId).toBe(creado.id);

      await purgeDocument(documentoId);
    });

    it('audita edición y reactivación sin datos personales en el detalle', async () => {
      const creado = await createWorker('auditar');

      await updateUser(creado.id, {
        email: `auditado${DOMAIN}`,
        rut: '17.000.000-5',
        phone: '+56955556666',
        firstName: 'Rosa',
        roleCode: ROLE.SUPERVISOR,
      }).expect(200);

      const edicion = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_UPDATED', entityId: creado.id },
      });
      expect(edicion).toMatchObject({ entityType: 'users', userId: adminId });
      expect(edicion.detail).toEqual({ roleCode: ROLE.SUPERVISOR });
      const detalle = JSON.stringify(edicion.detail);
      for (const personal of ['auditado', '17000000', '+5695555', 'Rosa']) {
        expect(detalle).not.toContain(personal);
      }

      // Solo la reactivación con efecto queda registrada.
      await deactivate(creado.id).expect(200);
      await reactivate(creado.id).expect(200);
      await reactivate(creado.id).expect(200);
      const reactivaciones = await prisma.auditLog.findMany({
        where: { action: 'USER_REACTIVATED', entityId: creado.id },
      });
      expect(reactivaciones).toHaveLength(1);
      expect(reactivaciones[0].userId).toBe(adminId);
    });
  });

  // Restablecimiento de contraseña por el administrador (SPRINT-3-T04).
  describe('Restablecer contraseña (SPRINT-3-T04)', () => {
    const NEW_PASSWORD = 'ClaveNueva456';

    function resetPassword(id: string, body: object, token = adminToken) {
      return request(app.getHttpServer())
        .patch(`/users/${id}/password`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    function refresh(refreshToken: string) {
      return request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken });
    }

    async function createWorker(suffix: string): Promise<UserResponse> {
      return (await createUser(worker(suffix)).expect(201))
        .body as UserResponse;
    }

    function countResets(entityId: string): Promise<number> {
      return prisma.auditLog.count({
        where: { action: 'USER_PASSWORD_RESET', entityId },
      });
    }

    it('restablece la contraseña sin exponerla ni exponer el hash', async () => {
      const creado = await createWorker('reset');

      const respuesta = await resetPassword(creado.id, {
        newPassword: NEW_PASSWORD,
      }).expect(200);

      const body = respuesta.body as Record<string, unknown>;
      expect(body).toMatchObject({ id: creado.id, isActive: true });
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('newPassword');
    });

    it('la clave nueva permite iniciar sesión, la anterior no, y las sesiones previas quedan revocadas', async () => {
      await createWorker('reset-sesion');
      const sesion = (await login(`reset-sesion${DOMAIN}`).expect(200))
        .body as { refreshToken: string; user: { id: string } };

      await resetPassword(sesion.user.id, {
        newPassword: NEW_PASSWORD,
      }).expect(200);

      await login(`reset-sesion${DOMAIN}`, PASSWORD).expect(401);
      await refresh(sesion.refreshToken).expect(401);
      await login(`reset-sesion${DOMAIN}`, NEW_PASSWORD).expect(200);
    });

    it('restablece la contraseña de una cuenta desactivada sin reactivarla', async () => {
      const creado = await createWorker('reset-inactivo');
      await deactivate(creado.id).expect(200);

      const respuesta = await resetPassword(creado.id, {
        newPassword: NEW_PASSWORD,
      }).expect(200);
      expect((respuesta.body as UserResponse).isActive).toBe(false);

      const usuario = await prisma.user.findUniqueOrThrow({
        where: { id: creado.id },
      });
      expect(usuario.isActive).toBe(false);
      expect(await bcrypt.compare(NEW_PASSWORD, usuario.passwordHash)).toBe(
        true,
      );
      // Sigue sin acceso hasta que se reactive.
      await login(`reset-inactivo${DOMAIN}`, NEW_PASSWORD).expect(401);
    });

    it('aplica la misma política de contraseña que el alta (400)', async () => {
      const creado = await createWorker('reset-politica');

      await resetPassword(creado.id, { newPassword: 'a'.repeat(7) }).expect(
        400,
      );
      await resetPassword(creado.id, { newPassword: 'a'.repeat(73) }).expect(
        400,
      );
      await resetPassword(creado.id, {}).expect(400);
      await resetPassword(creado.id, { newPassword: 12345678 }).expect(400);

      // La contraseña original sigue vigente.
      await login(`reset-politica${DOMAIN}`).expect(200);
      expect(await countResets(creado.id)).toBe(0);
    });

    it('no permite restablecer la contraseña propia', async () => {
      const respuesta = await resetPassword(adminId, {
        newPassword: NEW_PASSWORD,
      }).expect(400);
      expect((respuesta.body as ErrorResponse).message).toBe(
        'No puedes restablecer tu propia contraseña desde la administración de usuarios',
      );
      await login(ADMIN_EMAIL).expect(200);
      expect(await countResets(adminId)).toBe(0);
    });

    it('responde 404 si no existe y 400 ante id no UUID', async () => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      await resetPassword(inexistente, { newPassword: NEW_PASSWORD }).expect(
        404,
      );
      await resetPassword('no-uuid', { newPassword: NEW_PASSWORD }).expect(400);
      expect(await countResets(inexistente)).toBe(0);
    });

    it('no permite restablecer la contraseña de una cuenta anonimizada (409)', async () => {
      const creado = await createWorker('reset-anonimizada');
      await prisma.user.update({
        where: { id: creado.id },
        data: { isActive: false, anonymizedAt: new Date() },
      });

      await resetPassword(creado.id, { newPassword: NEW_PASSWORD }).expect(409);
      expect(await countResets(creado.id)).toBe(0);
    });

    it('restringe el restablecimiento al administrador', async () => {
      const creado = await createWorker('reset-permiso');
      await request(app.getHttpServer())
        .patch(`/users/${creado.id}/password`)
        .send({ newPassword: NEW_PASSWORD })
        .expect(401);

      for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
        const token = await tokenFor(
          adminId,
          role,
          role === ROLE.CONTADOR ? null : storeId,
        );
        await resetPassword(
          creado.id,
          { newPassword: NEW_PASSWORD },
          token,
        ).expect(403);
      }
      await login(`reset-permiso${DOMAIN}`).expect(200);
    });

    it('audita el restablecimiento sin la contraseña ni su hash', async () => {
      const creado = await createWorker('reset-auditar');

      await resetPassword(creado.id, { newPassword: NEW_PASSWORD }).expect(200);

      const eventos = await prisma.auditLog.findMany({
        where: { action: 'USER_PASSWORD_RESET', entityId: creado.id },
      });
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({
        entityType: 'users',
        userId: adminId,
      });

      const { passwordHash } = await prisma.user.findUniqueOrThrow({
        where: { id: creado.id },
      });
      // Registro completo (id BIGSERIAL como texto para poder serializarlo).
      const registro = JSON.stringify(eventos[0], (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(registro).not.toContain(NEW_PASSWORD);
      expect(registro).not.toContain(passwordHash);
    });
  });
});
