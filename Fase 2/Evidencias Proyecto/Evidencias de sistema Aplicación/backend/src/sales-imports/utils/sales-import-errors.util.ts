import { HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import type {
  MrComandaReportError,
  MrComandaReportErrorCode,
} from '../parser/mrcomanda-report.errors.js';

// Traducción de errores de la importación de ventas a HTTP (SPRINT-4R-T10).

// Estado HTTP de cada problema del archivo: vacío (400), demasiado grande
// (413), formato que no es .xlsx (415) y cualquier otro problema de contenido
// o estructura de un .xlsx (422).
const STATUS_BY_CODE: Partial<Record<MrComandaReportErrorCode, HttpStatus>> = {
  FILE_EMPTY: HttpStatus.BAD_REQUEST,
  FILE_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  FILE_XLS_NOT_SUPPORTED: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
  FILE_NOT_XLSX: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
};

const ERROR_NAME: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'Payload Too Large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'Unsupported Media Type',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
};

// El cuerpo solo trae el código, la fila y el mensaje del parser: nunca el
// contenido del archivo ni datos de otras filas.
export function reportErrorToHttp(error: MrComandaReportError): HttpException {
  const status = STATUS_BY_CODE[error.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
  return new HttpException(
    {
      statusCode: status,
      error: ERROR_NAME[status] ?? 'Unprocessable Entity',
      message: error.message,
      code: error.code,
      row: error.row,
    },
    status,
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// Mensaje de un rechazo de trigger o CHECK de PostgreSQL (el adaptador de
// Prisma lo entrega como P2039 con el error original en meta).
export function databaseRuleViolation(error: unknown): string | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2039'
  ) {
    return null;
  }
  const meta = error.meta as
    | {
        driverAdapterError?: {
          cause?: { originalMessage?: unknown };
        };
      }
    | undefined;
  const message = meta?.driverAdapterError?.cause?.originalMessage;
  return typeof message === 'string' ? message : null;
}
