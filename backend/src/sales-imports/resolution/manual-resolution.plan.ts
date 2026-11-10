import { BadRequestException } from '@nestjs/common';
import type { SalesImportResolution } from '../../generated/prisma/client.js';
import type { SalesImportResolutionDto } from '../dto/sales-import-request.dto.js';
import type { ParsedPaymentLine } from '../parser/mrcomanda-report.types.js';
import type {
  ResolvedSalesReport,
  ResolvedStore,
} from '../sales-import-resolver.service.js';

// Plan de una resolución manual (SPRINT-4A-T18): cruza lo que la vista previa
// no identificó con lo que eligió el administrador. Es una función pura (el
// servicio le entrega el local y los medios elegidos ya leídos de la base) y
// valida TODO antes de escribir: si falta algo o una elección no es válida,
// lanza 400 y no se guarda nada. Nunca adivina: solo aplica lo elegido.

export interface ManualStoreCandidate {
  id: string;
  name: string;
  isActive: boolean;
  subwayStoreId: string | null;
}

export interface ManualMethodCandidate {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface PlannedLine {
  line: ParsedPaymentLine;
  paymentMethodId: string;
  resolution: SalesImportResolution;
  // Crear el alias de la etiqueta hacia el medio (solo líneas MANUAL).
  remember: boolean;
}

export interface ManualResolutionPlan {
  store: ResolvedStore;
  storeResolution: SalesImportResolution;
  // ID Subway que «recordar» asigna al local elegido; null si no se recuerda.
  rememberSubwayStoreId: string | null;
  lines: PlannedLine[];
  skipped: ParsedPaymentLine[];
}

function quoted(labels: readonly string[]): string {
  return labels.map((label) => `«${label}»`).join(', ');
}

function clp(amount: number): string {
  return `$${amount.toLocaleString('es-CL')}`;
}

function planStore(
  resolved: ResolvedSalesReport,
  dto: SalesImportResolutionDto,
  chosen: ManualStoreCandidate | null,
): Pick<
  ManualResolutionPlan,
  'store' | 'storeResolution' | 'rememberSubwayStoreId'
> {
  const choice = dto.store ?? null;
  if (resolved.store !== null) {
    if (choice !== null) {
      throw new BadRequestException(
        'El local ya se identificó por su ID Subway: no se puede elegir otro a mano. Vuelve a cargar la vista previa.',
      );
    }
    return {
      store: resolved.store,
      storeResolution: 'AUTOMATIC',
      rememberSubwayStoreId: null,
    };
  }

  const { subwayStoreId } = resolved.report;
  if (choice === null) {
    throw new BadRequestException(
      'Elige el local del archivo: su ID Subway no identificó un local activo.',
    );
  }
  if (chosen === null || chosen.id !== choice.storeId) {
    throw new BadRequestException(
      'El local elegido no existe. Vuelve a cargar la vista previa.',
    );
  }
  if (!chosen.isActive) {
    throw new BadRequestException(
      `El local «${chosen.name}» está inactivo: elige un local activo.`,
    );
  }
  if (!choice.remember) {
    return {
      store: { id: chosen.id, name: chosen.name },
      storeResolution: 'MANUAL',
      rememberSubwayStoreId: null,
    };
  }
  if (subwayStoreId === null) {
    throw new BadRequestException(
      'El archivo no trae un ID Subway, así que no hay nada que recordar para el local. Desmarca «Recordar para próximas cargas».',
    );
  }
  const storeIssue = resolved.issues.find(
    (issue) => issue.code === 'STORE_INACTIVE',
  );
  if (storeIssue !== undefined) {
    throw new BadRequestException(
      `El ID Subway ${subwayStoreId} ya está asignado a un local inactivo: no se puede recordar para otro local. Desmarca «Recordar para próximas cargas» o corrige el ID en la administración de locales.`,
    );
  }
  if (chosen.subwayStoreId !== null) {
    throw new BadRequestException(
      `El local «${chosen.name}» ya tiene el ID Subway ${chosen.subwayStoreId} y no se sobrescribe. Desmarca «Recordar para próximas cargas» o corrige el ID en la administración de locales.`,
    );
  }
  return {
    store: { id: chosen.id, name: chosen.name },
    storeResolution: 'MANUAL',
    rememberSubwayStoreId: subwayStoreId,
  };
}

function planLines(
  resolved: ResolvedSalesReport,
  dto: SalesImportResolutionDto,
  methods: ReadonlyMap<string, ManualMethodCandidate>,
): Pick<ManualResolutionPlan, 'lines' | 'skipped'> {
  const pending = new Map(
    resolved.lines
      .filter((line) => line.paymentMethod === null)
      .map((line) => [line.lineNumber, line]),
  );
  const choices = new Map<number, SalesImportResolutionDto['lines'][number]>();
  for (const choice of dto.lines) {
    if (choices.has(choice.lineNumber)) {
      throw new BadRequestException(
        `La línea ${choice.lineNumber} viene más de una vez en la resolución.`,
      );
    }
    if (!pending.has(choice.lineNumber)) {
      throw new BadRequestException(
        `La línea ${choice.lineNumber} no está pendiente de identificar (ya tiene alias o no existe). Vuelve a cargar la vista previa.`,
      );
    }
    choices.set(choice.lineNumber, choice);
  }
  const missing = [...pending.values()].filter(
    (line) => !choices.has(line.lineNumber),
  );
  if (missing.length > 0) {
    throw new BadRequestException(
      `Falta elegir el medio de pago de ${quoted(missing.map((line) => line.originalLabel))}.`,
    );
  }

  const lines: PlannedLine[] = [];
  const skipped: ParsedPaymentLine[] = [];
  for (const line of resolved.lines) {
    if (line.paymentMethod !== null) {
      lines.push({
        line,
        paymentMethodId: line.paymentMethod.id,
        resolution: 'AUTOMATIC',
        remember: false,
      });
      continue;
    }
    const choice = choices.get(line.lineNumber);
    if (choice === undefined) continue;
    const label = `«${line.originalLabel}»`;
    if (choice.action === 'SKIP') {
      if (
        choice.paymentMethodId !== undefined &&
        choice.paymentMethodId !== null
      ) {
        throw new BadRequestException(
          `La línea ${label} se omite, así que no lleva medio de pago.`,
        );
      }
      if (choice.remember) {
        throw new BadRequestException(
          `Solo se recuerda una línea asociada a un medio de pago: ${label} se omite.`,
        );
      }
      if (line.amount !== 0) {
        throw new BadRequestException(
          `${label} tiene un monto de ${clp(line.amount)}: asócialo a un medio de pago (solo se omiten líneas en 0).`,
        );
      }
      skipped.push(line);
      continue;
    }
    const method =
      typeof choice.paymentMethodId === 'string'
        ? methods.get(choice.paymentMethodId)
        : undefined;
    if (method === undefined) {
      throw new BadRequestException(
        `El medio de pago elegido para ${label} no existe. Vuelve a cargar la vista previa.`,
      );
    }
    if (!method.isActive) {
      throw new BadRequestException(
        `El medio de pago «${method.name}» elegido para ${label} está inactivo: elige un medio activo.`,
      );
    }
    lines.push({
      line,
      paymentMethodId: method.id,
      resolution: 'MANUAL',
      remember: choice.remember,
    });
  }
  if (lines.length === 0) {
    throw new BadRequestException(
      'Asocia al menos una línea a un medio de pago: no se puede omitir todo el reporte.',
    );
  }
  return { lines, skipped };
}

export function planManualResolution(
  resolved: ResolvedSalesReport,
  dto: SalesImportResolutionDto,
  chosenStore: ManualStoreCandidate | null,
  methods: ReadonlyMap<string, ManualMethodCandidate>,
): ManualResolutionPlan {
  const pendingLines = resolved.lines.some(
    (line) => line.paymentMethod === null,
  );
  if (resolved.store !== null && !pendingLines) {
    throw new BadRequestException(
      'Este archivo ya no tiene datos por identificar: vuelve a cargarlo y confírmalo desde la vista previa.',
    );
  }
  return {
    ...planStore(resolved, dto, chosenStore),
    ...planLines(resolved, dto, methods),
  };
}
