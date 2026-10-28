import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { createSwaggerDocument } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  // Documentación interactiva OpenAPI (Swagger UI) disponible en /api/docs.
  SwaggerModule.setup('api/docs', app, createSwaggerDocument(app));

  const port = app.get(ConfigService).get<number>('PORT', 3001);
  await app.listen(port);
}
await bootstrap();
