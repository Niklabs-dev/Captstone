import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

// Documento OpenAPI de la API. main.ts lo publica en /api/docs y los tests lo
// leen para verificar la documentación de los endpoints (SPRINT-3-T13).
export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Moi-food API')
    .setDescription(
      'API REST del sistema de gestión interna Moi-food (franquiciado Subway). ' +
        'Los endpoints protegidos exigen un access token JWT en el encabezado Authorization.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, swaggerConfig);
}
