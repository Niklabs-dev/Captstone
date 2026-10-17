import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MulterModule,
  type MulterModuleOptions,
} from '@nestjs/platform-express';
import { StorageModule } from '../storage/storage.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { maxUploadBytes } from './utils/upload-limits.util.js';

// Gestor documental (SPRINT-2-T05 carga, SPRINT-2-T06 consulta y descarga).
@Module({
  imports: [
    StorageModule,
    // Sin storage ni dest, Multer deja el archivo en memoria (file.buffer).
    // Límite igual a DOCUMENTS_MAX_SIZE_MB: corta la subida antes de cargar en
    // memoria un archivo demasiado grande (responde 413).
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): MulterModuleOptions => ({
        limits: {
          fileSize: maxUploadBytes(config.get<string>('DOCUMENTS_MAX_SIZE_MB')),
          files: 1,
        },
        // Nombres de archivo con tildes o ñ (ej. contrato-Pérez.pdf).
        defParamCharset: 'utf8',
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
