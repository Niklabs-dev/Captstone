import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { StoreScoped } from '../auth/decorators/store-scoped.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { contentDisposition } from '../documents/utils/download-name.util.js';
import {
  DailyOperationsService,
  type DailyOperationVoucherFile,
} from './daily-operations.service.js';
import {
  CreateDailyOperationDto,
  CreateDailyOperationFormDto,
} from './dto/create-daily-operation.dto.js';
import { DailyOperationConflictDto } from './dto/daily-operation-conflict.dto.js';
import {
  DailyOperationPersonDto,
  DailyOperationResponseDto,
} from './dto/daily-operation-response.dto.js';
import { EligibleWorkersQueryDto } from './dto/eligible-workers-query.dto.js';
import { ListDailyOperationsQueryDto } from './dto/list-daily-operations-query.dto.js';
import {
  UpdateDailyOperationDto,
  UpdateDailyOperationFormDto,
} from './dto/update-daily-operation.dto.js';
import { MAX_VOUCHER_BYTES } from './types/daily-operations.types.js';
import type { DailyOperationResponse } from './types/daily-operations.types.js';

// Un solo voucher por solicitud y hasta 5 MiB (SPRINT-4R-T18): Multer corta
// la subida al superar cualquiera de los dos límites (413 o 400) antes de
// cargar más datos en memoria.
const VOUCHER_UPLOAD_OPTIONS = {
  limits: { fileSize: MAX_VOUCHER_BYTES, files: 1 },
};

const READER_ROLES = [
  ROLE.ADMINISTRADOR,
  ROLE.SUPERVISOR,
  ROLE.CONTADOR,
] as const;

// El interceptor de auditoría lee el cuerpo crudo de la solicitud, no el DTO
// ya transformado: con un solo participantIds repetido Multer entrega un
// string, no un arreglo. Se normaliza aquí para que la auditoría siempre
// registre un arreglo de UUIDs con la selección enviada.
function normalizeParticipantIdsForAudit(req: Request): void {
  const body = req.body as { participantIds?: unknown } | undefined;
  if (typeof body?.participantIds === 'string') {
    body.participantIds = [body.participantIds];
  }
}

// Operación diaria del local (SPRINT-4R-T01 y SPRINT-4R-T03): un único
// registro por local y fecha de negocio con la propina de tarjeta (y su
// voucher fotográfico privado), la propina en efectivo, la diferencia de
// efectivo declarada y la selección de trabajadores que participan del
// reparto. Reemplaza al flujo previo de cierres por turno/conciliación y a
// la captura separada de propinas, que quedaron solo de lectura histórica.
@ApiTags('daily-operations')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('daily-operations')
export class DailyOperationsController {
  constructor(private readonly dailyOperations: DailyOperationsService) {}

  @Post()
  @Roles(ROLE.SUPERVISOR)
  // Sin @StoreScoped a propósito: ese guard lee el cuerpo, que con
  // multipart aún no está parseado cuando corren los guards (Multer es un
  // interceptor). La autorización por local la aplica el servicio al inicio
  // del create (403 si el supervisor no pertenece al local del formulario).
  @UseInterceptors(FileInterceptor('voucher', VOUCHER_UPLOAD_OPTIONS))
  @Audited({
    action: AUDIT_ACTION.DAILY_OPERATION_CREATED,
    entityType: 'daily_operations',
    entityIdFrom: 'response.id',
    detailFromBody: ['storeId', 'businessDate', 'participantIds'],
    detailFromResponse: {
      cardTipAmount: 'cardTipAmount',
      cashTipAmount: 'cashTipAmount',
      tipFundAmount: 'tipFundAmount',
      cashDifference: 'cashDifference',
      differenceReason: 'differenceReason',
      voucherSha256: 'voucher.sha256Hash',
    },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: CreateDailyOperationFormDto })
  @ApiOperation({
    summary:
      'Registra la operación diaria del local: propinas, diferencia de efectivo, voucher y participantes del reparto',
    description:
      'Una sola operación por local y fecha de negocio. La foto del voucher ' +
      '(JPEG, PNG o WebP, máximo 5 MiB) es obligatoria cuando hay propina de ' +
      'tarjeta y se almacena en el volumen privado; se descarga solo por ' +
      'GET /daily-operations/{id}/voucher. Con fondo de propinas (tarjeta + ' +
      'efectivo) mayor que 0 se exige al menos un participantIds (campo ' +
      'repetido, IDs del catálogo GET /daily-operations/eligible-workers) y ' +
      'propinas y selección se guardan en la misma transacción. Un reintento ' +
      'idéntico (mismos montos, motivo, mismo voucher por su hash y misma ' +
      'selección sin importar el orden) devuelve la operación existente con ' +
      '200; un contenido distinto responde 409 con el ID consultable.',
  })
  @ApiCreatedResponse({
    description: 'Operación diaria registrada con su voucher.',
    type: DailyOperationResponseDto,
  })
  @ApiOkResponse({
    description:
      'Reintento idéntico: devuelve la operación existente sin auditarla de nuevo.',
    type: DailyOperationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Campos inválidos, falta el voucher con propina de tarjeta, voucher enviado sin propina de tarjeta, falta el motivo con diferencia distinta de cero, participantIds vacío con fondo mayor que 0, repetidos, inválidos o no elegibles para el local.',
  })
  @ApiForbiddenResponse({
    description:
      'Solo un supervisor del mismo local puede registrar la operación.',
  })
  @ApiNotFoundResponse({ description: 'El local indicado no existe.' })
  @ApiConflictResponse({
    description:
      'Ya existe una operación distinta para ese local y fecha; incluye el ID consultable.',
    type: DailyOperationConflictDto,
  })
  @ApiPayloadTooLargeResponse({
    description: 'El voucher supera los 5 MiB permitidos.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'El voucher no es JPEG, PNG ni WebP, o su tipo declarado no coincide.',
  })
  async create(
    // El cuerpo se valida contra el DTO sin el campo voucher (solo campos de
    // texto): el archivo va por req.file. El FormDto con el binario se usa
    // solo en @ApiBody para que Swagger muestre el selector de archivo (mismo
    // patrón que la carga de documentos).
    @Body() dto: CreateDailyOperationDto,
    @UploadedFile() file: DailyOperationVoucherFile | undefined,
    @CurrentUser() currentUser: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DailyOperationResponse> {
    normalizeParticipantIdsForAudit(req);
    const result = await this.dailyOperations.create(dto, file, currentUser);
    res.status(result.created ? 201 : 200);
    setAuditContext(res, {
      storeId: result.operation.store.id,
      skipAudit: !result.created,
    });
    return result.operation;
  }

  @Patch(':id')
  @Roles(ROLE.SUPERVISOR, ROLE.ADMINISTRADOR)
  // Mismo criterio que el POST: sin @StoreScoped (el cuerpo multipart aún no
  // está parseado cuando corren los guards); el alcance por local lo aplica
  // el servicio contra la operación existente.
  @UseInterceptors(FileInterceptor('voucher', VOUCHER_UPLOAD_OPTIONS))
  @Audited({
    action: AUDIT_ACTION.DAILY_OPERATION_UPDATED,
    entityType: 'daily_operations',
    entityIdFrom: 'params.id',
    detailFromBody: [
      'cardTipAmount',
      'cashTipAmount',
      'cashDifference',
      'differenceReason',
      'participantIds',
    ],
    detailFromResponse: {
      cardTipAmount: 'cardTipAmount',
      cashTipAmount: 'cashTipAmount',
      tipFundAmount: 'tipFundAmount',
      cashDifference: 'cashDifference',
      differenceReason: 'differenceReason',
      voucherSha256: 'voucher.sha256Hash',
    },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UpdateDailyOperationFormDto })
  @ApiOperation({
    summary:
      'Corrige la operación diaria: montos, diferencia, motivo, voucher y/o participantes del reparto',
    description:
      'Corrige solo lo enviado: local, fecha y responsable original no ' +
      'cambian. participantIds repetido reemplaza la selección completa ' +
      '(omítelo para conservarla; con fondo resultante 0 queda vacía). El ' +
      'voucher se conserva si la tarjeta sigue mayor que 0 y no hay ' +
      'reemplazo; si la tarjeta queda en 0 se retiran archivo y metadatos ' +
      'del anterior. Con diferencia resultante distinta de cero el motivo es ' +
      'obligatorio (enviado o ya registrado). Los triggers de la base ' +
      'impiden corregir montos o selección de una operación que alimentó un ' +
      'reparto CONFIRMED o PAID: ese rechazo responde 409 con el mensaje de ' +
      'la base. El actor de la corrección queda en auditoría.',
  })
  @ApiOkResponse({
    description: 'Operación diaria corregida con su selección actualizada.',
    type: DailyOperationResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Solicitud vacía, campos inválidos, voucher enviado con tarjeta resultante 0, tarjeta mayor que 0 sin voucher registrado, o selección inválida para el fondo resultante (vacía con fondo mayor que 0 o informada con fondo 0).',
  })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite corregir la operación.',
  })
  @ApiNotFoundResponse({ description: 'Operación diaria no encontrada.' })
  @ApiConflictResponse({
    description:
      'La operación alimenta un reparto CONFIRMED o PAID: la base rechaza corregir sus montos o su selección.',
  })
  @ApiPayloadTooLargeResponse({
    description: 'El voucher supera los 5 MiB permitidos.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'El voucher no es JPEG, PNG ni WebP, o su tipo declarado no coincide.',
  })
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateDailyOperationDto,
    @UploadedFile() file: DailyOperationVoucherFile | undefined,
    @CurrentUser() currentUser: AuthUser,
    @Req() req: Request,
  ): Promise<DailyOperationResponse> {
    normalizeParticipantIdsForAudit(req);
    return this.dailyOperations.update(id, dto, file, currentUser);
  }

  @Get()
  @Roles(...READER_ROLES)
  @StoreScoped({ source: 'query' })
  @ApiOperation({
    summary: 'Consulta la operación diaria de un local y fecha',
    description:
      'Existe a lo más una operación por local y fecha de negocio: el arreglo ' +
      'devuelve 0 o 1 elementos. Un supervisor solo consulta su local.',
  })
  @ApiOkResponse({
    description:
      'Arreglo con la operación del día o vacío si aún no se registra.',
    type: DailyOperationResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'Local o fecha inválidos.' })
  @ApiForbiddenResponse({
    description:
      'El rol o el local asignado no permite consultar la operación.',
  })
  findAll(
    @Query() query: ListDailyOperationsQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyOperationResponse[]> {
    return this.dailyOperations.findAll(query, currentUser);
  }

  @Get('eligible-workers')
  @Roles(ROLE.SUPERVISOR, ROLE.ADMINISTRADOR)
  // Sin @StoreScoped a propósito: así el pipe valida el UUID del local con
  // 400 antes de cualquier chequeo de alcance, y el alcance por local lo
  // aplica el servicio (403 si no corresponde).
  @ApiOperation({
    summary:
      'Lista los trabajadores elegibles para el reparto del local (catálogo acotado)',
    description:
      'TRABAJADOR activos del local ordenados alfabéticamente. Solo expone ' +
      'id y nombre: jamás RUT, correo, teléfono ni credenciales. Un ' +
      'supervisor solo lista su local; el ADMINISTRADOR (rol global) cualquier ' +
      'local dentro de su alcance. Los IDs devueltos son los únicos válidos ' +
      'para participantIds al crear o corregir la operación diaria.',
  })
  @ApiOkResponse({
    description: 'Arreglo de trabajadores elegibles (posiblemente vacío).',
    type: DailyOperationPersonDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'El local no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol o el local asignado no permite consultar el catálogo.',
  })
  findEligibleWorkers(
    @Query() query: EligibleWorkersQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyOperationPersonDto[]> {
    return this.dailyOperations.findEligibleWorkers(query.storeId, currentUser);
  }

  @Get(':id')
  @Roles(...READER_ROLES)
  @ApiOperation({
    summary: 'Obtiene el detalle de una operación diaria por su ID',
  })
  @ApiOkResponse({
    description: 'Operación con el detalle de montos y metadatos del voucher.',
    type: DailyOperationResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({ description: 'No tienes acceso a este local.' })
  @ApiNotFoundResponse({ description: 'Operación diaria no encontrada.' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DailyOperationResponse> {
    return this.dailyOperations.findOne(id, currentUser);
  }

  @Get(':id/voucher')
  @Roles(...READER_ROLES)
  @Header('X-Content-Type-Options', 'nosniff')
  @Audited({
    action: AUDIT_ACTION.DAILY_OPERATION_VOUCHER_DOWNLOADED,
    entityType: 'daily_operations',
    entityIdFrom: 'params.id',
  })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({
    summary: 'Descarga el voucher fotográfico de una operación diaria',
    description:
      'Descarga privada y autorizada: el archivo vive fuera de cualquier ' +
      'carpeta pública y solo se entrega a ADMINISTRADOR, SUPERVISOR del ' +
      'mismo local o CONTADOR. Recalcula el SHA-256: si no coincide con el ' +
      'registrado, el archivo se entrega igual pero con X-Voucher-Integrity: ' +
      'ALTERED para advertirlo.',
  })
  @ApiOkResponse({
    description:
      'Voucher fotográfico con su nombre original en Content-Disposition.',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': {
        description:
          'attachment con el nombre del archivo (filename y filename*).',
        schema: { type: 'string' },
      },
      'X-Content-Type-Options': {
        description: 'Siempre nosniff.',
        schema: { type: 'string', example: 'nosniff' },
      },
      'X-Voucher-Integrity': {
        description:
          'VALID si el archivo coincide con el hash registrado; ALTERED si fue modificado.',
        schema: { type: 'string', enum: ['VALID', 'ALTERED'] },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({ description: 'No tienes acceso a este local.' })
  @ApiNotFoundResponse({
    description:
      'Operación no encontrada o sin voucher (no hubo propina de tarjeta).',
  })
  async downloadVoucher(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.dailyOperations.downloadVoucher(id, currentUser);
    res.setHeader('X-Voucher-Integrity', file.integrity);
    // La respuesta es el archivo: el local y el detalle se aportan aparte.
    setAuditContext(res, {
      storeId: file.storeId,
      detail: { operationId: file.operationId, integrity: file.integrity },
    });
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: contentDisposition(file.fileName),
      length: file.content.length,
    });
  }
}
