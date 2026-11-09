import { BadRequestException } from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import type { DtAlertsService } from '../dt-alerts/dt-alerts.service.js';
import type { SalesReportsService } from '../sales-reports/sales-reports.service.js';
import type { TipPaymentAlertsService } from '../tips/tip-payment-alerts.service.js';
import { SalesDashboardService } from './sales-dashboard.service.js';

// Validación de la fecha del panel (SPRINT-4R-T13): se valida antes de
// consultar las alertas y el error nombra el parámetro `date` del endpoint.

// 15:00 UTC del 8 de noviembre = 12:00 del 8 de noviembre en Chile.
const NOW = new Date('2026-11-08T15:00:00.000Z');
const ADMIN: AuthUser = {
  id: 'admin',
  email: 'admin@moi-food.cl',
  role: ROLE.ADMINISTRADOR,
  storeId: null,
};

function createService() {
  const empty = { items: [], calculatedAt: NOW };
  const dtList = vi.fn(() => Promise.resolve(empty));
  const tipList = vi.fn(() => Promise.resolve(empty));
  const consolidate = vi.fn(() =>
    Promise.reject(new Error('no debe consolidar')),
  );
  const service = new SalesDashboardService(
    { consolidate } as unknown as SalesReportsService,
    { list: dtList } as unknown as DtAlertsService,
    { list: tipList } as unknown as TipPaymentAlertsService,
  );
  return { service, dtList, tipList, consolidate };
}

describe('SalesDashboardService (SPRINT-4R-T13)', () => {
  it('rechaza una fecha futura nombrando date, sin consultar alertas', async () => {
    const { service, dtList, tipList, consolidate } = createService();

    const result = service.get({ date: '2026-11-09' }, ADMIN, NOW);

    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow(
      'date no puede ser posterior a hoy (2026-11-08, hora de Chile)',
    );
    expect(dtList).not.toHaveBeenCalled();
    expect(tipList).not.toHaveBeenCalled();
    expect(consolidate).not.toHaveBeenCalled();
  });

  it('rechaza una fecha inexistente sin consultar alertas', async () => {
    const { service, dtList, tipList } = createService();

    await expect(
      service.get({ date: '2026-02-30' }, ADMIN, NOW),
    ).rejects.toThrow('date debe ser una fecha válida con formato YYYY-MM-DD');
    expect(dtList).not.toHaveBeenCalled();
    expect(tipList).not.toHaveBeenCalled();
  });
});
