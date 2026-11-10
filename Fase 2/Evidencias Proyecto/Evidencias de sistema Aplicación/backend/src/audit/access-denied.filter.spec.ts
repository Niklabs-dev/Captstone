import { ForbiddenException, Logger, type ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { AccessDeniedAuditFilter } from './access-denied.filter.js';
import type { AuditService } from './audit.service.js';

const USER = {
  id: '0b9f8c1e-3f4a-4c2b-9d6e-1a2b3c4d5e6f',
  email: 'supervisor@moi-food.cl',
  role: 'SUPERVISOR',
  storeId: null,
};

function httpHost(): ArgumentsHost {
  const request = {
    user: USER,
    method: 'GET',
    baseUrl: '',
    route: { path: '/sales-dashboard' },
    params: {},
    query: {},
    ip: '10.0.0.1',
    headers: { 'user-agent': 'vitest' },
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ArgumentsHost;
}

describe('AccessDeniedAuditFilter (SPRINT-4R-T15)', () => {
  let respond: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    respond = vi
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('responde el 403 sin esperar el insert de auditoría', () => {
    let finish: () => void = () => undefined;
    const record = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const filter = new AccessDeniedAuditFilter({
      record,
    } as unknown as AuditService);

    filter.catch(new ForbiddenException(), httpHost());

    expect(respond).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    finish();
  });

  it('registra en el log un fallo de la auditoría sin afectar la respuesta', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const filter = new AccessDeniedAuditFilter({
      record: vi.fn().mockRejectedValue(new Error('sin base')),
    } as unknown as AuditService);

    expect(() =>
      filter.catch(new ForbiddenException(), httpHost()),
    ).not.toThrow();

    await vi.waitFor(() => expect(logged).toHaveBeenCalledTimes(1));
    expect(respond).toHaveBeenCalledTimes(1);
  });
});
