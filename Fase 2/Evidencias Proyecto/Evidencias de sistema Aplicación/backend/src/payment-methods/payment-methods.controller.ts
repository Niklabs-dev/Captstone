import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { AUDIT_ACTION } from '../audit/constants/audit-actions.constants.js';
import { Audited } from '../audit/decorators/audited.decorator.js';
import { setAuditContext } from '../audit/utils/audit-context.util.js';
import { ROLE } from '../auth/constants/roles.constants.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto.js';
import { ListPaymentMethodsQueryDto } from './dto/list-payment-methods-query.dto.js';
import { PaymentMethodResponseDto } from './dto/payment-method-response.dto.js';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import type {
  PaymentMethodResponse,
  PaymentMethodStateChange,
} from './types/payment-methods.types.js';

@ApiTags('payment-methods')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista los medios de pago del catálogo, con filtros de estado y disponibilidad para propinas',
  })
  @ApiOkResponse({
    description: 'Medios ordenados por sortOrder y código.',
    type: PaymentMethodResponseDto,
    isArray: true,
  })
  @ApiBadRequestResponse({
    description: 'Los filtros de consulta no superan la validación.',
  })
  findAll(
    @Query() query: ListPaymentMethodsQueryDto,
  ): Promise<PaymentMethodResponse[]> {
    return this.paymentMethodsService.findAll(query);
  }

  @Post()
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_CREATED,
    entityType: 'payment_methods',
    entityIdFrom: 'response.id',
    detailFromBody: [
      'code',
      'name',
      'sortOrder',
      'behavior',
      'availableForTips',
    ],
  })
  @ApiOperation({ summary: 'Crea un medio de pago en el catálogo' })
  @ApiCreatedResponse({
    description: 'Medio de pago creado.',
    type: PaymentMethodResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Datos obligatorios inválidos.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede crear medios de pago.',
  })
  @ApiConflictResponse({
    description: 'Ya existe un medio de pago con ese código.',
  })
  async create(
    @Body() dto: CreatePaymentMethodDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodResponse> {
    const paymentMethod = await this.paymentMethodsService.create(dto);
    setAuditContext(res, {
      detail: {
        code: paymentMethod.code,
        name: paymentMethod.name,
      },
    });
    return paymentMethod;
  }

  @Patch(':id')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_UPDATED,
    entityType: 'payment_methods',
    entityIdFrom: 'params.id',
    detailFromBody: ['name', 'sortOrder', 'behavior', 'availableForTips'],
  })
  @ApiOperation({
    summary: 'Edita nombre, orden, comportamiento o propinas de un medio',
  })
  @ApiOkResponse({
    description: 'Medio de pago actualizado.',
    type: PaymentMethodResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'ID no es un UUID o no hay campos para actualizar.',
  })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede editar medios de pago.',
  })
  @ApiNotFoundResponse({ description: 'Medio de pago no encontrado.' })
  @ApiConflictResponse({
    description:
      'No se puede cambiar el comportamiento de un medio con historial asociado.',
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePaymentMethodDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodResponse> {
    const paymentMethod = await this.paymentMethodsService.update(id, dto);
    setAuditContext(res, {
      detail: {
        code: paymentMethod.code,
        name: paymentMethod.name,
      },
    });
    return paymentMethod;
  }

  @Patch(':id/deactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_DEACTIVATED,
    entityType: 'payment_methods',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Desactiva un medio de pago sin eliminar ni ocultar su historial',
  })
  @ApiOkResponse({
    description: 'Medio desactivado; idempotente si ya estaba inactivo.',
    type: PaymentMethodResponseDto,
  })
  @ApiBadRequestResponse({ description: 'ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede desactivar medios de pago.',
  })
  @ApiNotFoundResponse({ description: 'Medio de pago no encontrado.' })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodResponse> {
    const result: PaymentMethodStateChange =
      await this.paymentMethodsService.deactivate(id);
    setAuditContext(res, {
      detail: { code: result.paymentMethod.code },
      skipAudit: !result.changed,
    });
    return result.paymentMethod;
  }

  @Patch(':id/reactivate')
  @Roles(ROLE.ADMINISTRADOR)
  @Audited({
    action: AUDIT_ACTION.PAYMENT_METHOD_REACTIVATED,
    entityType: 'payment_methods',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({ summary: 'Reactiva un medio de pago inactivo' })
  @ApiOkResponse({
    description: 'Medio reactivado; idempotente si ya estaba activo.',
    type: PaymentMethodResponseDto,
  })
  @ApiBadRequestResponse({ description: 'ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'Solo ADMINISTRADOR puede reactivar medios de pago.',
  })
  @ApiNotFoundResponse({ description: 'Medio de pago no encontrado.' })
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PaymentMethodResponse> {
    const result: PaymentMethodStateChange =
      await this.paymentMethodsService.reactivate(id);
    setAuditContext(res, {
      detail: { code: result.paymentMethod.code },
      skipAudit: !result.changed,
    });
    return result.paymentMethod;
  }
}
