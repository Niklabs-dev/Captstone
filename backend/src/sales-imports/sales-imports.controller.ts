import {
  Body,
  Controller,
  Delete,
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
  ApiUnprocessableEntityResponse,
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
import {
  ConfirmSalesImportDto,
  ListSalesImportsQueryDto,
  PreviewSalesImportFormDto,
} from './dto/sales-import-request.dto.js';
import {
  SalesImportConflictDto,
  SalesImportDetailDto,
  SalesImportPreviewDto,
  SalesImportReportErrorDto,
  SalesImportSummaryDto,
} from './dto/sales-import-response.dto.js';
import { MAX_REPORT_FILE_BYTES } from './parser/xlsx-workbook.reader.js';
import { SalesImportsService } from './sales-imports.service.js';
import type {
  SalesImportDetail,
  SalesImportPreview,
  SalesImportSummary,
  SalesImportUploadedFile,
} from './types/sales-imports.types.js';

// Importación diaria de ventas desde el Excel de MrComanda (SPRINT-4R-T10).
// Solo el ADMINISTRADOR carga, confirma, descarta y consulta: importa los
// totales diarios por medio de pago de cada local. No existe otro formulario
// manual de ventas y el archivo no aporta propinas ni descuadres (esos vienen
// de la operación diaria).
@ApiTags('sales-imports')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@ApiForbiddenResponse({
  description: 'Solo el ADMINISTRADOR puede usar la importación de ventas.',
})
@Roles(ROLE.ADMINISTRADOR)
@Controller('sales-imports')
export class SalesImportsController {
  constructor(private readonly salesImports: SalesImportsService) {}

  @Post('preview')
  @UseInterceptors(
    // Un solo archivo y hasta 5 MB (SPRINT-4R-T18): Multer corta la subida al
    // superar cualquiera de los dos límites (413 o 400).
    FileInterceptor('file', {
      limits: { fileSize: MAX_REPORT_FILE_BYTES, files: 1 },
    }),
  )
  @Audited({
    action: AUDIT_ACTION.SALES_IMPORT_PREVIEWED,
    entityType: 'sales_imports',
    entityIdFrom: 'context.entityId',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: PreviewSalesImportFormDto })
  @ApiOperation({
    summary:
      'Carga el Excel diario de MrComanda y muestra la vista previa antes de confirmar',
    description:
      'Lee el «Informe de Ventas Diario» (.xlsx, máximo 5 MB; se valida por ' +
      'su contenido): fecha de negocio desde el «Período», emisión, local, ' +
      'medios de pago y total. Resuelve el local y cada medio con las ' +
      'equivalencias configuradas. Si todo resuelve, guarda el archivo en el ' +
      'volumen privado y crea la importación PENDING con su siguiente versión ' +
      '(201, outcome CREATED). El mismo archivo para el mismo local y fecha ' +
      'devuelve la importación existente sin duplicarla (200, EXISTING). Si ' +
      'falta configurar el local o algún medio responde 200 con outcome ' +
      'UNRESOLVED, la lista de problemas y sin guardar nada. activeImport ' +
      'indica la versión vigente que la confirmación reemplazaría.',
  })
  @ApiCreatedResponse({
    description: 'Archivo nuevo guardado como PENDING, listo para confirmar.',
    type: SalesImportPreviewDto,
  })
  @ApiOkResponse({
    description:
      'Archivo ya importado (EXISTING) o con equivalencias faltantes (UNRESOLVED); no se guarda nada nuevo.',
    type: SalesImportPreviewDto,
  })
  @ApiBadRequestResponse({
    description: 'No se adjuntó el archivo o está vacío.',
    type: SalesImportReportErrorDto,
  })
  @ApiPayloadTooLargeResponse({
    description:
      'El archivo supera los 5 MB, o su contenido supera los 25 MB al ' +
      'descomprimirse o los 100 archivos internos (code FILE_TOO_LARGE).',
  })
  @ApiUnsupportedMediaTypeResponse({
    description: 'El archivo no es un .xlsx (por ejemplo .xls antiguo o CSV).',
    type: SalesImportReportErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'El .xlsx está dañado o no es un «Informe de Ventas Diario» válido: período de varios días, local combinado, montos inválidos, total que no cuadra, etc. Incluye code y row.',
    type: SalesImportReportErrorDto,
  })
  @ApiConflictResponse({
    description:
      'Una equivalencia cambió durante la carga; hay que volver a subir el archivo.',
  })
  async preview(
    @UploadedFile() file: SalesImportUploadedFile | undefined,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SalesImportPreview> {
    const { preview, created } = await this.salesImports.preview(
      file,
      currentUser,
    );
    res.status(created ? 201 : 200);
    const saved = preview.import;
    // Lista blanca: solo identificadores y totales, nunca contenido del
    // archivo. Solo se audita la carga que guardó una importación nueva.
    setAuditContext(res, {
      entityId: saved?.id,
      storeId: saved?.store.id ?? null,
      skipAudit: !created || saved === null,
      detail: saved
        ? {
            businessDate: saved.businessDate,
            sha256Hash: saved.sha256Hash,
            version: saved.version,
            totalAmount: saved.totalAmount,
          }
        : undefined,
    });
    return preview;
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @Audited({
    action: AUDIT_ACTION.SALES_IMPORT_CONFIRMED,
    entityType: 'sales_imports',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary:
      'Confirma una importación pendiente y la deja como la versión vigente',
    description:
      'En una sola transacción la versión vigente del mismo local y fecha ' +
      'pasa a SUPERSEDED y esta a ACTIVE. expectedActiveImportId debe ser la ' +
      'versión vigente que se reemplaza (activeImport.id de la vista previa) ' +
      'o null si no había: si cambió entretanto responde 409, de modo que ' +
      'una corrección siempre se confirma de forma explícita. Confirmar de ' +
      'nuevo una importación ya vigente devuelve 200 sin cambios.',
  })
  @ApiOkResponse({
    description: 'Importación vigente con sus líneas y todas sus versiones.',
    type: SalesImportDetailDto,
  })
  @ApiBadRequestResponse({
    description:
      'ID inválido o expectedActiveImportId ausente o con formato inválido.',
  })
  @ApiNotFoundResponse({ description: 'Importación no encontrada.' })
  @ApiConflictResponse({
    description:
      'La versión vigente cambió desde la vista previa, o esta versión ya fue reemplazada. Incluye la vigente actual.',
    type: SalesImportConflictDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'La base rechazó la confirmación (por ejemplo, las líneas no suman el total).',
  })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmSalesImportDto,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SalesImportDetail> {
    const result = await this.salesImports.confirm(id, dto, currentUser);
    setAuditContext(res, {
      storeId: result.import.store.id,
      skipAudit: !result.confirmed,
      detail: {
        businessDate: result.import.businessDate,
        sha256Hash: result.import.sha256Hash,
        version: result.import.version,
        totalAmount: result.import.totalAmount,
        supersededImportId: result.superseded?.id ?? null,
        supersededVersion: result.superseded?.version ?? null,
      },
    });
    return result.import;
  }

  @Delete(':id')
  @Audited({
    action: AUDIT_ACTION.SALES_IMPORT_DISCARDED,
    entityType: 'sales_imports',
    entityIdFrom: 'params.id',
  })
  @ApiOperation({
    summary: 'Descarta una importación pendiente y elimina su archivo',
    description:
      'Solo para importaciones PENDING (vista previa no confirmada). Las ' +
      'confirmadas o reemplazadas se conservan siempre como historial.',
  })
  @ApiOkResponse({
    description: 'Datos de la importación descartada.',
    type: SalesImportSummaryDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'Importación no encontrada.' })
  @ApiConflictResponse({
    description: 'La importación ya fue confirmada o reemplazada.',
  })
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SalesImportSummary> {
    const discarded = await this.salesImports.discard(id);
    setAuditContext(res, {
      storeId: discarded.store.id,
      detail: {
        businessDate: discarded.businessDate,
        sha256Hash: discarded.sha256Hash,
        version: discarded.version,
      },
    });
    return discarded;
  }

  @Get()
  @ApiOperation({
    summary: 'Lista importaciones de ventas por local, fechas y estado',
    description:
      'Ordenadas de la fecha más reciente a la más antigua y, dentro de cada ' +
      'fecha, de la versión más nueva a la más antigua. Sin las líneas: ' +
      'el detalle está en GET /sales-imports/{id}.',
  })
  @ApiOkResponse({
    description: 'Arreglo de importaciones (posiblemente vacío).',
    type: SalesImportSummaryDto,
    isArray: true,
  })
  @ApiBadRequestResponse({ description: 'Filtros con formato inválido.' })
  findAll(
    @Query() query: ListSalesImportsQueryDto,
  ): Promise<SalesImportSummary[]> {
    return this.salesImports.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Obtiene el detalle de una importación con sus líneas y versiones',
  })
  @ApiOkResponse({
    description: 'Importación con líneas por medio de pago y versiones.',
    type: SalesImportDetailDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiNotFoundResponse({ description: 'Importación no encontrada.' })
  findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SalesImportDetail> {
    return this.salesImports.findOne(id);
  }

  @Get(':id/file')
  @Header('X-Content-Type-Options', 'nosniff')
  @Audited({
    action: AUDIT_ACTION.SALES_IMPORT_FILE_DOWNLOADED,
    entityType: 'sales_imports',
    entityIdFrom: 'params.id',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
  @ApiOperation({
    summary: 'Descarga el Excel original de una importación',
    description:
      'Descarga privada y autorizada desde el volumen privado. Recalcula el ' +
      'SHA-256: si no coincide con el registrado, el archivo se entrega igual ' +
      'pero con X-File-Integrity: ALTERED para advertirlo.',
  })
  @ApiOkResponse({
    description: 'Archivo .xlsx con su nombre original en Content-Disposition.',
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
      'X-File-Integrity': {
        description:
          'VALID si el archivo coincide con el hash registrado; ALTERED si fue modificado.',
        schema: { type: 'string', enum: ['VALID', 'ALTERED'] },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID válido.' })
  @ApiNotFoundResponse({
    description: 'Importación no encontrada o archivo ausente en el volumen.',
  })
  async downloadFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.salesImports.downloadFile(id);
    res.setHeader('X-File-Integrity', file.integrity);
    setAuditContext(res, {
      storeId: file.storeId,
      detail: { integrity: file.integrity },
    });
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: contentDisposition(file.fileName),
      length: file.content.length,
    });
  }
}
