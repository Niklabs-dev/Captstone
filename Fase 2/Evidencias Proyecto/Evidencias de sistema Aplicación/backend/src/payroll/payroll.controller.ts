import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
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
import type { AuthUser } from '../auth/types/auth.types.js';
import { ListPayslipsQueryDto } from './dto/list-payslips-query.dto.js';
import {
  PayslipCollectionDto,
  PayslipResponseDto,
} from './dto/payslip-response.dto.js';
import {
  UploadPayslipDto,
  UploadPayslipFormDto,
} from './dto/upload-payslip.dto.js';
import { PayrollService } from './payroll.service.js';
import {
  PAYROLL_READER_ROLES,
  type PayslipCollection,
  type PayslipResponse,
  type UploadedPayslipFile,
} from './types/payroll.types.js';

// Liquidaciones de sueldo (E2-H1): el contador carga la liquidación de cada
// trabajador por período, que queda pendiente de firma y no visible para el
// trabajador (SPRINT-2-T13). El administrador solo consulta. La carga queda
// en la auditoría, sin el contenido del archivo.
@ApiTags('payroll')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Get()
  @Roles(...PAYROLL_READER_ROLES)
  @ApiOperation({
    summary:
      'Lista las liquidaciones con el selector de trabajadores y las reglas de carga',
    description:
      'Para el contador (gestión) y el administrador (solo consulta). Incluye liquidaciones pendientes de firma y publicadas; cada una conserva el local que tenía el trabajador al cargarla.',
  })
  @ApiOkResponse({
    description: 'Liquidaciones, trabajadores para la carga y reglas de carga.',
    type: PayslipCollectionDto,
  })
  @ApiBadRequestResponse({
    description: 'Algún filtro de la consulta no supera la validación.',
  })
  @ApiForbiddenResponse({
    description: 'El rol no es CONTADOR ni ADMINISTRADOR.',
  })
  list(
    @Query() query: ListPayslipsQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<PayslipCollection> {
    return this.payrollService.list(query, currentUser);
  }

  @Post()
  @Roles(ROLE.CONTADOR)
  @UseInterceptors(FileInterceptor('file'))
  @Audited({
    action: AUDIT_ACTION.PAYSLIP_UPLOADED,
    entityType: 'payslips',
    entityIdFrom: 'response.id',
    detailFromBody: ['workerId', 'period'],
    detailFromResponse: { sha256: 'sha256', status: 'status' },
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadPayslipFormDto })
  @ApiOperation({
    summary:
      'Carga la liquidación de un trabajador para un período, pendiente de firma',
    description:
      'Solo CONTADOR. Guarda el PDF en el gestor documental con su hash SHA-256 y crea la liquidación en estado PENDING_SIGNATURE, que el trabajador no ve hasta que se publique. Valida el período, que el trabajador esté activo y que no exista otra liquidación suya para ese período.',
  })
  @ApiCreatedResponse({
    description: 'Liquidación cargada en estado PENDING_SIGNATURE.',
    type: PayslipResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, falta el archivo, el período es posterior al mes en curso o el usuario no es un trabajador activo con local.',
  })
  @ApiForbiddenResponse({ description: 'El rol no es CONTADOR.' })
  @ApiNotFoundResponse({ description: 'No existe el trabajador indicado.' })
  @ApiConflictResponse({
    description:
      'Ya existe una liquidación del trabajador para ese período, o el archivo ya está registrado (mismo hash SHA-256).',
  })
  @ApiPayloadTooLargeResponse({
    description: 'El archivo supera DOCUMENTS_MAX_SIZE_MB.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'El archivo no es PDF o su contenido no coincide con el tipo declarado.',
  })
  async upload(
    @Body() dto: UploadPayslipDto,
    @UploadedFile() file: UploadedPayslipFile | undefined,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PayslipResponse> {
    const payslip = await this.payrollService.upload(dto, file, currentUser);
    // El contador es global: el local del evento es el de la liquidación.
    setAuditContext(res, { storeId: payslip.worker.store.id });
    return payslip;
  }
}
