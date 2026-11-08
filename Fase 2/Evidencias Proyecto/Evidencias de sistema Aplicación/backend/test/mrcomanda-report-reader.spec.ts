import { readFile } from 'node:fs/promises';
import { MrComandaReportError } from '../src/sales-imports/parser/mrcomanda-report.errors.js';
import { readMrComandaReport } from '../src/sales-imports/parser/read-mrcomanda-report.js';
import { MAX_REPORT_FILE_BYTES } from '../src/sales-imports/parser/xlsx-workbook.reader.js';
import {
  buildReportSheet,
  buildReportXlsx,
  FIXTURE_TOTAL,
} from './helpers/mrcomanda-report-fixture.js';

// Lectura de archivos XLSX del reporte de MrComanda (SPRINT-4R-T09): los
// fixtures son planillas ficticias generadas en memoria con la estructura del
// reporte real (no se versiona ningún archivo real). El caso de aceptación con
// el archivo real se ejecuta solo si MRCOMANDA_SAMPLE_XLSX apunta a él.

async function expectReportError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(MrComandaReportError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe('readMrComandaReport (SPRINT-4R-T09)', () => {
  it('lee un .xlsx ficticio con la estructura del reporte real', async () => {
    const report = await readMrComandaReport(await buildReportXlsx());

    expect(report.businessDate).toBe('2026-03-14');
    expect(report.externalStoreCode).toBe('901 - 12345');
    expect(report.totalAmount).toBe(FIXTURE_TOTAL);
    expect(report.lines.map((line) => line.originalLabel)).toEqual([
      'T. DEBITO',
      'EFECTIVO',
      'T. CREDITO',
      'N.de Créd.',
    ]);
    expect(report.lines.map((line) => line.amount)).toEqual([
      400_000, 150_000, 100_000, 0,
    ]);
  });

  it('el nombre del archivo no influye: solo se lee el contenido', async () => {
    // El buffer no lleva nombre; la fecha sale del «Período» aunque la
    // emisión sea de otro día.
    const report = await readMrComandaReport(
      await buildReportXlsx([
        buildReportSheet({ emitted: 'Fecha 16/03/2026 - 08:00:00' }),
      ]),
    );
    expect(report.businessDate).toBe('2026-03-14');
  });

  it('rechaza un archivo vacío', async () => {
    await expectReportError(readMrComandaReport(Buffer.alloc(0)), 'FILE_EMPTY');
  });

  it('rechaza un archivo demasiado grande sin leerlo', async () => {
    const huge = Buffer.alloc(MAX_REPORT_FILE_BYTES + 1);
    huge.set([0x50, 0x4b, 0x03, 0x04]);
    await expectReportError(readMrComandaReport(huge), 'FILE_TOO_LARGE');
  });

  it('rechaza el formato antiguo .xls con instrucciones', async () => {
    const xls = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expectReportError(readMrComandaReport(xls), 'FILE_XLS_NOT_SUPPORTED');
  });

  it('rechaza contenido que no es una planilla', async () => {
    await expectReportError(
      readMrComandaReport(Buffer.from('Fecha;Monto\n05/11/2026;1000\n')),
      'FILE_NOT_XLSX',
    );
  });

  it('rechaza un .xlsx dañado', async () => {
    const valid = await buildReportXlsx();
    const truncated = valid.subarray(0, Math.floor(valid.length / 2));
    await expectReportError(readMrComandaReport(truncated), 'FILE_CORRUPT');
  });

  it('rechaza un ZIP que no es una planilla', async () => {
    // Un ZIP mínimo vacío (solo el registro de fin de directorio) precedido
    // de la firma local: no contiene libro de Excel.
    const zip = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(26),
      Buffer.from([0x50, 0x4b, 0x05, 0x06]),
      Buffer.alloc(18),
    ]);
    await expectReportError(readMrComandaReport(zip), 'FILE_CORRUPT');
  });

  it('propaga los errores de estructura del parser', async () => {
    await expectReportError(
      readMrComandaReport(
        await buildReportXlsx([buildReportSheet({ paymentsTotal: 1 })]),
      ),
      'TOTAL_MISMATCH',
    );
  });
});

// Prueba de aceptación manual con el archivo real entregado por el PO. No se
// versiona: se ejecuta con
//   MRCOMANDA_SAMPLE_XLSX=/ruta/ventas-06-11-2026.xlsx npx vitest run test/mrcomanda-report-reader.spec.ts
const samplePath = process.env.MRCOMANDA_SAMPLE_XLSX;

describe.skipIf(!samplePath)(
  'Aceptación con el reporte real de MrComanda (SPRINT-4R-T09)',
  () => {
    it('usa el 05/11/2026 del período aunque el archivo se llame 06/11 y obtiene cuatro líneas por $873.260', async () => {
      const report = await readMrComandaReport(
        await readFile(samplePath ?? ''),
      );

      expect(report.businessDate).toBe('2026-11-05');
      expect(report.periodStart.toISOString()).toBe('2026-11-05T03:00:00.000Z');
      expect(report.periodEnd.toISOString()).toBe('2026-11-06T02:59:59.000Z');
      expect(report.externalStoreCode).toBe('208 - 72597');
      // Emitido el 06/11/2026 a las 11:14:55 (hora de Chile, UTC-3).
      expect(report.issuedAt?.toISOString()).toBe('2026-11-06T14:14:55.000Z');
      expect(report.totalAmount).toBe(873_260);
      expect(report.lines.map((line) => line.originalLabel)).toEqual([
        'T. DEBITO',
        'EFECTIVO',
        'T. CREDITO',
        'N.de Créd.',
      ]);
      expect(report.lines.reduce((total, line) => total + line.amount, 0)).toBe(
        873_260,
      );
    });
  },
);
