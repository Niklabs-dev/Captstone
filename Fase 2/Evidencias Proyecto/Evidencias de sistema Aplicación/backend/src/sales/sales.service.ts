import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/types/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateMrComandaSalesDto } from './dto/create-mrcomanda-sales.dto.js';
import type {
  MrComandaSaleTotalResponse,
  MrComandaSalesResponse,
} from './types/sales.types.js';
import { parseMrComandaPeriod } from './utils/mrcomanda-period.util.js';
import { normalizePaymentMethodCode } from '../payment-methods/utils/payment-method-code.util.js';

const MRCOMANDA_SALE_SELECT = {
  id: true,
  paymentMethodId: true,
  grossAmount: true,
  tipAmount: true,
  periodStart: true,
  periodEnd: true,
  cashClosingId: true,
} satisfies Prisma.SaleSelect;

type MrComandaSaleRecord = Prisma.SaleGetPayload<{
  select: typeof MRCOMANDA_SALE_SELECT;
}>;

interface ResolvedTotal {
  methodId: string;
  code: string;
  name: string;
  netAmount: number;
}

function sameInstant(a: Date | null, b: Date): boolean {
  return a !== null && a.getTime() === b.getTime();
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ingresa atómicamente un lote de totales netos MrComanda por local y
   * período. Un reintento idéntico no duplica (devuelve las ventas ya
   * registradas con created = false); un solapamiento o un contenido
   * distinto para el mismo medio y período devuelve conflicto. La carga se
   * serializa por local (mismo bloqueo de la fila del local que el cierre
   * de caja) y rechaza los solapamientos con cualquier cierre CLOSED del
   * local según el período de sus vouchers — con o sin ventas —, sin
   * bloquear los turnos del mismo día que no se solapan con lo cerrado.
   */
  async importMrComandaSales(
    user: AuthUser,
    dto: CreateMrComandaSalesDto,
  ): Promise<MrComandaSalesResponse> {
    return this.prisma.$transaction(async (tx) => {
      // Serializa los ingresos por local: cualquier lote concurrente espera
      // aquí y luego ve las ventas ya escritas por la transacción ganadora.
      // El cierre de caja toma este mismo bloqueo antes de leer ventas, así
      // que ingreso y cierre quedan totalmente ordenados por local: nunca
      // puede confirmarse un cierre con una venta huérfana posterior ni un
      // ingreso ignorar un cierre recién confirmado.
      await tx.$queryRaw`SELECT id FROM stores WHERE id = ${dto.storeId}::uuid FOR UPDATE`;
      const store = await tx.store.findUnique({
        where: { id: dto.storeId },
        select: { id: true, isActive: true },
      });
      if (!store) throw new NotFoundException('Local no encontrado');
      if (!store.isActive) {
        throw new BadRequestException('El local indicado está inactivo');
      }

      const period = parseMrComandaPeriod(dto.periodStart, dto.periodEnd);

      // Cierres CLOSED del local cuyo período de vouchers solapa el lote.
      // Cubre también los cierres sin ventas (p. ej. un turno sin
      // movimientos), que no dejan filas en sales que los delaten. El
      // bloqueo de la fila del local tomado arriba serializa este ingreso
      // contra cualquier cierre concurrente: mientras esta transacción viva
      // ningún cierre puede confirmarse (el cierre toma el mismo bloqueo
      // antes de leer ventas), así que esta lectura es consistente con lo
      // que se cree abajo.
      const closedCuts = await tx.cashClosing.findMany({
        where: {
          storeId: store.id,
          status: 'CLOSED',
          vouchers: {
            some: {
              periodStart: { lt: period.end },
              periodEnd: { gt: period.start },
            },
          },
        },
        select: { id: true },
      });

      // Resuelve los códigos del lote contra el catálogo: sin duplicados
      // dentro del lote y todos activos (los inactivos conservan su
      // historial pero no admiten cargas nuevas).
      const resolved: ResolvedTotal[] = [];
      const seenCodes = new Set<string>();
      for (const total of dto.totals) {
        const code = normalizePaymentMethodCode(total.paymentMethod);
        if (seenCodes.has(code)) {
          throw new BadRequestException(
            `totals repite el medio de pago ${code}`,
          );
        }
        seenCodes.add(code);
        resolved.push({
          methodId: '',
          code,
          name: '',
          netAmount: total.netAmount,
        });
      }

      const methods = await tx.paymentMethod.findMany({
        where: { code: { in: resolved.map((total) => total.code) } },
        select: { id: true, code: true, name: true, isActive: true },
      });
      const byCode = new Map(methods.map((method) => [method.code, method]));
      for (const total of resolved) {
        const method = byCode.get(total.code);
        if (!method) {
          throw new BadRequestException(
            `El medio de pago ${total.code} no existe en el catálogo`,
          );
        }
        if (!method.isActive) {
          throw new BadRequestException(
            `El medio de pago ${total.code} está inactivo y no admite cargas nuevas`,
          );
        }
        total.methodId = method.id;
        total.name = method.name;
      }

      // Ventas MrComanda ya registradas del local que solapan el período.
      // Las comparaciones son por medio: cada medio es independiente. Se
      // trae el estado del cierre asociado para proteger solo lo ya
      // conciliado: un cierre CLOSED deja inmutable su venta, pero no
      // bloquea los turnos del mismo día que no se solapan con ella.
      const overlapping = await tx.sale.findMany({
        where: {
          storeId: store.id,
          source: 'MRCOMANDA',
          paymentMethodId: { in: resolved.map((total) => total.methodId) },
          periodStart: { lt: period.end },
          periodEnd: { gt: period.start },
        },
        select: {
          ...MRCOMANDA_SALE_SELECT,
          cashClosing: { select: { status: true } },
        },
      });

      const matched = new Map<string, MrComandaSaleRecord>();
      const pendingCodes: string[] = [];
      for (const total of resolved) {
        const candidates = overlapping.filter(
          (sale) => sale.paymentMethodId === total.methodId,
        );
        if (candidates.length === 0) {
          pendingCodes.push(total.code);
          continue;
        }
        const exact = candidates.find(
          (sale) =>
            sameInstant(sale.periodStart, period.start) &&
            sameInstant(sale.periodEnd, period.end),
        );
        if (!exact) {
          if (
            candidates.some((sale) => sale.cashClosing?.status === 'CLOSED')
          ) {
            throw new ConflictException(
              `El período se solapa con ventas MrComanda ya conciliadas en un cierre cerrado del medio ${total.code}`,
            );
          }
          throw new ConflictException(
            `El período se solapa con un ingreso MrComanda previo del medio ${total.code}`,
          );
        }
        const existingNet = exact.grossAmount.minus(exact.tipAmount);
        if (!existingNet.equals(total.netAmount)) {
          throw new ConflictException(
            `Ya existe un total MrComanda distinto para el medio ${total.code} en el período indicado`,
          );
        }
        matched.set(total.code, exact);
      }

      // Un cierre cerrado que solapa el período bloquea solo las altas
      // nuevas: el reintento idéntico de un lote ya conciliado quedó
      // emparejado arriba y sigue siendo idempotente. Los turnos del mismo
      // día que no se solapan con el corte cerrado no se ven afectados.
      if (pendingCodes.length > 0 && closedCuts.length > 0) {
        throw new ConflictException(
          'El período se solapa con un cierre de caja cerrado del local',
        );
      }

      // Crea solo los totales que no venían de un reintento idéntico. La
      // unicidad por local, medio, fuente y período en la base respalda la
      // idempotencia ante cualquier carrera residual.
      const created: MrComandaSaleRecord[] = [];
      try {
        for (const total of resolved) {
          if (matched.has(total.code)) continue;
          const sale = await tx.sale.create({
            data: {
              storeId: store.id,
              soldAt: period.start,
              source: 'MRCOMANDA',
              paymentMethodId: total.methodId,
              // Venta neta agregada: sin propina (su fuente sigue siendo
              // tip_entries), así que el neto coincide con el bruto.
              grossAmount: total.netAmount,
              tipAmount: 0,
              periodStart: period.start,
              periodEnd: period.end,
              registeredById: user.id,
            },
            select: MRCOMANDA_SALE_SELECT,
          });
          created.push(sale);
        }
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Ya existe un total MrComanda para uno de los medios y el período indicado',
          );
        }
        throw error;
      }

      const totals: MrComandaSaleTotalResponse[] = resolved.map((total) => {
        const sale = matched.get(total.code);
        const record =
          sale ?? created.find((row) => row.paymentMethodId === total.methodId);
        if (!record) {
          // Inalcanzable: cada total quedó emparejado o fue creado arriba.
          throw new ConflictException(
            `No se pudo resolver el total del medio ${total.code}`,
          );
        }
        return {
          saleId: record.id,
          paymentMethod: total.code,
          paymentMethodName: total.name,
          netAmount: record.grossAmount.minus(record.tipAmount).toNumber(),
        };
      });
      totals.sort((a, b) => a.paymentMethod.localeCompare(b.paymentMethod));

      return {
        storeId: store.id,
        periodStart: period.start,
        periodEnd: period.end,
        created: created.length > 0,
        totalNetAmount: totals.reduce((sum, total) => sum + total.netAmount, 0),
        totals,
      };
    });
  }
}
