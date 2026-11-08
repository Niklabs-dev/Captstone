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
import {
  MAX_VOUCHER_BYTES,
  MAX_VOUCHER_SIZE_MB,
} from './types/daily-operations.types.js';
import { DailyVoucherStorageService } from './daily-voucher-storage.service.js';

// Imágenes mínimas completas: firma + marca de cierre de cada formato
// (el chequeo estructural de SPRINT-4R-T18 rechaza las truncadas).
// JPEG: inicio, APP0 «JFIF» con su largo real, SOS, datos y fin.
const JPEG = Buffer.concat([
  Buffer.from(
    'ffd8ffe000104a46494600010100000100010000ffda0008010100003f00',
    'hex',
  ),
  Buffer.from('datos'),
  Buffer.from('ffd9', 'hex'),
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
// WebP: "RIFF" + tamaño del chunk (4 bytes, aquí 8: el resto del archivo)
// + "WEBP" + resto.
const WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20,
]);
const PDF = Buffer.from('%PDF-1.7\ncontenido\n%%EOF');

const PATH_PATTERN =
  /^vouchers\/\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// Almacenamiento privado de vouchers (SPRINT-4R-T01): valida tamaño (máximo
// 5 MiB) y tipo real por firma (JPEG, PNG o WebP), guarda con nombre físico
// aleatorio bajo vouchers/ y calcula el SHA-256.
describe('DailyVoucherStorageService (SPRINT-4R-T01)', () => {
  let rootPath: string;
  let service: DailyVoucherStorageService;

  function createService(): DailyVoucherStorageService {
    return new DailyVoucherStorageService(
      new ConfigService({ DOCUMENTS_STORAGE_PATH: rootPath }),
    );
  }

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-vouchers-'));
    service = createService();
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it('guarda un JPEG y el hash coincide con el calculado por crypto', async () => {
    const stored = await service.save(JPEG, 'image/jpeg');

    expect(stored.mimeType).toBe('image/jpeg');
    expect(stored.sizeBytes).toBe(JPEG.length);
    expect(stored.sha256Hash).toBe(sha256(JPEG));
    expect(stored.relativePath).toMatch(PATH_PATTERN);
    expect(stored.relativePath).toMatch(/\.jpg$/);

    const onDisk = await fs.readFile(path.join(rootPath, stored.relativePath));
    expect(onDisk.equals(JPEG)).toBe(true);
    expect(await service.read(stored.relativePath)).toEqual(JPEG);
  });

  it('acepta PNG y WebP con su extensión', async () => {
    const png = await service.save(PNG, 'image/png');
    const webp = await service.save(WEBP, 'image/webp');

    expect(png.mimeType).toBe('image/png');
    expect(png.relativePath).toMatch(/\.png$/);
    expect(webp.mimeType).toBe('image/webp');
    expect(webp.relativePath).toMatch(/\.webp$/);
  });

  it('acepta un JPEG declarado como image/jpg', async () => {
    const stored = await service.save(JPEG, 'image/jpg');
    expect(stored.mimeType).toBe('image/jpeg');
  });

  it('funciona sin tipo declarado (solo valida el contenido)', async () => {
    const stored = await service.save(PNG);
    expect(stored.mimeType).toBe('image/png');
  });

  it('rechaza el contenido vacío', async () => {
    await expect(service.save(Buffer.alloc(0))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it(`rechaza un voucher mayor a ${MAX_VOUCHER_SIZE_MB} MiB`, async () => {
    const big = Buffer.alloc(MAX_VOUCHER_BYTES + 1, 0x00);
    await expect(service.save(big, 'image/png')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('acepta un voucher exactamente en el límite', async () => {
    // Firma PNG al inicio y relleno hasta el tamaño máximo permitido.
    const atLimit = Buffer.concat([
      PNG,
      Buffer.alloc(MAX_VOUCHER_BYTES - PNG.length, 0x00),
    ]);
    const stored = await service.save(atLimit, 'image/png');
    expect(stored.sizeBytes).toBe(MAX_VOUCHER_BYTES);
  });

  it('rechaza un PDF aunque venga declarado como imagen', async () => {
    await expect(service.save(PDF, 'image/png')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('rechaza cuando el tipo declarado no coincide con el contenido', async () => {
    await expect(service.save(JPEG, 'image/png')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('lee un voucher guardado y elimina con remove', async () => {
    const stored = await service.save(WEBP, 'image/webp');
    expect(await service.read(stored.relativePath)).toEqual(WEBP);

    await service.remove(stored.relativePath);
    await expect(service.read(stored.relativePath)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // Eliminar dos veces no es error: ya no queda nada que borrar.
    await expect(service.remove(stored.relativePath)).resolves.toBeUndefined();
  });

  it('rechaza rutas que salen de la carpeta de almacenamiento', async () => {
    await expect(service.read('../fuera.txt')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.read('/etc/passwd')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exige DOCUMENTS_STORAGE_PATH definida y no vacía', () => {
    expect(() => createServiceWith({})).toThrow();
    expect(() =>
      createServiceWith({ DOCUMENTS_STORAGE_PATH: '   ' }),
    ).toThrow();
  });

  function createServiceWith(
    env: Record<string, string>,
  ): DailyVoucherStorageService {
    return new DailyVoucherStorageService(new ConfigService(env));
  }
});
