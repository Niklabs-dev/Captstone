import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
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
import {
  CalculateTipPoolDto,
  PreviewTipPoolDto,
} from './dto/preview-tip-pool.dto.js';
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

  @Get()
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Consulta un reparto por local y período, sin recalcular',
  })
  @ApiOkResponse({
    description: 'Reparto existente o lista vacía.',
    type: TipPoolResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'Local o período inválidos.' })
  @ApiForbiddenResponse({ description: 'Solo contador y administrador.' })
  list(
    @Query() query: PreviewTipPoolDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TipPoolResponse[]> {
    return this.tipPoolsService.findPeriod(query, user);
  }

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
      rule: 'rule',
      totalAmount: 'totalAmount',
    },
  })
  @ApiOperation({
    summary:
      'Calcula y guarda la vista previa (DRAFT) del reparto equitativo de propinas',
    description:
      'Regla equitativa (SPRINT-4R-T04): para cada operación diaria del período se suman la propina de tarjeta y la de efectivo, y ese fondo se divide una sola vez en partes iguales entre los participantes de ese día; cada trabajador recibe la suma de sus asignaciones diarias (no se divide el total del período entre la unión de trabajadores). Residuo CLP: los pesos sobrantes de cada día van de a $1 a los participantes ordenados por ID, comenzando en la posición (días desde 1970-01-01) mod n, así el peso extra rota día a día; las líneas siempre suman el fondo exacto (ej. $10.000 entre 3 → $3.334, $3.333 y $3.333). Un no seleccionado no recibe línea y no se usan horas. Si ya existe un borrador del mismo local y período, lo reemplaza conservando su ID y subiendo su versión; con expectedVersion el recálculo exige que la versión revisada siga vigente.',
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
      'El reparto del período ya está confirmado o pagado, expectedVersion no coincide con el borrador (cuerpo con currentStatus y currentVersion), o hubo un cálculo simultáneo.',
    type: TipPoolConflictDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'No hay operaciones diarias en el período, alguna ya forma parte de otro reparto o un día con propinas no tiene participantes; se informan todas las causas y no se guarda nada.',
    type: TipPoolValidationErrorDto,
  })
  async preview(
    @Body() dto: CalculateTipPoolDto,
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
        sources: result.pool.dailySources.length,
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
      'Revalida que el reparto esté conciliado (Σ líneas = total y Σ fuentes = total). En el reparto equitativo además recalcula con las operaciones diarias vigentes del período y exige que fuentes y líneas coincidan con la foto: si una operación se corrigió, agregó o cambió su selección, responde 422 y hay que recalcular. Desde la confirmación los montos, las operaciones fuente y su selección no se pueden modificar.',
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
      'El reparto no está conciliado o su foto equitativa quedó desactualizada; no se confirma y hay que recalcularlo.',
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
  @Header('Cache-Control', 'private, no-store')
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
  @Header('Cache-Control', 'private, no-store')
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
      'Cache-Control': {
        description: 'El PDF personal no se guarda en caché.',
        schema: { type: 'string', example: 'private, no-store' },
      },
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
