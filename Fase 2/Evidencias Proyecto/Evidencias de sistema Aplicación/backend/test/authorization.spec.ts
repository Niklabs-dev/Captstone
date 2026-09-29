import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { ROLE, type RoleCode } from '../src/auth/constants/roles.constants.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { Roles } from '../src/auth/decorators/roles.decorator.js';
import { StoreScoped } from '../src/auth/decorators/store-scoped.decorator.js';
import type { JwtPayload } from '../src/auth/types/auth.types.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

type App = Parameters<typeof request>[0];

interface OkResponse {
  ok: true;
}

// Tests de autorización por rol y por local (SPRINT-1-T07). Ejercitan la
// cadena real de guards globales (JWT → roles → local) sobre controllers de
// prueba con tokens firmados; no requieren base de datos.
const STORE_A = '11111111-1111-4111-8111-111111111111';
const STORE_B = '22222222-2222-4222-8222-222222222222';

const prismaStub = {
  onModuleInit: vi.fn(),
  onModuleDestroy: vi.fn(),
  $connect: vi.fn(),
  $disconnect: vi.fn(),
};

@Controller('authz-test')
class AuthzTestController {
  @Get('authenticated')
  authenticated(): OkResponse {
    return { ok: true };
  }

  @Get('admin')
  @Roles(ROLE.ADMINISTRADOR)
  admin(): OkResponse {
    return { ok: true };
  }

  @Get('stores/:storeId')
  @Roles(ROLE.ADMINISTRADOR, ROLE.SUPERVISOR, ROLE.CONTADOR)
  @StoreScoped()
  store(@Param('storeId') _storeId: string): OkResponse {
    return { ok: true };
  }

  @Get('query')
  @StoreScoped({ source: 'query' })
  query(): OkResponse {
    return { ok: true };
  }

  @Post('body')
  @HttpCode(200)
  @StoreScoped({ source: 'body', field: 'targetStoreId' })
  body(@Body() _body: unknown): OkResponse {
    return { ok: true };
  }

  @Public()
  @Roles(ROLE.ADMINISTRADOR)
  @StoreScoped()
  @Get('public')
  publicEndpoint(): OkResponse {
    return { ok: true };
  }
}

// @Roles() a nivel de clase, sobrescrito por el handler cuando lo declara.
@Controller('authz-test-class')
@Roles(ROLE.CONTADOR)
class AuthzClassTestController {
  @Get()
  inherited(): OkResponse {
    return { ok: true };
  }

  @Get('override')
  @Roles(ROLE.TRABAJADOR)
  overridden(): OkResponse {
    return { ok: true };
  }
}

describe('Autorización por rol y local (SPRINT-1-T07)', () => {
  let app: INestApplication<App>;
  let jwt: JwtService;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'secreto-de-pruebas';
    process.env.JWT_EXPIRES_IN = '1h';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [AuthzTestController, AuthzClassTestController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  function tokenFor(role: RoleCode, storeId: string | null): Promise<string> {
    const payload: JwtPayload = {
      sub: 'usuario-prueba',
      email: 'authz@moi-food.cl',
      role,
      storeId,
    };
    return jwt.signAsync(payload);
  }

  // Sin async para conservar el tipo Test de supertest y poder encadenar .expect().
  function get(path: string, token: string) {
    return request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`);
  }

  it('sigue exigiendo autenticación antes de evaluar roles (401)', async () => {
    await request(app.getHttpServer()).get('/authz-test/admin').expect(401);
  });

  it('deja pasar a cualquier autenticado en endpoints sin @Roles()', async () => {
    const token = await tokenFor(ROLE.TRABAJADOR, STORE_A);
    await get('/authz-test/authenticated', token).expect(200);
  });

  it('permite el rol autorizado y responde 403 al resto', async () => {
    const admin = await tokenFor(ROLE.ADMINISTRADOR, null);
    await get('/authz-test/admin', admin).expect(200);

    for (const role of [ROLE.SUPERVISOR, ROLE.TRABAJADOR, ROLE.CONTADOR]) {
      const token = await tokenFor(role, STORE_A);
      const respuesta = await get('/authz-test/admin', token).expect(403);
      expect((respuesta.body as { message: string }).message).toBe(
        'No tienes permisos para realizar esta acción',
      );
    }
  });

  it('aplica @Roles() de la clase y deja que el handler lo sobrescriba', async () => {
    const contador = await tokenFor(ROLE.CONTADOR, null);
    const trabajador = await tokenFor(ROLE.TRABAJADOR, STORE_A);

    await get('/authz-test-class', contador).expect(200);
    await get('/authz-test-class', trabajador).expect(403);
    await get('/authz-test-class/override', trabajador).expect(200);
    await get('/authz-test-class/override', contador).expect(403);
  });

  it('limita al supervisor a su propio local', async () => {
    const supervisor = await tokenFor(ROLE.SUPERVISOR, STORE_A);
    await get(`/authz-test/stores/${STORE_A}`, supervisor).expect(200);
    const respuesta = await get(
      `/authz-test/stores/${STORE_B}`,
      supervisor,
    ).expect(403);
    expect((respuesta.body as { message: string }).message).toBe(
      'No tienes acceso a este local',
    );
  });

  it('permite a los roles globales operar sobre cualquier local', async () => {
    for (const role of [ROLE.ADMINISTRADOR, ROLE.CONTADOR]) {
      const token = await tokenFor(role, null);
      await get(`/authz-test/stores/${STORE_A}`, token).expect(200);
      await get(`/authz-test/stores/${STORE_B}`, token).expect(200);
    }
  });

  it('evalúa el rol antes que el local', async () => {
    // El trabajador es de STORE_A, pero su rol no está autorizado.
    const trabajador = await tokenFor(ROLE.TRABAJADOR, STORE_A);
    await get(`/authz-test/stores/${STORE_A}`, trabajador).expect(403);
  });

  it('niega el acceso a un usuario de local sin local asignado', async () => {
    const supervisor = await tokenFor(ROLE.SUPERVISOR, null);
    await get(`/authz-test/stores/${STORE_A}`, supervisor).expect(403);
  });

  it('lee el local desde la query y exige un valor único', async () => {
    const trabajador = await tokenFor(ROLE.TRABAJADOR, STORE_A);
    await get(`/authz-test/query?storeId=${STORE_A}`, trabajador).expect(200);
    await get(`/authz-test/query?storeId=${STORE_B}`, trabajador).expect(403);
    await get('/authz-test/query', trabajador).expect(400);
    await get(
      `/authz-test/query?storeId=${STORE_A}&storeId=${STORE_B}`,
      trabajador,
    ).expect(400);
  });

  it('lee el local desde el body con un campo personalizado', async () => {
    const supervisor = await tokenFor(ROLE.SUPERVISOR, STORE_B);
    const post = (targetStoreId: string) =>
      request(app.getHttpServer())
        .post('/authz-test/body')
        .set('Authorization', `Bearer ${supervisor}`)
        .send({ targetStoreId });

    await post(STORE_B).expect(200);
    await post(STORE_A).expect(403);
    // Un campo con otro nombre no sirve para saltarse la validación.
    await request(app.getHttpServer())
      .post('/authz-test/body')
      .set('Authorization', `Bearer ${supervisor}`)
      .send({ storeId: STORE_B })
      .expect(400);
  });

  it('no aplica roles ni local a los endpoints @Public()', async () => {
    await request(app.getHttpServer()).get('/authz-test/public').expect(200);
  });
});
