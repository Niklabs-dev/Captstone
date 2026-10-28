import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
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
import { PreviewTipPoolDto } from './dto/preview-tip-pool.dto.js';
import {
  ConfirmTipPoolDto,
  ObserveTipPoolDto,
  PayTipPoolDto,
} from './dto/tip-pool-action.dto.js';
import {
  TipPoolConflictDto,
  TipPoolReceiptResponseDto,
  TipPoolResponseDto,
  TipPoolValidationErrorDto,
} from './dto/tip-pool-response.dto.js';
import { TipPoolsService } from './tip-pools.service.js';
import type {
  TipPoolReceiptResponse,
  TipPoolResponse,
} from './types/tip-pools.types.js';

@ApiTags('tip-pools')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('tip-pools')
export class TipPoolsController {
  constructor(private readonly tipPoolsService: TipPoolsService) {}

  @Post('preview')
  @Roles(ROLE.CONTADOR)
  @StoreScoped({ source: 'body' })
  @Audited({
    // El primer cálculo del período y los siguientes se distinguen en la
    // auditoría; el controller marca el recálculo con setAuditContext.
    action: (info) =>
      info.context?.detail?.recalculated === true
        ? AUDIT_ACTION.TIP_POOL_RECALCULATED
        : AUDIT_ACTION.TIP_POOL_CALCULATED,
    entityType: 'tip_pools',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      storeId: 'store.id',
      periodStart: 'periodStart',
      periodEnd: 'periodEnd',
      agreementId: 'agreement.id',
      totalAmount: 'totalAmount',
      totalHours: 'totalHours',
    },
  })
  @ApiOperation({
    summary: 'Calcula y guarda la vista previa (DRAFT) del reparto de propinas',
    description:
      'Usa el pacto vigente, los registros diarios del período y las horas del período exacto. Si ya existe un borrador del mismo local y período, lo reemplaza conservando su ID.',
  })
  @ApiCreatedResponse({
    description: 'Primer cálculo del período: borrador creado.',
    type: TipPoolResponseDto,
  })
  @ApiOkResponse({
    description: 'Recálculo: el borrador existente se reemplazó.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos (UUID, fechas o período invertido) o local inactivo.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador puede generar o recalcular repartos.',
  })
  @ApiNotFoundResponse({ description: 'Local no encontrado.' })
  @ApiConflictResponse({
    description:
      'El reparto del período ya está confirmado o pagado, o hubo un cálculo simultáneo.',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'Faltan datos o son inconsistentes; se informan todas las causas y no se guarda nada.',
    type: TipPoolValidationErrorDto,
  })
  async preview(
    @Body() dto: PreviewTipPoolDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipPoolResponse> {
    const result = await this.tipPoolsService.preview(dto, currentUser);
    res.status(result.created ? 201 : 200);
    setAuditContext(res, {
      storeId: result.pool.store.id,
      detail: {
        recalculated: !result.created,
        workers: result.pool.lines.length,
        sources: result.pool.sources.length,
        // El recálculo limpia la observación: el registro guarda qué atendió.
        ...(result.created ? {} : { previousNotes: result.previousNotes }),
      },
    });
    return result.pool;
  }

  @Get(':id')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Obtiene la foto guardada de un reparto sin recalcularlo',
  })
  @ApiOkResponse({
    description: 'Reparto con el pacto, las líneas y las fuentes guardadas.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol no permite consultar repartos.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipPoolResponse> {
    return this.tipPoolsService.findOne(id, currentUser);
  }

  // Acciones del contador sobre el reparto (SPRINT-3-T13). Todas bloquean el
  // reparto, comparan expectedVersion y responden el reparto actualizado.

  @Post(':id/observations')
  @HttpCode(200)
  @Roles(ROLE.CONTADOR)
  @Audited({
    action: AUDIT_ACTION.TIP_POOL_OBSERVED,
    entityType: 'tip_pools',
    entityIdFrom: 'response.id',
    detailFromResponse: { version: 'version' },
  })
  @ApiOperation({
    summary:
      'Registra una observación del contador sobre un reparto en borrador',
    description:
      'Reemplaza las observaciones vigentes y sube la versión; el reparto sigue en DRAFT. Al recalcular (POST /tip-pools/preview) las observaciones se limpian y quedan en la auditoría.',
  })
  @ApiOkResponse({
    description: 'Reparto con la observación registrada.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID no UUID, expectedVersion faltante o no entero, o notes vacío o de más de 255 caracteres.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador puede observar un reparto.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  @ApiConflictResponse({
    description:
      'El reparto no está en DRAFT o cambió desde que se revisó (expectedVersion desactualizado).',
    type: TipPoolConflictDto,
  })
  async observe(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ObserveTipPoolDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipPoolResponse> {
    const pool = await this.tipPoolsService.observe(id, dto, currentUser);
    // El texto completo (máx. 255 caracteres): el recálculo lo borra del
    // reparto y audit_logs es inmutable, así que aquí queda protegido.
    setAuditContext(res, {
      storeId: pool.store.id,
      detail: { notes: dto.notes, notesLength: dto.notes.length },
    });
    return pool;
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Roles(ROLE.CONTADOR)
  @Audited({
    action: AUDIT_ACTION.TIP_POOL_CONFIRMED,
    entityType: 'tip_pools',
    entityIdFrom: 'response.id',
    detailFromResponse: { totalAmount: 'totalAmount', version: 'version' },
  })
  @ApiOperation({
    summary: 'Valida el cálculo del reparto y lo confirma (DRAFT → CONFIRMED)',
    description:
      'Revalida que el reparto esté conciliado (Σ líneas = total y Σ fuentes = total). Desde la confirmación los montos no se pueden modificar.',
  })
  @ApiOkResponse({
    description: 'Reparto confirmado.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'ID no UUID o expectedVersion faltante o no entero.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador puede confirmar un reparto.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  @ApiConflictResponse({
    description:
      'El reparto ya está confirmado o pagado, o cambió desde que se revisó.',
    type: TipPoolConflictDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'El reparto no está conciliado; no se confirma y hay que recalcularlo.',
  })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmTipPoolDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipPoolResponse> {
    const pool = await this.tipPoolsService.confirm(id, dto, currentUser);
    setAuditContext(res, { storeId: pool.store.id });
    return pool;
  }

  @Post(':id/pay')
  @HttpCode(200)
  @Roles(ROLE.CONTADOR)
  @Audited({
    action: AUDIT_ACTION.TIP_POOL_PAID,
    entityType: 'tip_pools',
    entityIdFrom: 'response.id',
    detailFromResponse: {
      paymentDate: 'paymentDate',
      receiptsCount: 'receiptsCount',
      totalAmount: 'totalAmount',
    },
  })
  @ApiOperation({
    summary:
      'Marca como pagado (enterado) un reparto confirmado y emite las constancias',
    description:
      'CONFIRMED → PAID. En la misma transacción genera una constancia por trabajador (también con monto 0) con fecha, monto, local, período, responsable y la foto del reparto. Sin paymentDate se usa el día de hoy en hora de Chile.',
  })
  @ApiOkResponse({
    description: 'Reparto pagado, con receiptsCount constancias emitidas.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID no UUID, expectedVersion inválido o paymentDate inválida, futura o anterior al término del período.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador puede marcar un reparto como pagado.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  @ApiConflictResponse({
    description:
      'El reparto no está confirmado (en borrador o ya pagado) o cambió desde que se revisó.',
    type: TipPoolConflictDto,
  })
  async pay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PayTipPoolDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TipPoolResponse> {
    const pool = await this.tipPoolsService.pay(id, dto, currentUser);
    setAuditContext(res, { storeId: pool.store.id });
    return pool;
  }

  @Get(':id/receipts')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Lista las constancias de pago de un reparto pagado',
  })
  @ApiOkResponse({
    description: 'Una constancia por trabajador, ordenadas por userId.',
    type: TipPoolReceiptResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol no permite consultar constancias.',
  })
  @ApiNotFoundResponse({
    description: 'Reparto no encontrado o sin acceso a su local.',
  })
  @ApiConflictResponse({
    description: 'El reparto todavía no está pagado.',
  })
  listReceipts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<TipPoolReceiptResponse[]> {
    return this.tipPoolsService.listReceipts(id, currentUser);
  }

  @Get(':id/receipts/:userId/download')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @Header('X-Content-Type-Options', 'nosniff')
  @Audited({
    action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
    entityType: 'tip_pool_receipts',
    entityIdFrom: 'context.entityId',
  })
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Descarga en PDF la constancia de pago de un trabajador',
    description:
      'El PDF se genera al vuelo desde la foto guardada al pagar; nunca recalcula. El nombre del archivo no contiene datos personales.',
  })
  @ApiOkResponse({
    description:
      'Constancia en PDF, con nombre constancia-propinas_<inicio>_<fin>_<id corto>.pdf en Content-Disposition.',
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
    },
  })
  @ApiBadRequestResponse({ description: 'Algún ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'El rol no permite descargar constancias.',
  })
  @ApiNotFoundResponse({
    description:
      'Reparto no encontrado, sin acceso a su local, o el trabajador no tiene constancia en el reparto.',
  })
  @ApiConflictResponse({
    description: 'El reparto todavía no está pagado.',
  })
  async downloadReceipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.tipPoolsService.downloadReceipt(
      id,
      userId,
      currentUser,
    );
    // La respuesta es el archivo: la constancia y su local van aparte.
    setAuditContext(res, {
      entityId: file.receiptId,
      storeId: file.storeId,
      detail: { poolId: id, userId },
    });
    return new StreamableFile(file.content, {
      type: 'application/pdf',
      disposition: contentDisposition(file.fileName),
      length: file.content.length,
    });
  }
}
