import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ParsedMrComandaReport,
  ParsedPaymentLine,
} from './parser/mrcomanda-report.types.js';

// Resolución del reporte leído contra las equivalencias de SPRINT-4R-T08
// (SPRINT-4R-T09). Solo consulta: nunca asigna IDs a locales ni crea alias.
// Un local o medio sin equivalencia queda como problema y la vista previa no
// guarda nada (canConfirm = false). Desde SPRINT-4A-T18 el problema no
// bloquea: el administrador elige a mano el local o el medio (o crea el
// medio, SPRINT-4A-T21) y confirma con
// POST /sales-imports/confirm-with-resolution.
//
// Desde SPRINT-4A-T17 el local se identifica por el ID Subway del encabezado
// (72597 en «208 - 72597») contra stores.subway_store_id, y debe estar
// activo. El número interno de MrComanda (208) se ignora y
// store_external_codes ya no se consulta.
//
// Desde SPRINT-4A-T21 (decisión del PO) una línea sin alias con monto 0 se
// omite sola (skipped = true): no es un problema ni pide resolución, y se
// guarda como línea omitida AUTOMATIC. Una línea sin alias con valor sigue
// siendo un problema: se elige su medio o se crea uno desde la vista previa.
// Excepción: si TODAS las líneas quedarían omitidas no se omite ninguna (la
// importación necesita al menos una línea de venta) y todas piden su medio.

export interface ResolvedStore {
  id: string;
  name: string;
}

export interface ResolvedPaymentMethod {
  id: string;
  code: string;
  name: string;
}

export interface ResolvedPaymentLine extends ParsedPaymentLine {
  paymentMethod: ResolvedPaymentMethod | null;
  // SPRINT-4A-T21: true si la línea no tiene alias, está en 0 y se omite sola.
  skipped: boolean;
}

// Problemas del local (SPRINT-4A-T17):
// - STORE_NOT_IDENTIFIED: el encabezado no trae un ID Subway reconocible.
// - STORE_NOT_CONFIGURED: el ID Subway no está asignado a ningún local.
// - STORE_INACTIVE: el ID Subway es de un local desactivado.
export type SalesImportStoreIssueCode =
  'STORE_NOT_IDENTIFIED' | 'STORE_NOT_CONFIGURED' | 'STORE_INACTIVE';

export type SalesImportIssue =
  | {
      code: SalesImportStoreIssueCode;
      externalStoreCode: string;
      subwayStoreId: string | null;
      message: string;
    }
  | {
      code: 'PAYMENT_METHOD_NOT_CONFIGURED';
      lineNumber: number;
      originalLabel: string;
      message: string;
    };

export interface ResolvedSalesReport {
  report: ParsedMrComandaReport;
  store: ResolvedStore | null;
  lines: ResolvedPaymentLine[];
  issues: SalesImportIssue[];
  canConfirm: boolean;
}

@Injectable()
export class SalesImportResolverService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(report: ParsedMrComandaReport): Promise<ResolvedSalesReport> {
    const { subwayStoreId } = report;
    const [subwayStore, aliases] = await Promise.all([
      subwayStoreId === null
        ? Promise.resolve(null)
        : this.prisma.store.findUnique({
            where: { subwayStoreId },
            select: { id: true, name: true, isActive: true },
          }),
      this.prisma.paymentMethodAlias.findMany({
        where: {
          system: 'MRCOMANDA',
          normalizedLabel: {
            in: report.lines.map((line) => line.normalizedLabel),
          },
        },
        select: {
          normalizedLabel: true,
          paymentMethod: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    const issues: SalesImportIssue[] = [];
    const storeIssue = this.storeIssue(report, subwayStore);
    if (storeIssue !== null) issues.push(storeIssue);
    const store =
      storeIssue === null && subwayStore !== null
        ? { id: subwayStore.id, name: subwayStore.name }
        : null;

    const byLabel = new Map(
      aliases.map((alias) => [alias.normalizedLabel, alias.paymentMethod]),
    );
    const skippable = (line: ParsedPaymentLine): boolean =>
      line.amount === 0 && !byLabel.has(line.normalizedLabel);
    // Al menos una línea debe quedar como venta: si todas se omitirían, no
    // se omite ninguna.
    const autoSkip = !report.lines.every(skippable);
    const lines = report.lines.map((line): ResolvedPaymentLine => {
      const paymentMethod = byLabel.get(line.normalizedLabel) ?? null;
      const skipped = autoSkip && skippable(line);
      if (!paymentMethod && !skipped) {
        issues.push({
          code: 'PAYMENT_METHOD_NOT_CONFIGURED',
          lineNumber: line.lineNumber,
          originalLabel: line.originalLabel,
          message:
            line.amount === 0
              ? `El medio de pago «${line.originalLabel}» no tiene un alias configurado. Todas las líneas del reporte están en 0 y al menos una debe quedar asociada: elige su medio del catálogo o crea uno nuevo.`
              : `El medio de pago «${line.originalLabel}» no tiene un alias configurado. Elige su medio del catálogo o crea uno nuevo para confirmar.`,
        });
      }
      return { ...line, paymentMethod, skipped };
    });

    return {
      report,
      store,
      lines,
      issues,
      canConfirm: issues.length === 0,
    };
  }

  private storeIssue(
    report: ParsedMrComandaReport,
    store: { name: string; isActive: boolean } | null,
  ): SalesImportIssue | null {
    const { externalStoreCode, externalStoreLabel, subwayStoreId } = report;
    if (subwayStoreId === null) {
      return {
        code: 'STORE_NOT_IDENTIFIED',
        externalStoreCode,
        subwayStoreId,
        message: `El encabezado del reporte («Local: ${externalStoreLabel}») no trae un ID Subway reconocible, así que no se pudo identificar el local. Elige el local para confirmar.`,
      };
    }
    if (store === null) {
      return {
        code: 'STORE_NOT_CONFIGURED',
        externalStoreCode,
        subwayStoreId,
        message: `El ID Subway ${subwayStoreId} no está asignado a ningún local. Elige el local para confirmar; si lo recuerdas, el ID queda asignado para próximas cargas.`,
      };
    }
    if (!store.isActive) {
      return {
        code: 'STORE_INACTIVE',
        externalStoreCode,
        subwayStoreId,
        message: `El ID Subway ${subwayStoreId} corresponde al local «${store.name}», que está inactivo. Reactívalo y vuelve a cargar el archivo, o elige otro local activo para confirmar.`,
      };
    }
    return null;
  }
}
