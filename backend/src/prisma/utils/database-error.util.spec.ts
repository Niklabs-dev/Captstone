import { Prisma } from '../../generated/prisma/client.js';
import {
  isTransactionConflict,
  sqlStateOf,
  triggerErrorInfo,
} from './database-error.util.js';

// Lectura de los errores de PostgreSQL que entrega Prisma (SPRINT-5-T06,
// extraída de daily-operations.service).

function prismaError(
  code: string,
  cause?: { originalCode?: unknown; originalMessage?: unknown },
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('error de prueba', {
    code,
    clientVersion: 'test',
    meta: cause === undefined ? undefined : { driverAdapterError: { cause } },
  });
}

const FINALIZED =
  'La toma de inventario 9c8b7a6f está finalizada: no se permite INSERT sobre sus líneas';

describe('sqlStateOf', () => {
  it('lee el SQLSTATE original del driver', () => {
    expect(sqlStateOf(prismaError('P2039', { originalCode: '42501' }))).toBe(
      '42501',
    );
    expect(sqlStateOf(prismaError('P2034', { originalCode: '40P01' }))).toBe(
      '40P01',
    );
  });

  it('devuelve null sin código o si no es un error conocido de Prisma', () => {
    expect(sqlStateOf(prismaError('P2002'))).toBeNull();
    expect(sqlStateOf(prismaError('P2039', { originalCode: 42501 }))).toBe(
      null,
    );
    expect(sqlStateOf(new Error('42501'))).toBeNull();
    expect(sqlStateOf(null)).toBeNull();
  });
});

describe('triggerErrorInfo', () => {
  it('devuelve el SQLSTATE y el mensaje del RAISE de un trigger (P2039)', () => {
    expect(
      triggerErrorInfo(
        prismaError('P2039', {
          originalCode: '42501',
          originalMessage: FINALIZED,
        }),
      ),
    ).toEqual({ code: '42501', message: FINALIZED });
  });

  it('ignora otros códigos de Prisma y los datos incompletos', () => {
    expect(
      triggerErrorInfo(
        prismaError('P2034', {
          originalCode: '40P01',
          originalMessage: 'deadlock detected',
        }),
      ),
    ).toBeNull();
    expect(
      triggerErrorInfo(prismaError('P2039', { originalCode: '42501' })),
    ).toBeNull();
    expect(triggerErrorInfo(prismaError('P2039'))).toBeNull();
    expect(triggerErrorInfo(new Error(FINALIZED))).toBeNull();
  });
});

describe('isTransactionConflict', () => {
  it('reconoce P2034, deadlock (40P01) y conflicto de serialización (40001)', () => {
    expect(isTransactionConflict(prismaError('P2034'))).toBe(true);
    expect(
      isTransactionConflict(prismaError('P2010', { originalCode: '40P01' })),
    ).toBe(true);
    expect(
      isTransactionConflict(prismaError('P2010', { originalCode: '40001' })),
    ).toBe(true);
  });

  it('no confunde otros errores con un conflicto de transacción', () => {
    expect(
      isTransactionConflict(prismaError('P2039', { originalCode: '42501' })),
    ).toBe(false);
    expect(isTransactionConflict(prismaError('P2002'))).toBe(false);
    expect(isTransactionConflict(new Error('deadlock detected'))).toBe(false);
  });
});
