import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Tipo MIME estándar de un libro .xlsx.
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface StoredSalesImportFile {
  // Ruta relativa a la raíz de almacenamiento, siempre con "/"
  // (ej. sales-imports/2026/11/<uuid>.xlsx).
  relativePath: string;
  sizeBytes: number;
  // Hash SHA-256 en hexadecimal (64 caracteres).
  sha256Hash: string;
}

// Almacenamiento privado de los Excel diarios de MrComanda (SPRINT-4R-T10).
// Comparte el volumen del gestor documental (DOCUMENTS_STORAGE_PATH) en la
// subcarpeta sales-imports/, que no se expone de forma pública: el archivo
// solo se entrega por GET /sales-imports/:id/file con autorización. Guarda con
// un nombre físico aleatorio (sin nombre original ni datos del local) y con
// escritura atómica. No valida el contenido: el servicio de importación ya lo
// leyó con el parser antes de guardarlo. No toca la base de datos.
@Injectable()
export class SalesImportStorageService {
  private readonly rootPath: string;

  constructor(config: ConfigService) {
    const storagePath = config.getOrThrow<string>('DOCUMENTS_STORAGE_PATH');
    if (String(storagePath).trim() === '') {
      throw new Error('DOCUMENTS_STORAGE_PATH no puede estar vacía');
    }
    this.rootPath = path.resolve(storagePath);
  }

  async save(content: Buffer): Promise<StoredSalesImportFile> {
    if (content.length === 0) {
      throw new BadRequestException('El archivo está vacío');
    }
    // Nombre físico sales-imports/AAAA/MM/<uuid>.xlsx (fecha en UTC).
    const now = new Date();
    const relativePath = path.posix.join(
      'sales-imports',
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      `${randomUUID()}.xlsx`,
    );
    const finalPath = this.resolveSafePath(relativePath);
    const tempPath = `${finalPath}.tmp`;

    // Escritura atómica: temporal y renombre; si algo falla se borra el
    // temporal. Permisos solo para el dueño (en Windows no aplican).
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
      sizeBytes: content.length,
      sha256Hash: this.computeSha256(content),
    };
  }

  // Hash SHA-256 en hexadecimal (64 caracteres), como sha256_hash en la BD.
  computeSha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  async read(relativePath: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(relativePath);
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      if (
        isErrnoException(error) &&
        (error.code === 'ENOENT' ||
          error.code === 'EISDIR' ||
          error.code === 'ENOTDIR')
      ) {
        throw new NotFoundException('Archivo de importación no encontrado');
      }
      throw error;
    }
  }

  // Elimina un archivo guardado (descarte o limpieza tras un fallo). Un
  // archivo que ya no existe no es un error.
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
