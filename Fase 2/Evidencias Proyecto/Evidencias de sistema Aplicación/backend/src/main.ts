import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = app.get(ConfigService).get<number>('PORT', 3001);
  await app.listen(port);
}
await bootstrap();
