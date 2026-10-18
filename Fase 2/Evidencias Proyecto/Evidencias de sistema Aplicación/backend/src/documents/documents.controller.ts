import {
  Body,
  Controller,
  Delete,
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
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { ALLOWED_MIME_TYPES } from '../storage/types/storage.types.js';
import { DocumentsService } from './documents.service.js';
import {
  DocumentDeletionResponseDto,
  DocumentListResponseDto,
  DocumentResponseDto,
  DocumentVersionHistoryDto,
  IntegrityCheckResponseDto,
} from './dto/document-response.dto.js';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto.js';
import {
  UploadDocumentDto,
  UploadDocumentFormDto,
} from './dto/upload-document.dto.js';
import {
  DOCUMENT_READER_ROLES,
  type DocumentDeletionResponse,
  type DocumentListResponse,
  type DocumentResponse,
  type DocumentVersionHistory,
  type IntegrityCheckResponse,
  type UploadedDocumentFile,
} from './types/documents.types.js';
import { contentDisposition } from './utils/download-name.util.js';

// Gestor documental: carga de documentos laborales por trabajador, solo el
// dueño/administrador (SPRINT-2-T05); consulta, descarga y verificación de
// integridad para el administrador y para cada trabajador sobre sus propios
// documentos (SPRINT-2-T06). La eliminación, solo del administrador, se
// bloquea mientras no venza el plazo de conservación (SPRINT-2-T07).
@ApiTags('documents')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @Roles(ROLE.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadDocumentFormDto })
  @ApiOperation({
    summary:
      'Carga un documento laboral en la carpeta de un trabajador, o una nueva versión de uno existente',
    description:
      'Guarda el archivo con su hash SHA-256, número de versión y fecha de carga, asociado al trabajador y a su local. Con documentId crea una nueva versión; las anteriores quedan inmutables y consultables.',
  })
  @ApiCreatedResponse({
    description: 'Documento creado o nueva versión registrada.',
    type: DocumentResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Datos inválidos, falta el archivo o el título, el usuario no es un trabajador con local, o el documento indicado no es de ese trabajador o tipo.',
  })
  @ApiNotFoundResponse({
    description: 'No existe el trabajador o el documento indicado.',
  })
  @ApiConflictResponse({
    description:
      'El archivo ya está registrado (el hash SHA-256 coincide con una versión existente).',
  })
  @ApiPayloadTooLargeResponse({
    description: 'El archivo supera DOCUMENTS_MAX_SIZE_MB.',
  })
  @ApiUnsupportedMediaTypeResponse({
    description:
      'El archivo no es PDF, PNG ni JPEG, o su contenido no coincide con el tipo declarado.',
  })
  upload(
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: UploadedDocumentFile | undefined,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DocumentResponse> {
    return this.documentsService.upload(dto, file, currentUser);
  }

  @Get()
  @Roles(...DOCUMENT_READER_ROLES)
  @ApiOperation({
    summary:
      'Lista documentos laborales con su versión vigente, con filtros por trabajador, tipo y local',
    description:
      'El administrador ve los documentos de todos los locales. Un trabajador o supervisor solo obtiene los suyos; indicar el workerId de otro responde 403.',
  })
  @ApiOkResponse({
    description: 'Documentos visibles y reglas de carga del usuario.',
    type: DocumentListResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Algún filtro de la consulta no supera la validación.',
  })
  list(
    @Query() query: ListDocumentsQueryDto,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DocumentListResponse> {
    return this.documentsService.list(query, currentUser);
  }

  @Get(':id/versions')
  @Roles(...DOCUMENT_READER_ROLES)
  @ApiOperation({
    summary: 'Muestra el historial completo de versiones de un documento',
    description:
      'Las versiones son inmutables. Un trabajador o supervisor solo accede a sus propios documentos (403 en otro caso).',
  })
  @ApiOkResponse({
    description: 'Versiones de la más nueva a la más antigua.',
    type: DocumentVersionHistoryDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  getVersionHistory(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DocumentVersionHistory> {
    return this.documentsService.getVersionHistory(id, currentUser);
  }

  @Get('versions/:versionId/download')
  @Roles(...DOCUMENT_READER_ROLES)
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiProduces(...ALLOWED_MIME_TYPES)
  @ApiOperation({
    summary: 'Descarga el archivo de una versión de un documento',
    description:
      'Recalcula el SHA-256 al descargar: si no coincide con el registrado, el archivo se entrega igual pero con X-Document-Integrity: ALTERED para advertirlo. Un trabajador o supervisor solo descarga sus propios documentos (403 en otro caso).',
  })
  @ApiOkResponse({
    description:
      'Archivo de la versión, con nombre <TIPO>_<título>_v<N>.<ext> en Content-Disposition.',
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
      'X-Document-Integrity': {
        description:
          'VALID si el archivo coincide con el hash registrado; ALTERED si fue modificado.',
        schema: { type: 'string', enum: ['VALID', 'ALTERED'] },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiNotFoundResponse({
    description: 'Versión no encontrada o archivo ausente del almacenamiento.',
  })
  async download(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentUser() currentUser: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.documentsService.download(versionId, currentUser);
    res.setHeader('X-Document-Integrity', file.integrity);
    return new StreamableFile(file.content, {
      type: file.mimeType,
      disposition: contentDisposition(file.fileName),
      length: file.content.length,
    });
  }

  @Get('versions/:versionId/integrity')
  @Roles(...DOCUMENT_READER_ROLES)
  @ApiOperation({
    summary:
      'Verifica la integridad de una versión recalculando su SHA-256 y comparándolo con el registrado',
    description:
      'Responde 200 con status VALID, ALTERED (archivo modificado) o MISSING (archivo ausente). Un trabajador o supervisor solo verifica sus propios documentos (403 en otro caso).',
  })
  @ApiOkResponse({
    description: 'Resultado de la verificación.',
    type: IntegrityCheckResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiNotFoundResponse({ description: 'Versión no encontrada.' })
  checkIntegrity(
    @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<IntegrityCheckResponse> {
    return this.documentsService.checkIntegrity(versionId, currentUser);
  }

  @Delete(':id')
  @Roles(ROLE.ADMINISTRADOR)
  @ApiOperation({
    summary:
      'Elimina un documento laboral con sus versiones, solo si venció su plazo de conservación',
    description:
      'Los documentos laborales deben conservarse 5 años (art. 9 bis del Código del Trabajo) hasta retainUntil inclusive. Antes de esa fecha la eliminación se rechaza con 409 y el documento queda intacto; la base de datos aplica la misma regla con triggers. Vencido el plazo, elimina el documento, sus versiones y sus archivos.',
  })
  @ApiOkResponse({
    description: 'Documento eliminado junto con sus versiones y archivos.',
    type: DocumentDeletionResponseDto,
  })
  @ApiBadRequestResponse({ description: 'El ID no es un UUID.' })
  @ApiNotFoundResponse({ description: 'Documento no encontrado.' })
  @ApiConflictResponse({
    description:
      'El plazo de conservación no ha vencido: el documento no se puede eliminar.',
  })
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() currentUser: AuthUser,
  ): Promise<DocumentDeletionResponse> {
    return this.documentsService.remove(id, currentUser);
  }
}
