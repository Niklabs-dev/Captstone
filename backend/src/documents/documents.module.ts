import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MulterModule,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { StorageModule } from '../storage/storage.module.js';
import {
  BYTES_PER_MB,
  DEFAULT_MAX_SIZE_MB,
  MAX_ALLOWED_SIZE_MB,
} from '../storage/types/storage.types.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

// Límite de Multer igual a DOCUMENTS_MAX_SIZE_MB: corta la subida antes de
// cargar en memoria un archivo demasiado grande (responde 413). Un valor
// inválido ya lo rechaza StorageService al iniciar la aplicación.
function maxUploadBytes(config: ConfigService): number {
  const sizeMb = Number(config.get<string>('DOCUMENTS_MAX_SIZE_MB'));
  const valid =
    Number.isSafeInteger(sizeMb) &&
    sizeMb >= 1 &&
    sizeMb <= MAX_ALLOWED_SIZE_MB;
  return (valid ? sizeMb : DEFAULT_MAX_SIZE_MB) * BYTES_PER_MB;
}

// Gestor documental (SPRINT-2-T05).
@Module({
  imports: [
    StorageModule,
    // Sin storage ni dest, Multer deja el archivo en memoria (file.buffer).
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): MulterModuleOptions => ({
        limits: { fileSize: maxUploadBytes(config), files: 1 },
        // Nombres de archivo con tildes o ñ (ej. contrato-Pérez.pdf).
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
