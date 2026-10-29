import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ROLE } from '../auth/constants/roles.constants.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { contentDisposition } from '../documents/utils/download-name.util.js';
import { MyTipReceiptsService } from './my-tip-receipts.service.js';
import { OwnTipReceiptDto } from './dto/own-tip-receipt.dto.js';
@ApiTags('my-tip-receipts')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Sesión ausente, inválida o vencida.' })
@ApiForbiddenResponse({
  description: 'Solo el trabajador puede consultar su historial.',
})
@ApiBadRequestResponse({
  description: 'Parámetros de consulta no admitidos o ID inválido.',
})
@Roles(ROLE.TRABAJADOR)
@Controller('my-tip-receipts')
export class MyTipReceiptsController {
  constructor(private readonly receipts: MyTipReceiptsService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Lista únicamente las constancias propias de repartos PAID',
    description:
      'La identidad procede del JWT. No admite filtros de trabajador ni local y conserva el historial al cambiar de local.',
  })
  @ApiOkResponse({
    description: 'Proyección personal, sin líneas de compañeros ni borradores.',
    type: OwnTipReceiptDto,
    isArray: true,
  })
  list(
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ): Promise<OwnTipReceiptDto[]> {
    if (Object.keys(query).length)
      throw new BadRequestException('No se admiten parámetros.');
    return this.receipts.list(user);
  }
  @Get(':id/download')
  @ApiProduces('application/pdf')
  @ApiOperation({
    summary: 'Descarga la constancia propia con SHA-256 de sus bytes',
    description:
      'El PDF es el de T13: determinista y generado desde la foto del pago, sin recalcular montos.',
  })
  @ApiOkResponse({
    description: 'PDF propio y resumen SHA-256 en X-Content-SHA256.',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'X-Content-SHA256': {
        description: 'SHA-256 hexadecimal del PDF.',
        schema: { type: 'string' },
      },
    },
  })
  @ApiNotFoundResponse({
    description:
      'Constancia ajena, inexistente o de un reparto que no está PAID.',
  })
  @Audited({
    action: AUDIT_ACTION.TIP_POOL_RECEIPT_DOWNLOADED,
    entityType: 'tip_pool_receipts',
    entityIdFrom: 'context.entityId',
  })
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    if (Object.keys(query).length)
      throw new BadRequestException('No se admiten parámetros.');
    const file = await this.receipts.download(id, user);
    setAuditContext(response, {
      entityId: file.receiptId,
      storeId: file.storeId,
      detail: { userId: user.id },
    });
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Content-SHA256', file.sha256);
    return new StreamableFile(file.content, {
      type: 'application/pdf',
      length: file.content.length,
      disposition: contentDisposition(file.fileName),
    });
  }
}
