import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasCompleteStructure } from '../storage/utils/file-structure.util.js';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_VOUCHER_BYTES,
  MAX_VOUCHER_SIZE_MB,
  type VoucherMimeType,
} from './types/daily-operations.types.js';
import {
  detectVoucherMimeType,
  VOUCHER_EXTENSION_BY_MIME_TYPE,
} from './utils/voucher-signature.util.js';

export interface StoredVoucher {
  // Ruta relativa a la raíz de almacenamiento, siempre con "/"
  // (ej. vouchers/2026/11/<uuid>.jpg).
  relativePath: string;
  mimeType: VoucherMimeType;
  sizeBytes: number;
  // Hash SHA-256 en hexadecimal (64 caracteres).
  sha256Hash: string;
}

// Almacenamiento privado de los vouchers fotográficos de las operaciones
// diarias (SPRINT-4R-T01). Comparte el volumen del gestor documental
// (DOCUMENTS_STORAGE_PATH) en la subcarpeta vouchers/, que no se expone de
// forma pública: el archivo solo se entrega por GET
// /daily-operations/:id/voucher con autorización. Valida el tamaño (máximo
// 5 MiB) y el tipo real por firma de bytes (JPEG, PNG o WebP), calcula el
// SHA-256 y guarda con un nombre físico aleatorio que no expone datos del
// local ni del responsable (Ley N°21.719). No toca la base de datos: quien
// lo usa registra los metadatos en daily_operation_vouchers.
@Injectable()
export class DailyVoucherStorageService {
  private readonly rootPath: string;

  constructor(config: ConfigService) {
    // Mismo volumen que el gestor documental: las fotos de vouchers son
    // respaldo operativo privado y se respaldan con los documentos.
    const storagePath = config.getOrThrow<string>('DOCUMENTS_STORAGE_PATH');
    if (String(storagePath).trim() === '') {
      throw new Error('DOCUMENTS_STORAGE_PATH no puede estar vacía');
    }
    this.rootPath = path.resolve(storagePath);
  }

  // Valida y guarda el contenido del voucher. declaredMimeType es el tipo
  // que informó el cliente; si viene, debe coincidir con el tipo real
  // detectado (los JPEG se normalizan desde "image/jpg").
  async save(
    content: Buffer,
    declaredMimeType?: string,
  ): Promise<StoredVoucher> {
    if (content.length === 0) {
      throw new BadRequestException('El voucher está vacío');
    }
    if (content.length > MAX_VOUCHER_BYTES) {
      throw new PayloadTooLargeException(
        `El voucher supera el tamaño máximo de ${MAX_VOUCHER_SIZE_MB} MiB`,
      );
    }

    const mimeType = detectVoucherMimeType(content);
    if (!mimeType) {
      throw new UnsupportedMediaTypeException(
        'El voucher debe ser una imagen JPEG, PNG o WebP',
      );
    }
    if (
      declaredMimeType !== undefined &&
      normalizeMimeType(declaredMimeType) !== mimeType
    ) {
      throw new UnsupportedMediaTypeException(
        'El tipo declarado del voucher no coincide con su contenido',
      );
    }
    // Imagen del tipo correcto pero cortada o dañada (SPRINT-4R-T18).
    if (!hasCompleteStructure(content, mimeType)) {
      throw new UnprocessableEntityException(
        'La foto del voucher está dañada o incompleta; vuelve a tomarla y súbela de nuevo',
      );
    }

    // Nombre físico vouchers/AAAA/MM/<uuid>.<ext> (fecha en UTC): sin nombre
    // original ni datos del local o del responsable.
    const now = new Date();
    const relativePath = path.posix.join(
      'vouchers',
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.${VOUCHER_EXTENSION_BY_MIME_TYPE[mimeType]}`,
    );
    const finalPath = this.resolveSafePath(relativePath);
    const tempPath = `${finalPath}.tmp`;

    // Escritura atómica: se escribe un temporal y se renombra, así nunca
    // queda un archivo final a medio escribir. Si algo falla, se borra el
    // temporal. Permisos solo para el dueño; en Windows no aplican.
    await fs.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(tempPath, content, { flag: 'wx', mode: 0o600 });
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

  // Lee un voucher guardado a partir de su ruta relativa.
  async read(relativePath: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(relativePath);
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      // EISDIR/ENOTDIR: la ruta es una carpeta o pasa por un archivo.
      if (
        isErrnoException(error) &&
        (error.code === 'ENOENT' ||
          error.code === 'EISDIR' ||
          error.code === 'ENOTDIR')
      ) {
        throw new NotFoundException('Voucher no encontrado');
      }
      throw error;
    }
  }

  // Elimina un voucher guardado (limpieza tras un fallo de persistencia).
  // Un archivo que ya no existe no es un error: no queda nada que eliminar.
  async remove(relativePath: string): Promise<void> {
    const filePath = this.resolveSafePath(relativePath);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return;
      throw error;
    }
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
      throw new BadRequestException('Ruta de voucher no válida');
    }
    const resolved = path.resolve(this.rootPath, relativePath);
    const fromRoot = path.relative(this.rootPath, resolved);
    if (
      fromRoot === '' ||
      fromRoot === '..' ||
      fromRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(fromRoot)
    ) {
      throw new BadRequestException('Ruta de voucher no válida');
    }
    return resolved;
  }
}

// Algunos clientes declaran los JPEG como "image/jpg" (no estándar).
function normalizeMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
