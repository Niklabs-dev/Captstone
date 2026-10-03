import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

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
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Moi-food API')
    .setDescription(
      'API REST del sistema de gestión interna Moi-food (franquiciado Subway). ' +
        'Los endpoints protegidos exigen un access token JWT en el encabezado Authorization.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = app.get(ConfigService).get<number>('PORT', 3001);
  await app.listen(port);
}
await bootstrap();
