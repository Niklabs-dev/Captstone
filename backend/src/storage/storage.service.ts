import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ALLOWED_MIME_TYPES,
  BYTES_PER_MB,
  DEFAULT_MAX_SIZE_MB,
  EXTENSION_BY_MIME_TYPE,
  type StoredFile,
} from './types/storage.types.js';
import { detectMimeType } from './utils/file-signature.util.js';

// Almacenamiento de archivos del gestor documental (SPRINT-2-T04).
// Guarda en DOCUMENTS_STORAGE_PATH con un nombre físico aleatorio que no expone
// datos personales (Ley N°21.719), calcula el SHA-256 y valida tipo y tamaño.
// No toca la base de datos: quien lo usa registra el resultado en DocumentVersion.
@Injectable()
export class StorageService {
  private readonly rootPath: string;
  private readonly maxSizeMb: number;

  constructor(config: ConfigService) {
    this.rootPath = path.resolve(
      config.getOrThrow<string>('DOCUMENTS_STORAGE_PATH'),
    );
    this.maxSizeMb = parseMaxSizeMb(
      config.get<string>('DOCUMENTS_MAX_SIZE_MB'),
    );
  }

  // Valida y guarda el contenido. declaredMimeType es el tipo que informó el
  // cliente; si viene, debe coincidir con el tipo real detectado.
  async save(content: Buffer, declaredMimeType?: string): Promise<StoredFile> {
    if (content.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    if (content.length > this.maxSizeMb * BYTES_PER_MB) {
      throw new PayloadTooLargeException(
        `El archivo supera el tamaño máximo de ${this.maxSizeMb} MB`,
      );
    }

    const mimeType = detectMimeType(content);
    if (!mimeType) {
      throw new UnsupportedMediaTypeException(
        `Tipo de archivo no permitido; se aceptan: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }
    if (
      declaredMimeType !== undefined &&
      declaredMimeType.trim().toLowerCase() !== mimeType
    ) {
      throw new UnsupportedMediaTypeException(
        'El tipo declarado no coincide con el contenido del archivo',
      );
    }

    // Nombre físico AAAA/MM/<uuid>.<ext> (fecha en UTC): sin nombre original
    // ni datos del trabajador.
    const now = new Date();
    const relativePath = path.posix.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${EXTENSION_BY_MIME_TYPE[mimeType]}`,
    );
    const finalPath = this.resolveSafePath(relativePath);
    const tempPath = `${finalPath}.tmp`;

    // Escritura atómica: se escribe un temporal y se renombra, así nunca queda
    // un archivo final a medio escribir. Si algo falla, se borra el temporal.
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    try {
      await fs.writeFile(tempPath, content, { flag: 'wx' });
      await fs.rename(tempPath, finalPath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }

    return {
      relativePath,
      mimeType,
      sizeBytes: content.length,
      sha256Hash: this.computeSha256(content),
    };
  }

  // Hash SHA-256 en hexadecimal (64 caracteres), como sha256_hash en la BD.
  computeSha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  // Lee un archivo guardado a partir de su ruta relativa.
  async read(relativePath: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(relativePath);
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') {
        throw new NotFoundException('Archivo no encontrado');
      }
      throw error;
    }
  }

  // Recalcula el hash del archivo guardado; false significa que fue alterado.
  async verifyIntegrity(
    relativePath: string,
    expectedSha256: string,
  ): Promise<boolean> {
    const content = await this.read(relativePath);
    return this.computeSha256(content) === expectedSha256.toLowerCase();
  }

  // Convierte la ruta relativa en absoluta, rechazando rutas absolutas o que
  // salgan de la carpeta de almacenamiento (ej. "../").
  private resolveSafePath(relativePath: string): string {
    if (
      relativePath.length === 0 ||
      relativePath.includes('\0') ||
      path.isAbsolute(relativePath) ||
      path.win32.isAbsolute(relativePath)
    ) {
      throw new BadRequestException('Ruta de archivo no válida');
    }
    const resolved = path.resolve(this.rootPath, relativePath);
    const fromRoot = path.relative(this.rootPath, resolved);
    if (
      fromRoot === '' ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromRoot)
    ) {
      throw new BadRequestException('Ruta de archivo no válida');
    }
    return resolved;
  }
}

// DOCUMENTS_MAX_SIZE_MB es opcional; si viene, debe ser un entero positivo.
function parseMaxSizeMb(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_MAX_SIZE_MB;
  if (!/^[1-9]\d*$/.test(String(value).trim())) {
    throw new Error(
      `DOCUMENTS_MAX_SIZE_MB debe ser un entero positivo (valor recibido: "${value}")`,
    );
  }
  return Number(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
