import { HttpStatus } from '@nestjs/common';
import {
  MrComandaReportError,
  type MrComandaReportErrorCode,
} from '../parser/mrcomanda-report.errors.js';
import { reportErrorToHttp } from './sales-import-errors.util.js';

// Traducción de los errores del archivo a HTTP (SPRINT-4R-T10).
describe('reportErrorToHttp (SPRINT-4R-T10)', () => {
  it.each<[MrComandaReportErrorCode, HttpStatus]>([
    ['FILE_EMPTY', HttpStatus.BAD_REQUEST],
    ['FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE],
    ['FILE_XLS_NOT_SUPPORTED', HttpStatus.UNSUPPORTED_MEDIA_TYPE],
    ['FILE_NOT_XLSX', HttpStatus.UNSUPPORTED_MEDIA_TYPE],
    ['FILE_CORRUPT', HttpStatus.UNPROCESSABLE_ENTITY],
    ['PERIOD_MULTIPLE_DAYS', HttpStatus.UNPROCESSABLE_ENTITY],
    ['TOTAL_MISMATCH', HttpStatus.UNPROCESSABLE_ENTITY],
  ])('%s responde %i', (code, status) => {
    const exception = reportErrorToHttp(
      new MrComandaReportError(code, 'Mensaje accionable', 6),
    );
    expect(exception.getStatus()).toBe(status);
  });

  it('el cuerpo solo trae el código, la fila y el mensaje', () => {
    const exception = reportErrorToHttp(
      new MrComandaReportError(
        'PERIOD_MULTIPLE_DAYS',
        'El reporte cubre del 05/11/2026 al 06/11/2026.',
        6,
      ),
    );
    expect(exception.getResponse()).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'El reporte cubre del 05/11/2026 al 06/11/2026.',
      code: 'PERIOD_MULTIPLE_DAYS',
      row: 6,
    });
  });
});
