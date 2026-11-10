import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
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
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { AUDIT_ACTION } from '../../audit/constants/audit-actions.constants.js';
import { Audited } from '../../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../../audit/utils/audit-context.util.js';
import { ROLE } from '../../auth/constants/roles.constants.js';
import { Roles } from '../../auth/decorators/roles.decorator.js';
import {
  CreatePaymentMethodAliasDto,
  PaymentMethodAliasResponseDto,
} from './payment-method-alias.dto.js';
import { PaymentMethodAliasesService } from './payment-method-aliases.service.js';
import type { PaymentMethodAliasResponse } from './payment-method-aliases.types.js';

// Alias de los medios de pago en los informes de MrComanda (SPRINT-4A-T20).
// Solo el ADMINISTRADOR los consulta y modifica; cada alta y baja se audita
// con la etiqueta y el medio.
@ApiTags('payment-method-aliases')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description: 'Solo el ADMINISTRADOR administra los alias de medios de pago.',
})
@Roles(ROLE.ADMINISTRADOR)
@Controller('payment-method-aliases')
export class PaymentMethodAliasesController {
  constructor(private readonly aliases: PaymentMethodAliasesService) {}

  @Get()
  @ApiOperation({
    summary: 'Lista las etiquetas del informe asociadas a cada medio de pago',
  })
  @ApiOkResponse({
    description:
      'Alias de MrComanda ordenados por el orden del medio y la etiqueta.',
    type: PaymentMethodAliasResponseDto,
    isArray: true,
  })
  findAll(): Promise<PaymentMethodAliasResponse[]> {
    return this.aliases.findAll();
  }

  @Post()
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_CREATED,
    entityType: 'payment_method_aliases',
    entityIdFrom: 'response.id',
  })
  @ApiOperation({
    summary: 'Asocia una etiqueta del informe a un medio de pago',
    description:
      'La etiqueta se normaliza (mayúsculas, sin tildes y espacios ' +
      'colapsados) y es única: una etiqueta resuelve un solo medio. Las ' +
      'próximas importaciones la reconocen; las ya confirmadas no cambian.',
  })
  @ApiCreatedResponse({
    description: 'Alias creado.',
    type: PaymentMethodAliasResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Etiqueta vacía o demasiado larga, ID inválido o medio inactivo.',
  })
  @ApiNotFoundResponse({ description: 'Medio de pago no encontrado.' })
  @ApiConflictResponse({
    description: 'La etiqueta ya está asociada a un medio.',
  })
  async create(
    @Body() dto: CreatePaymentMethodAliasDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodAliasResponse> {
    const alias = await this.aliases.create(dto);
    setAuditContext(res, {
      detail: {
        system: alias.system,
        label: alias.label,
        normalizedLabel: alias.normalizedLabel,
        paymentMethodId: alias.paymentMethod.id,
        paymentMethodCode: alias.paymentMethod.code,
        source: 'payment_methods',
      },
    });
    return alias;
  }

  @Delete(':id')
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_ALIAS_DELETED,
    entityType: 'payment_method_aliases',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Quita una etiqueta del informe de su medio de pago',
    description:
      'Las próximas importaciones con esa etiqueta pedirán elegir el medio ' +
      'a mano. Las importaciones ya confirmadas conservan su medio.',
  })
  @ApiOkResponse({
    description: 'Alias eliminado.',
    type: PaymentMethodAliasResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'Alias no encontrado.' })
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodAliasResponse> {
    const alias = await this.aliases.remove(id);
    setAuditContext(res, {
      detail: {
        system: alias.system,
        label: alias.label,
        normalizedLabel: alias.normalizedLabel,
        paymentMethodId: alias.paymentMethod.id,
        paymentMethodCode: alias.paymentMethod.code,
      },
    });
    return alias;
  }
}
