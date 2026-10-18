import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StorageService } from './storage.service.js';

const PDF = Buffer.from('%PDF-1.7\ncontenido de prueba\n%%EOF');
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const EXE = Buffer.from('MZ\x90\x00ejecutable');

const PATH_PATTERN =
  /^\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/;

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// Lista todos los archivos bajo una carpeta, en cualquier subnivel.
async function listFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

describe('StorageService (SPRINT-2-T04)', () => {
  let rootPath: string;
  let service: StorageService;

  function createService(env: Record<string, string> = {}): StorageService {
    return new StorageService(
      new ConfigService({ DOCUMENTS_STORAGE_PATH: rootPath, ...env }),
    );
  }

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-storage-'));
    service = createService();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it('guarda un PDF y el hash coincide con el calculado por crypto', async () => {
    const stored = await service.save(PDF, 'application/pdf');

    expect(stored.mimeType).toBe('application/pdf');
    expect(stored.sizeBytes).toBe(PDF.length);
    expect(stored.sha256Hash).toBe(sha256(PDF));
    expect(stored.sha256Hash).toMatch(/^[0-9a-f]{64}$/);

    const onDisk = await fs.readFile(path.join(rootPath, stored.relativePath));
    expect(onDisk.equals(PDF)).toBe(true);
    expect(await service.read(stored.relativePath)).toEqual(PDF);
  });

  it('acepta PNG y JPEG con su extensión', async () => {
    const png = await service.save(PNG, 'image/png');
    const jpeg = await service.save(JPEG, 'image/jpeg');

    expect(png.mimeType).toBe('image/png');
    expect(png.relativePath).toMatch(/\.png$/);
    expect(jpeg.mimeType).toBe('image/jpeg');
    expect(jpeg.relativePath).toMatch(/\.jpg$/);
  });

  it('acepta un JPEG declarado como image/jpg', async () => {
    const jpeg = await service.save(JPEG, 'image/jpg');

    expect(jpeg.mimeType).toBe('image/jpeg');
    expect(jpeg.relativePath).toMatch(/\.jpg$/);
  });

  it('genera un nombre aleatorio AAAA/MM/uuid.ext sin datos del archivo original', async () => {
    const first = await service.save(PDF);
    const second = await service.save(PDF);

    expect(first.relativePath).toMatch(PATH_PATTERN);
    expect(second.relativePath).toMatch(PATH_PATTERN);
    expect(first.relativePath).not.toBe(second.relativePath);
    // No quedan temporales tras una escritura correcta.
    const files = await listFiles(rootPath);
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('rechaza un archivo vacío', async () => {
    await expect(service.save(Buffer.alloc(0))).rejects.toThrow(
      new BadRequestException('El archivo está vacío'),
    );
  });

  it('rechaza un archivo mayor al máximo configurado con 413', async () => {
    const limited = createService({ DOCUMENTS_MAX_SIZE_MB: '1' });
    const tooBig = Buffer.concat([PDF, Buffer.alloc(1024 * 1024)]);

    await expect(limited.save(tooBig)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    await expect(limited.save(tooBig)).rejects.toThrow(/1 MB/);
    // Justo en el límite sí se acepta.
    const exact = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 - PDF.length)]);
    await expect(limited.save(exact)).resolves.toMatchObject({
      sizeBytes: 1024 * 1024,
    });
  });

  it('rechaza un .exe aunque se declare como PDF', async () => {
    await expect(service.save(EXE, 'application/pdf')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(await listFiles(rootPath)).toHaveLength(0);
  });

  it('rechaza cuando el tipo declarado no coincide con el real', async () => {
    await expect(service.save(PNG, 'application/pdf')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    await expect(service.save(PDF, 'text/plain')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('verifyIntegrity devuelve true y luego false tras alterar el archivo', async () => {
    const stored = await service.save(PDF);

    expect(
      await service.verifyIntegrity(stored.relativePath, stored.sha256Hash),
    ).toBe(true);

    await fs.writeFile(
      path.join(rootPath, stored.relativePath),
      Buffer.concat([PDF, Buffer.from('alterado')]),
    );
    expect(
      await service.verifyIntegrity(stored.relativePath, stored.sha256Hash),
    ).toBe(false);
  });

  it('read lanza 404 si el archivo no existe', async () => {
    await expect(
      service.read('2026/10/00000000-0000-4000-8000-000000000000.pdf'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('read lanza 404 si la ruta es una carpeta', async () => {
    await fs.mkdir(path.join(rootPath, '2026'));

    await expect(service.read('2026')).rejects.toThrow(
      new NotFoundException('Archivo no encontrado'),
    );
  });

  it('rechaza rutas que salen de la carpeta o son absolutas', async () => {
    const invalid = new BadRequestException('Ruta de archivo no válida');
    const outside = path.join(rootPath, '..', 'fuera.pdf');

    await expect(service.read('../fuera.pdf')).rejects.toThrow(invalid);
    await expect(service.read('2026/../../fuera.pdf')).rejects.toThrow(invalid);
    await expect(service.read(outside)).rejects.toThrow(invalid);
    await expect(service.read('/etc/passwd')).rejects.toThrow(invalid);
    await expect(service.read('C:\\Windows\\win.ini')).rejects.toThrow(invalid);
    await expect(service.verifyIntegrity('../x.pdf', 'a')).rejects.toThrow(
      invalid,
    );
  });

  it('remove elimina el archivo y no falla si ya no existe (SPRINT-2-T07)', async () => {
    const stored = await service.save(PDF);

    await service.remove(stored.relativePath);
    expect(await listFiles(rootPath)).toHaveLength(0);
    await expect(service.read(stored.relativePath)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.remove(stored.relativePath)).resolves.toBeUndefined();
    await expect(service.remove('../fuera.pdf')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('borra el temporal si falla la escritura atómica', async () => {
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disco lleno'));

    await expect(service.save(PDF)).rejects.toThrow('disco lleno');
    expect(await listFiles(rootPath)).toHaveLength(0);
  });

  it('valida DOCUMENTS_STORAGE_PATH y DOCUMENTS_MAX_SIZE_MB al iniciar', () => {
    expect(() => new StorageService(new ConfigService())).toThrow();
    expect(() => createService({ DOCUMENTS_STORAGE_PATH: '' })).toThrow(
      'DOCUMENTS_STORAGE_PATH no puede estar vacía',
    );
    expect(() => createService({ DOCUMENTS_STORAGE_PATH: '   ' })).toThrow(
      'DOCUMENTS_STORAGE_PATH no puede estar vacía',
    );
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '0' })).toThrow(
      /DOCUMENTS_MAX_SIZE_MB/,
    );
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '-5' })).toThrow();
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '2.5' })).toThrow();
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: 'abc' })).toThrow();
    expect(() =>
      createService({ DOCUMENTS_MAX_SIZE_MB: '99999999999999999999' }),
    ).toThrow(/DOCUMENTS_MAX_SIZE_MB/);
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '101' })).toThrow(
      /DOCUMENTS_MAX_SIZE_MB/,
    );
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '25' })).not.toThrow();
    expect(() => createService({ DOCUMENTS_MAX_SIZE_MB: '100' })).not.toThrow();
  });
});
