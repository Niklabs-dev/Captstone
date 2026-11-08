import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SalesImportStorageService } from './sales-import-storage.service.js';

const CONTENT = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const PATH_PATTERN =
  /^sales-imports\/\d{4}\/(0[1-9]|1[0-2])\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.xlsx$/;

// Almacenamiento privado de los Excel de MrComanda (SPRINT-4R-T10).
describe('SalesImportStorageService (SPRINT-4R-T10)', () => {
  let rootPath: string;
  let service: SalesImportStorageService;

  beforeEach(async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'moifood-imports-'));
    service = new SalesImportStorageService(
      new ConfigService({ DOCUMENTS_STORAGE_PATH: rootPath }),
    );
  });

  afterEach(async () => {
    await fs.rm(rootPath, { recursive: true, force: true });
  });

  it('guarda con nombre aleatorio bajo sales-imports/ y calcula el SHA-256', async () => {
    const stored = await service.save(CONTENT);

    expect(stored.relativePath).toMatch(PATH_PATTERN);
    expect(stored.sizeBytes).toBe(CONTENT.length);
    expect(stored.sha256Hash).toBe(
      createHash('sha256').update(CONTENT).digest('hex'),
    );
    expect(await service.read(stored.relativePath)).toEqual(CONTENT);
    // No quedan temporales.
    const dir = path.dirname(path.join(rootPath, stored.relativePath));
    expect((await fs.readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(
      false,
    );
  });

  it('dos cargas del mismo contenido usan rutas distintas', async () => {
    const first = await service.save(CONTENT);
    const second = await service.save(CONTENT);
    expect(first.relativePath).not.toBe(second.relativePath);
    expect(first.sha256Hash).toBe(second.sha256Hash);
  });

  it('rechaza un archivo vacío', async () => {
    await expect(service.save(Buffer.alloc(0))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('elimina un archivo y tolera que ya no exista', async () => {
    const stored = await service.save(CONTENT);
    await service.remove(stored.relativePath);
    await service.remove(stored.relativePath);
    await expect(service.read(stored.relativePath)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rechaza rutas absolutas o que salen de la carpeta privada', async () => {
    for (const unsafe of [
      '../fuera.xlsx',
      'sales-imports/../../fuera.xlsx',
      path.join(rootPath, 'absoluta.xlsx'),
      'C:\\Windows\\win.ini',
      '',
    ]) {
      await expect(service.read(unsafe)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('exige DOCUMENTS_STORAGE_PATH no vacía', () => {
    expect(
      () =>
        new SalesImportStorageService(
          new ConfigService({ DOCUMENTS_STORAGE_PATH: '  ' }),
        ),
    ).toThrow(/no puede estar vacía/);
  });
});
