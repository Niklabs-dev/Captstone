import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

// Descripción de cada grupo (tag) de endpoints, en el orden en que Swagger UI
// los muestra. Los grupos del flujo anterior se marcan como históricos para
// que nadie los tome por el flujo vigente (SPRINT-4A-T14).
const API_TAGS: ReadonlyArray<readonly [name: string, description: string]> = [
  ['health', 'Estado de la API.'],
  ['auth', 'Inicio de sesión, renovación y cierre de sesión con JWT.'],
  ['users', 'Administración de usuarios, roles y locales asignados.'],
  [
    'stores',
    'Locales, con su ID Subway: el número con que el Excel de MrComanda identifica al local.',
  ],
  ['audit', 'Consulta del registro de auditoría inmutable.'],
  ['documents', 'Gestor documental laboral con SHA-256 y versionado.'],
  [
    'dt-alerts',
    'Alertas de registro de documentos en la Dirección del Trabajo.',
  ],
  ['payroll', 'Liquidaciones de sueldo y portal «Mis liquidaciones».'],
  [
    'daily-operations',
    'Operación diaria del local: propinas con tarjeta y en efectivo, voucher, diferencia de efectivo y participantes. Al guardarla se reparte la propina del día en partes iguales.',
  ],
  [
    'daily-tips',
    'Propinas diarias por trabajador: consulta por día y período, exportación a Excel y pago por período (lotes de pago).',
  ],
  [
    'tip-payment-alerts',
    'Propinas diarias no pagadas fuera del plazo legal (TIP_LEGAL_PAYMENT_DAYS días hábiles).',
  ],
  [
    'my-tips',
    'Portal del trabajador: sus propinas por día con estado de pago.',
  ],
  [
    'my-tip-receipts',
    'Portal del trabajador: constancias de los repartos por período históricos.',
  ],
  [
    'tip-pools',
    'Histórico de solo lectura de los repartos por período (retirados en SPRINT-4A-T08); sus acciones de escritura responden 410.',
  ],
  [
    'tips',
    'Histórico de solo lectura del registro de propinas por medio de pago (anterior a la operación diaria).',
  ],
  [
    'sales-imports',
    'Importación del Excel diario de MrComanda: vista previa, resolución manual de local y medios, confirmación y versiones.',
  ],
  [
    'payment-methods',
    'Catálogo de medios de pago (código inmutable, baja lógica).',
  ],
  [
    'payment-method-aliases',
    'Etiquetas del Excel de MrComanda asociadas a cada medio de pago.',
  ],
  [
    'operating-calendar',
    'Días de operación y cierres por excepción de cada local.',
  ],
  [
    'sales-days',
    'Estado de ventas por local y día (importado, pendiente, atrasado o cerrado).',
  ],
  [
    'sales-dashboard',
    'Panel diario de ventas importadas, propinas, diferencias y alertas.',
  ],
  [
    'sales-reports',
    'Reportes de ventas importadas, propinas y diferencias por período y local (ADMINISTRADOR y CONTADOR, solo lectura), y consulta histórica de cierres por turno.',
  ],
  [
    'products',
    'Catálogo de productos de inventario: el ADMINISTRADOR crea, edita, desactiva y reactiva productos con su formato de caja y paquete; el SUPERVISOR consulta los activos.',
  ],
  [
    'inventory-counts',
    'Toma de inventario por local: el SUPERVISOR inicia la toma de su local y guarda por producto las cajas, los paquetes y la cantidad suelta (el total lo calcula el backend); el ADMINISTRADOR consulta las de todos los locales en solo lectura.',
  ],
  [
    'cash-closings',
    'Histórico de solo lectura de los cierres de caja por turno (anteriores a la operación diaria).',
  ],
];

// Documento OpenAPI de la API. main.ts lo publica en /api/docs y los tests lo
// leen para verificar la documentación de los endpoints (SPRINT-3-T13).
export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  const builder = new DocumentBuilder()
    .setTitle('Moi-food API')
    .setDescription(
      'API REST del sistema de gestión interna Moi-food (franquiciado Subway). ' +
        'Los endpoints protegidos exigen un access token JWT en el encabezado Authorization. ' +
        'Los endpoints marcados como obsoletos (deprecated) pertenecen a flujos retirados y responden 410 Gone.',
    )
    .setVersion('1.0')
    .addBearerAuth();
  for (const [name, description] of API_TAGS) {
    builder.addTag(name, description);
  }
  return SwaggerModule.createDocument(app, builder.build());
}
