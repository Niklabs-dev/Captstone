import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import type { Response } from 'express';
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
import { DailyOperationResponseDto } from './dto/daily-operation-response.dto.js';
import { ListDailyOperationsQueryDto } from './dto/list-daily-operations-query.dto.js';
import { MAX_VOUCHER_BYTES } from './types/daily-operations.types.js';
import type { DailyOperationResponse } from './types/daily-operations.types.js';

const READER_ROLES = [
  ROLE.ADMINISTRADOR,
  ROLE.SUPERVISOR,
  ROLE.CONTADOR,
] as const;

// Operación diaria del local (SPRINT-4R-T01): un único registro por local y
// fecha de negocio con la propina de tarjeta (y su voucher fotográfico
// privado), la propina en efectivo y la diferencia de efectivo declarada.
// Reemplaza al flujo previo de cierres por turno/conciliación y a la captura
// separada de propinas, que quedaron solo de lectura histórica.
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
  @UseInterceptors(
    FileInterceptor('voucher', { limits: { fileSize: MAX_VOUCHER_BYTES } }),
  )
  @Audited({
    action: AUDIT_ACTION.DAILY_OPERATION_CREATED,
    entityType: 'daily_operations',
    entityIdFrom: 'response.id',
    detailFromBody: ['storeId', 'businessDate'],
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
      'Registra la operación diaria del local: propinas de tarjeta y efectivo, diferencia de efectivo y voucher',
    description:
      'Una sola operación por local y fecha de negocio. La foto del voucher ' +
      '(JPEG, PNG o WebP, máximo 5 MiB) es obligatoria cuando hay propina de ' +
      'tarjeta y se almacena en el volumen privado; se descarga solo por ' +
      'GET /daily-operations/{id}/voucher. Un reintento idéntico (mismos ' +
      'montos, motivo y mismo voucher por su hash) devuelve la operación ' +
      'existente con 200; un contenido distinto responde 409 con el ID ' +
      'consultable.',
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
      'Campos inválidos, falta el voucher con propina de tarjeta, voucher enviado sin propina de tarjeta, o falta el motivo con diferencia distinta de cero.',
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<DailyOperationResponse> {
    const result = await this.dailyOperations.create(dto, file, currentUser);
    res.status(result.created ? 201 : 200);
    setAuditContext(res, {
      storeId: result.operation.store.id,
      skipAudit: !result.created,
    });
    return result.operation;
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
