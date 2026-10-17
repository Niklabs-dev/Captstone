import {
  Body,
  Controller,
  Post,
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
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { ROLE } from '../auth/constants/roles.constants.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { DocumentsService } from './documents.service.js';
import { DocumentResponseDto } from './dto/document-response.dto.js';
import {
  UploadDocumentDto,
  UploadDocumentFormDto,
} from './dto/upload-document.dto.js';
import type {
  DocumentResponse,
  UploadedDocumentFile,
} from './types/documents.types.js';

// Gestor documental (SPRINT-2-T05): carga de documentos laborales por
// trabajador. Solo el dueño/administrador.
@ApiTags('documents')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token ausente, inválido o expirado.' })
@Roles(ROLE.ADMINISTRADOR)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
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
}
