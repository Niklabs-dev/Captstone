import {
  Controller,
  Get,
  GoneException,
  Header,
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
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { contentDisposition } from '../documents/utils/download-name.util.js';
import { ListTipPoolsQueryDto } from './dto/list-tip-pools-query.dto.js';
import {
  TipPoolReceiptResponseDto,
  TipPoolResponseDto,
  TipPoolRetiredActionDto,
} from './dto/tip-pool-response.dto.js';
import { TipPoolsService } from './tip-pools.service.js';
import {
  TIP_POOL_RETIRED_MESSAGE,
  type TipPoolReceiptResponse,
  type TipPoolResponse,
} from './types/tip-pools.types.js';

const POOL_ID_PARAM = {
  name: 'id',
  description: 'ID del reparto (se ignora: la acción ya no existe).',
  example: 'a9000000-0000-4000-8000-000000000009',
} as const;

const RETIRED_RESPONSE = {
  description:
    'Acción retirada en SPRINT-4A-T08: no crea ni cambia repartos y responde siempre 410, con cualquier rol y cuerpo.',
  type: TipPoolRetiredActionDto,
} as const;

// Las acciones retiradas responden 410 sin leer el cuerpo ni tocar la base.
function retiredAction(): never {
  throw new GoneException(TIP_POOL_RETIRED_MESSAGE);
}

// Repartos de propinas por período (SPRINT-3-T12 y T13), histórico de solo
// lectura desde SPRINT-4A-T08: el reparto se genera al guardar la operación
// diaria y se paga por lote (POST /daily-tips/payment-batches). Contador y
// administrador consultan los repartos guardados y descargan las constancias
// de los pagados; el cálculo, la observación, la confirmación y el pago
// responden 410 para que nadie pague por aquí propinas que el flujo diario
// también pagaría.
@ApiTags('tip-pools')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('tip-pools')
export class TipPoolsController {
  constructor(private readonly tipPoolsService: TipPoolsService) {}

  @Get()
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Lista los repartos históricos por período, sin recalcular',
    description:
      'Solo lectura. Sin filtros devuelve todos los repartos guardados, del período más reciente al más antiguo (DRAFT: borrador sin efecto; CONFIRMED: confirmado sin pago registrado; PAID: pagado con constancias). storeId acota a un local y periodStart con periodEnd buscan el período exacto.',
  })
  @ApiOkResponse({
    description: 'Repartos encontrados o lista vacía.',
    type: TipPoolResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description:
      'Local inválido, fecha inválida, solo una de las dos fechas o período invertido.',
  })
  @ApiForbiddenResponse({
    description: 'Solo el contador y el administrador consultan repartos.',
  })
  list(
    @Query() query: ListTipPoolsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TipPoolResponse[]> {
    return this.tipPoolsService.findAll(query, user);
  }

  @Post('preview')
  @ApiOperation({
    summary: 'Retirado: calculaba el borrador del reparto por período',
    description:
      'Desde SPRINT-4A-T08 el reparto se genera automáticamente al guardar la operación diaria (daily_tip_allocations); este endpoint ya no crea ni recalcula repartos.',
    deprecated: true,
  })
  @ApiGoneResponse(RETIRED_RESPONSE)
  preview(): never {
    return retiredAction();
  }

  @Get(':id')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary: 'Obtiene la foto guardada de un reparto histórico',
  })
  @ApiOkResponse({
    description: 'Reparto con el pacto, las líneas y las fuentes guardadas.',
    type: TipPoolResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiForbiddenResponse({
    description: 'Solo el contador y el administrador consultan repartos.',
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

  @Post(':id/observations')
  @ApiOperation({
    summary: 'Retirado: registraba una observación sobre un borrador',
    description:
      'Desde SPRINT-4A-T08 los borradores son históricos sin efecto y no admiten observaciones.',
    deprecated: true,
  })
  @ApiParam(POOL_ID_PARAM)
  @ApiGoneResponse(RETIRED_RESPONSE)
  observe(): never {
    return retiredAction();
  }

  @Post(':id/confirm')
  @ApiOperation({
    summary: 'Retirado: confirmaba un borrador (DRAFT → CONFIRMED)',
    description:
      'Desde SPRINT-4A-T08 los repartos no se confirman: las propinas de cada día quedan registradas al guardar la operación diaria.',
    deprecated: true,
  })
  @ApiParam(POOL_ID_PARAM)
  @ApiGoneResponse(RETIRED_RESPONSE)
  confirm(): never {
    return retiredAction();
  }

  @Post(':id/pay')
  @ApiOperation({
    summary: 'Retirado: marcaba un reparto como pagado y emitía constancias',
    description:
      'Desde SPRINT-4A-T08 el pago se registra por período en POST /daily-tips/payment-batches, que marca como pagadas las propinas diarias. Pagar aquí dejaba esas propinas sin pagar y permitía pagarlas dos veces.',
    deprecated: true,
  })
  @ApiParam(POOL_ID_PARAM)
  @ApiGoneResponse(RETIRED_RESPONSE)
  pay(): never {
    return retiredAction();
  }

  @Get(':id/receipts')
  @Roles(ROLE.CONTADOR, ROLE.ADMINISTRADOR)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lista las constancias de pago de un reparto histórico pagado',
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
    description:
      'El reparto no está pagado (DRAFT o CONFIRMED) y no tiene constancias.',
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
    description:
      'El reparto no está pagado (DRAFT o CONFIRMED) y no tiene constancias.',
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
