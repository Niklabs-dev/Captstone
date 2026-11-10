import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ROLE } from '../auth/constants/roles.constants.js';
import { hasAnyRole } from '../auth/policies/store-access.policy.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { businessDateOf } from '../documents/utils/document-dates.util.js';
import { sumTipAmounts } from './calculation/daily-tips-aggregation.js';
import { DailyTipsService } from './daily-tips.service.js';
import type { MyTipsQueryDto } from './dto/my-tips.dto.js';
import type { MyTipsResponse } from './types/my-tips.types.js';

// Mes calendario (en hora de Chile) del instante indicado: del día 1 al
// último día del mes. Es el rango por defecto de la consulta personal.
export function currentMonthRange(now: Date): { from: string; to: string } {
  const { year, month } = businessDateOf(now);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
  return {
    from: `${prefix}-01`,
    to: `${prefix}-${String(lastDay).padStart(2, '0')}`,
  };
}

// Portal del trabajador (SPRINT-4A-T09): propinas diarias propias con su
// estado de pago. La propina existe desde que el supervisor guarda la
// operación diaria (SPRINT-4A-T03), así que aparece de inmediato como No
// pagada; pasa a Pagada con el pago por período (SPRINT-4A-T06). La lectura
// y los totales reutilizan DailyTipsService y sumTipAmounts.
@Injectable()
export class MyTipsService {
  constructor(private readonly dailyTips: DailyTipsService) {}

  async list(
    query: MyTipsQueryDto,
    currentUser: AuthUser,
    now: Date = new Date(),
  ): Promise<MyTipsResponse> {
    // Defensa en profundidad: el controller ya restringe por rol.
    if (!hasAnyRole(currentUser, [ROLE.TRABAJADOR, ROLE.SUPERVISOR])) {
      throw new ForbiddenException(
        'La consulta personal de propinas requiere el rol TRABAJADOR o SUPERVISOR.',
      );
    }
    const requested = this.requestedRange(query, now);
    const range = this.dailyTips.parseRange(requested.from, requested.to);
    const days = await this.dailyTips.findWorkerAllocations(
      currentUser.id,
      range,
    );
    return {
      from: range.from,
      to: range.to,
      days,
      totals: {
        ...sumTipAmounts(days),
        dayCount: new Set(days.map((day) => day.businessDate)).size,
      },
    };
  }

  // from y to van juntos; sin ninguno se consulta el mes en curso.
  private requestedRange(
    query: MyTipsQueryDto,
    now: Date,
  ): { from: string; to: string } {
    if (query.from === undefined && query.to === undefined) {
      return currentMonthRange(now);
    }
    if (query.from === undefined || query.to === undefined) {
      throw new BadRequestException(
        'from y to deben enviarse juntos o no enviarse',
      );
    }
    return { from: query.from, to: query.to };
  }
}
