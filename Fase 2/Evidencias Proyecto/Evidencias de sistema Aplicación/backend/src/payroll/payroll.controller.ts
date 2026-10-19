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
import type { AuthUser } from '../auth/types/auth.types.js';
import { contentDisposition } from '../documents/utils/download-name.util.js';
import { ListPayslipsQueryDto } from './dto/list-payslips-query.dto.js';
import {
  OwnPayslipIntegrityDto,
  OwnPayslipListDto,
} from './dto/own-payslip-response.dto.js';
import { PublishPayslipDto } from './dto/publish-payslip.dto.js';
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
  OWN_PAYSLIP_READER_ROLES,
  PAYROLL_READER_ROLES,
  PAYSLIP_MIME_TYPE,
  type OwnPayslipIntegrity,
  type OwnPayslipList,
  type PayslipCollection,
  type PayslipResponse,
  type UploadedPayslipFile,
} from './types/payroll.types.js';

// Liquidaciones de sueldo (E2-H1): el contador carga la liquidación de cada
// trabajador por período, que queda pendiente de firma y no visible para el
// trabajador (SPRINT-2-T13), y confirma su publicación (SPRINT-2-T14). El
// administrador solo consulta. En el portal, cada trabajador ve y descarga
// solo sus liquidaciones publicadas (SPRINT-2-T15, rutas /payroll/mine). La
// carga, la publicación y la descarga quedan en la auditoría, sin el
// contenido del archivo.
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

  @Get('mine')
  @Roles(...OWN_PAYSLIP_READER_ROLES)
  @ApiOperation({
    summary: 'Lista las liquidaciones publicadas del trabajador autenticado',
    description:
      'El trabajador sale del token, nunca de un parámetro (Ley N°21.719). Solo devuelve liquidaciones publicadas: las pendientes de firma no se muestran.',
  })
  @ApiOkResponse({
    description: 'Liquidaciones publicadas propias.',
    type: OwnPayslipListDto,
  })
  @ApiForbiddenResponse({
    description: 'El rol no es TRABAJADOR ni SUPERVISOR.',
  })
  listOwn(@CurrentUser() currentUser: AuthUser): Promise<OwnPayslipList> {
    return this.payrollService.listOwn(currentUser);
  }

  @Get('mine/:id/integrity')
  @Roles(...OWN_PAYSLIP_READER_ROLES)
  @ApiOperation({
    summary:
      'Verifica la integridad de una liquidación propia recalculando su SHA-256',
    description:
      'Responde 200 con status VALID, ALTERED (archivo modificado) o MISSING (archivo ausente). Una liquidación de otro trabajador o pendiente de firma responde 404.',
  })
  @ApiOkResponse({
    description: 'Resultado de la verificación.',
    type: OwnPayslipIntegrityDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'El rol no es TRABAJADOR ni SUPERVISOR.',
  })
  @ApiNotFoundResponse({
    description:
      'No existe una liquidación publicada con ese ID para el trabajador autenticado.',
  })
  checkOwnIntegrity(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<OwnPayslipIntegrity> {
    return this.payrollService.checkOwnIntegrity(id, currentUser);
  }

  @Get('mine/:id/download')
  @Roles(...OWN_PAYSLIP_READER_ROLES)
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, no-store')
  @Audited({
    action: AUDIT_ACTION.PAYSLIP_DOWNLOADED,
    entityType: 'payslips',
    entityIdFrom: 'params.id',
  })
  @ApiProduces(PAYSLIP_MIME_TYPE)
  @ApiOperation({
    summary: 'Descarga el PDF de una liquidación propia publicada',
    description:
      'Recalcula el SHA-256 al descargar: si no coincide con el registrado, el archivo se entrega igual pero con X-Document-Integrity: ALTERED para advertirlo. Una liquidación de otro trabajador o pendiente de firma responde 404.',
  })
  @ApiOkResponse({
    description:
      'PDF de la liquidación, con nombre LIQUIDACION_<título>_v<N>.pdf en Content-Disposition.',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': {
        description:
          'attachment con el nombre del archivo (filename y filename*).',
        schema: { type: 'string' },
      },
      'Cache-Control': {
        description: 'Siempre private, no-store: dato personal sensible.',
        schema: { type: 'string', example: 'private, no-store' },
      },
      'X-Content-Type-Options': {
        description: 'Siempre nosniff.',
        schema: { type: 'string', example: 'nosniff' },
      },
      'X-Document-Integrity': {
        description:
          'VALID si el archivo coincide con el hash registrado; ALTERED si fue modificado.',
        schema: { type: 'string', enum: ['VALID', 'ALTERED'] },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiForbiddenResponse({
    description: 'El rol no es TRABAJADOR ni SUPERVISOR.',
  })
  @ApiNotFoundResponse({
    description:
      'No existe una liquidación publicada con ese ID para el trabajador autenticado, o su archivo no está en el almacenamiento.',
  })
  async downloadOwn(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.payrollService.downloadOwn(id, currentUser);
    res.setHeader('X-Document-Integrity', file.integrity);
    // La respuesta es el archivo: el local y el detalle se aportan aparte.
    setAuditContext(res, {
      storeId: file.storeId,
      detail: { versionId: file.versionId, integrity: file.integrity },
    });
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: contentDisposition(file.fileName),
      length: file.content.length,
    });
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

  @Post(':id/publish')
  @Roles(ROLE.CONTADOR)
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.PAYSLIP_PUBLISHED,
    entityType: 'payslips',
    entityIdFrom: 'params.id',
    detailFromResponse: {
      workerId: 'worker.id',
      period: 'period',
      signedAt: 'signedAt',
      publishedAt: 'publishedAt',
      sha256: 'sha256',
    },
  })
  @ApiOperation({
    summary:
      'Publica una liquidación pendiente de firma en el portal de su trabajador',
    description:
      'Solo CONTADOR y solo el paso PENDING_SIGNATURE → PUBLISHED. Antes de publicar recalcula el SHA-256 del archivo. Registra la fecha de firma, la de publicación y quién publicó, y queda en la auditoría. Publicada, la liquidación ya no se puede editar ni eliminar (la base de datos lo rechaza).',
  })
  @ApiOkResponse({
    description: 'Liquidación publicada (status PUBLISHED, canPublish false).',
    type: PayslipResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'El ID no es un UUID, falta revision o signedAt no es una fecha válida entre el día de carga y hoy.',
  })
  @ApiForbiddenResponse({ description: 'El rol no es CONTADOR.' })
  @ApiNotFoundResponse({ description: 'Liquidación no encontrada.' })
  @ApiConflictResponse({
    description:
      'La liquidación ya está publicada, cambió desde la consulta (revision distinta) o su archivo no coincide con el hash registrado.',
  })
  async publish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: PublishPayslipDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PayslipResponse> {
    const payslip = await this.payrollService.publish(id, dto, currentUser);
    setAuditContext(res, { storeId: payslip.worker.store.id });
    return payslip;
  }
}
