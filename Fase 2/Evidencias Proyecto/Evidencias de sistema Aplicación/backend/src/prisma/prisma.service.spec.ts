import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service.js';

describe('PrismaService', () => {
  const databaseUrl = 'postgresql://usuario:clave@localhost:5432/prueba';
  let service: PrismaService;

  beforeEach(() => {
    const configService = new ConfigService({ DATABASE_URL: databaseUrl });
    service = new PrismaService(configService);
  });

  it('exige DATABASE_URL en la configuración', () => {
    const configService = new ConfigService();
    expect(() => new PrismaService(configService)).toThrow();
  });

  it('conecta al inicializar el módulo y desconecta al destruirlo', async () => {
    const connectSpy = vi
      .spyOn(service, '$connect')
      .mockResolvedValue(undefined);
    const disconnectSpy = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(connectSpy).toHaveBeenCalledOnce();
    expect(disconnectSpy).toHaveBeenCalledOnce();
  });
});
