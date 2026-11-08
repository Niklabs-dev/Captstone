import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ParsedMrComandaReport,
  ParsedPaymentLine,
} from './parser/mrcomanda-report.types.js';

// Resolución del reporte leído contra las equivalencias de SPRINT-4R-T08
// (SPRINT-4R-T09). Solo consulta: nunca crea identificadores de local ni
// alias. Un local o medio sin equivalencia queda como problema y la
// importación no se puede confirmar (canConfirm = false); la previsualización
// de SPRINT-4R-T10 muestra los problemas para que el administrador configure
// la equivalencia y vuelva a cargar.

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
}

export type SalesImportIssue =
  | { code: 'STORE_NOT_CONFIGURED'; externalStoreCode: string; message: string }
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
    const [storeCode, aliases] = await Promise.all([
      this.prisma.storeExternalCode.findUnique({
        where: {
          system_externalCode: {
            system: 'MRCOMANDA',
            externalCode: report.externalStoreCode,
          },
        },
        select: { store: { select: { id: true, name: true } } },
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
    const store = storeCode?.store ?? null;
    if (!store) {
      issues.push({
        code: 'STORE_NOT_CONFIGURED',
        externalStoreCode: report.externalStoreCode,
        message: `El local «${report.externalStoreLabel}» de MrComanda no está asociado a ningún local del sistema. Configura su identificador antes de importar.`,
      });
    }

    const byLabel = new Map(
      aliases.map((alias) => [alias.normalizedLabel, alias.paymentMethod]),
    );
    const lines = report.lines.map((line): ResolvedPaymentLine => {
      const paymentMethod = byLabel.get(line.normalizedLabel) ?? null;
      if (!paymentMethod) {
        issues.push({
          code: 'PAYMENT_METHOD_NOT_CONFIGURED',
          lineNumber: line.lineNumber,
          originalLabel: line.originalLabel,
          message: `El medio de pago «${line.originalLabel}» no tiene un alias configurado. Asócialo a un medio del catálogo antes de importar.`,
        });
      }
      return { ...line, paymentMethod };
    });

    return {
      report,
      store,
      lines,
      issues,
      canConfirm: issues.length === 0,
    };
  }
}
