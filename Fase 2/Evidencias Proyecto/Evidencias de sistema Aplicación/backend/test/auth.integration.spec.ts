import { createHash } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { AuthUser } from '../src/auth/types/auth.types.js';
import { purgeTestAuditLogs } from './helpers/audit-cleanup.js';

type App = Parameters<typeof request>[0];

// Tests de integración del flujo de autenticación (SPRINT-1-T06) contra
// PostgreSQL real. Se omiten si no se define TEST_DATABASE_URL. Los datos de
// prueba se crean con correos únicos y se eliminan al finalizar (los refresh
// tokens se borran en cascada con el usuario), así no dejan residuos.
const databaseUrl = process.env.TEST_DATABASE_URL;

const PASSWORD = 'ClaveSecreta123';
const EMAIL = 'auth-test@moi-food.cl';
const EMAIL_INACTIVO = 'auth-test-inactivo@moi-food.cl';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    role: string;
    storeId: string | null;
  };
}

interface ErrorResponse {
  message: string;
}

describe.skipIf(!databaseUrl)('Autenticación JWT (SPRINT-1-T06)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let storeId: string;

  beforeAll(async () => {
    // El módulo lee la configuración del entorno al compilar.
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

    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

    // Limpieza previa por si una ejecución anterior quedó a medias.
    await limpiar();

    const store = await prisma.store.create({
      data: {
        name: 'Subway Auth Test',
        city: 'Melipilla',
        address: 'Calle de prueba 123',
      },
    });
    storeId = store.id;

    const role = await prisma.role.upsert({
      where: { code: 'TRABAJADOR' },
      update: {},
      create: { code: 'TRABAJADOR', name: 'Trabajador' },
    });

    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash,
        firstName: 'Auth',
        lastName: 'Test',
        roleId: role.id,
        storeId,
      },
    });
    await prisma.user.create({
      data: {
        email: EMAIL_INACTIVO,
        passwordHash,
        firstName: 'Inactivo',
        lastName: 'Test',
        isActive: false,
        roleId: role.id,
      },
    });
  }, 60_000);

  afterAll(async () => {
    await limpiar();
    await prisma.store.delete({ where: { id: storeId } });
    await prisma.$disconnect();
    await app.close();
  });

  // Limpia los datos de prueba. Primero la auditoría que generan los logins
  // (SPRINT-1-T13): con FK RESTRICT (SPRINT-1-T15) no se pueden borrar
  // usuarios ni locales que tengan registros, y estos se purgan con el helper
  // porque audit_logs es inmutable. Los refresh tokens se borran en cascada.
  async function limpiar(): Promise<void> {
    await purgeTestAuditLogs(prisma, {
      OR: [
        { user: { email: { in: [EMAIL, EMAIL_INACTIVO] } } },
        { detail: { path: ['email'], equals: EMAIL } },
        { detail: { path: ['email'], equals: EMAIL_INACTIVO } },
        { detail: { path: ['email'], equals: 'no-existe@moi-food.cl' } },
      ],
    });
    await prisma.user.deleteMany({
      where: { email: { in: [EMAIL, EMAIL_INACTIVO] } },
    });
  }

  // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
  function login(email: string, password: string) {
    return request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
  }

  async function loginOk(): Promise<LoginResponse> {
    const respuesta = await login(EMAIL, PASSWORD).expect(200);
    return respuesta.body as LoginResponse;
  }

  it('emite access + refresh token con credenciales válidas y registra el hash', async () => {
    const body = await loginOk();

    expect(body.tokenType).toBe('Bearer');
    // JWT con sus tres segmentos y payload esperado.
    expect(body.accessToken.split('.')).toHaveLength(3);
    const payload = JSON.parse(
      Buffer.from(body.accessToken.split('.')[1], 'base64url').toString(),
    ) as { sub: string; email: string; role: string; storeId: string };
    expect(payload.email).toBe(EMAIL);
    expect(payload.role).toBe('TRABAJADOR');
    expect(payload.storeId).toBe(storeId);
    expect(body.expiresIn).toBe(3600);
    expect(body.user.email).toBe(EMAIL);

    // El refresh token se guarda solo como hash SHA-256, con expiración.
    const hash = createHash('sha256').update(body.refreshToken).digest('hex');
    const guardado = await prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
    });
    expect(guardado).not.toBeNull();
    expect(guardado?.tokenHash).not.toBe(body.refreshToken);
    expect(guardado?.revokedAt).toBeNull();
    const sieteDias = 7 * 86_400_000;
    expect(guardado!.expiresAt.getTime() - Date.now()).toBeGreaterThan(
      sieteDias - 60_000,
    );
  });

  it('rechaza contraseña incorrecta, correo inexistente y usuario inactivo con el mismo mensaje', async () => {
    for (const [email, password] of [
      [EMAIL, 'ClaveErronea123'],
      ['no-existe@moi-food.cl', PASSWORD],
      [EMAIL_INACTIVO, PASSWORD],
    ]) {
      const respuesta = await login(email, password).expect(401);
      const error = respuesta.body as ErrorResponse;
      expect(error.message).toBe('Credenciales inválidas');
    }
  });

  it('rechaza un body inválido (400) por el pipe de validación', async () => {
    await login('no-es-un-correo', 'corta').expect(400);
  });

  it('mantiene público el healthcheck y protege el resto de endpoints', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer token-malformado')
      .expect(401);
  });

  it('devuelve el usuario autenticado en GET /auth/me', async () => {
    const tokens = await loginOk();
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    const usuario = me.body as AuthUser;
    expect(usuario).toMatchObject({
      email: EMAIL,
      role: 'TRABAJADOR',
      storeId,
    });
  });

  it('rota el refresh token y rechaza la reutilización del anterior', async () => {
    const tokens = await loginOk();

    const renovado = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    const nuevos = renovado.body as LoginResponse;
    expect(nuevos.refreshToken).not.toBe(tokens.refreshToken);

    // El token usado quedó revocado: no puede reutilizarse.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    // El nuevo token sí permite renovar el acceso.
    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${nuevos.accessToken}`)
      .expect(200);
    expect((me.body as AuthUser).email).toBe(EMAIL);
  });

  it('logout revoca el refresh token y es idempotente', async () => {
    const tokens = await loginOk();

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(401);

    // Repetir el logout no falla.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
  });
});
