import { BadRequestException, ConflictException } from '@nestjs/common';
import type { SalesImportResolution } from '../../generated/prisma/client.js';
import type { SalesImportResolutionDto } from '../dto/sales-import-request.dto.js';
import {
  isValidPaymentMethodCode,
  paymentMethodCodeFromName,
} from '../../payment-methods/utils/payment-method-code.util.js';
import { normalizeExternalLabel } from '../normalization/normalize-external-label.js';
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
//
// SPRINT-4A-T21: las líneas en 0 sin alias se omiten solas (skipped en la
// resolución) y no se eligen; cada línea pendiente se asocia a un medio
// activo (ASSIGN) o a uno nuevo (CREATE) que se da de alta junto con el alias
// de su etiqueta. Un nombre ya usado por otro medio responde 409.

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

// Medio que se da de alta desde la vista previa (SPRINT-4A-T21): activo,
// EXTERNAL_OTHER y no disponible para propinas (se ajusta después en la
// administración de medios de pago).
export interface PlannedNewMethod {
  name: string;
  code: string;
}

export type PlannedTarget =
  | { kind: 'EXISTING'; paymentMethodId: string }
  | ({ kind: 'NEW' } & PlannedNewMethod);

export interface PlannedLine {
  line: ParsedPaymentLine;
  target: PlannedTarget;
  resolution: SalesImportResolution;
  // Crear el alias de la etiqueta hacia el medio (solo líneas MANUAL; en un
  // medio nuevo, siempre).
  remember: boolean;
}

export interface ManualResolutionPlan {
  store: ResolvedStore;
  storeResolution: SalesImportResolution;
  // ID Subway que «recordar» asigna al local elegido; null si no se recuerda.
  rememberSubwayStoreId: string | null;
  lines: PlannedLine[];
  // Líneas en 0 sin alias, omitidas automáticamente.
  skipped: ParsedPaymentLine[];
}

// Los mismos caracteres de control que rechaza la administración de medios.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function quoted(labels: readonly string[]): string {
  return labels.map((label) => `«${label}»`).join(', ');
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

function conflict(message: string): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code: 'PAYMENT_METHOD_NAME_TAKEN',
    message,
  });
}

// Medio nuevo para una acción CREATE (SPRINT-4A-T21): el nombre ya llega
// normalizado por el DTO; el código se deriva del nombre. No repite el nombre
// (sin distinguir tildes ni mayúsculas) ni el código de un medio existente,
// activo o no: si ya existe se elige en el selector (o se reactiva), no se
// duplica.
function planNewMethod(
  name: string | null | undefined,
  label: string,
  catalog: readonly ManualMethodCandidate[],
): PlannedNewMethod {
  if (typeof name !== 'string' || name.length === 0) {
    throw new BadRequestException(
      `Indica el nombre del medio de pago nuevo para ${label}.`,
    );
  }
  if (CONTROL_CHARACTERS.test(name)) {
    throw new BadRequestException(
      `El nombre del medio nuevo para ${label} tiene caracteres de control: quítalos.`,
    );
  }
  const code = paymentMethodCodeFromName(name);
  if (!isValidPaymentMethodCode(code)) {
    throw new BadRequestException(
      `El nombre «${name}» no permite generar un código para el medio nuevo de ${label}: usa al menos dos letras o dígitos sin tildes especiales, con al menos una letra.`,
    );
  }
  const key = normalizeExternalLabel(name);
  const sameName = catalog.find(
    (method) => normalizeExternalLabel(method.name) === key,
  );
  if (sameName !== undefined) {
    throw conflict(
      sameName.isActive
        ? `Ya existe el medio de pago «${sameName.name}»: elígelo en el selector en vez de crearlo.`
        : `Ya existe el medio de pago «${sameName.name}», pero está inactivo: reactívalo en Medios de pago o usa otro nombre.`,
    );
  }
  const sameCode = catalog.find((method) => method.code === code);
  if (sameCode !== undefined) {
    throw conflict(
      `El nombre «${name}» genera el código ${code}, que ya usa el medio «${sameCode.name}»: elige ese medio o usa otro nombre.`,
    );
  }
  return { name, code };
}

function planLines(
  resolved: ResolvedSalesReport,
  dto: SalesImportResolutionDto,
  catalog: readonly ManualMethodCandidate[],
): Pick<ManualResolutionPlan, 'lines' | 'skipped'> {
  const methods = new Map(catalog.map((method) => [method.id, method]));
  // Pendientes: sin alias y sin omitirse solas (las líneas en 0 sin alias
  // se omiten automáticamente, SPRINT-4A-T21).
  const pending = new Map(
    resolved.lines
      .filter((line) => line.paymentMethod === null && !line.skipped)
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
        `La línea ${choice.lineNumber} no está pendiente de identificar (ya tiene alias, se omite sola por estar en 0 o no existe). Vuelve a cargar la vista previa.`,
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
  // Medios nuevos por código: dos líneas con el mismo nombre comparten el
  // medio; dos nombres distintos que generan el mismo código no.
  const created = new Map<string, PlannedNewMethod>();
  for (const line of resolved.lines) {
    if (line.paymentMethod !== null) {
      lines.push({
        line,
        target: { kind: 'EXISTING', paymentMethodId: line.paymentMethod.id },
        resolution: 'AUTOMATIC',
        remember: false,
      });
      continue;
    }
    if (line.skipped) {
      skipped.push(line);
      continue;
    }
    const choice = choices.get(line.lineNumber);
    if (choice === undefined) continue;
    const label = `«${line.originalLabel}»`;
    if (choice.action === 'CREATE') {
      if (
        choice.paymentMethodId !== undefined &&
        choice.paymentMethodId !== null
      ) {
        throw new BadRequestException(
          `La línea ${label} crea un medio nuevo, así que no lleva un medio del catálogo.`,
        );
      }
      if (!choice.remember) {
        throw new BadRequestException(
          `Al crear un medio para ${label} su etiqueta siempre se recuerda: envía remember en true.`,
        );
      }
      const method = planNewMethod(choice.name, label, catalog);
      const previous = created.get(method.code);
      if (previous !== undefined && previous.name !== method.name) {
        throw new BadRequestException(
          `Los nombres «${previous.name}» y «${method.name}» generan el mismo código ${method.code}: usa el mismo nombre para crear un solo medio o nombres distintos.`,
        );
      }
      created.set(method.code, method);
      lines.push({
        line,
        target: { kind: 'NEW', ...method },
        resolution: 'MANUAL',
        remember: true,
      });
      continue;
    }
    if (choice.name !== undefined && choice.name !== null) {
      throw new BadRequestException(
        `La línea ${label} se asocia a un medio del catálogo, así que no lleva el nombre de un medio nuevo.`,
      );
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
      target: { kind: 'EXISTING', paymentMethodId: method.id },
      resolution: 'MANUAL',
      remember: choice.remember,
    });
  }
  return { lines, skipped };
}

// catalog: todos los medios del catálogo (activos e inactivos), para validar
// los elegidos y que un medio nuevo no repita a uno existente.
export function planManualResolution(
  resolved: ResolvedSalesReport,
  dto: SalesImportResolutionDto,
  chosenStore: ManualStoreCandidate | null,
  catalog: readonly ManualMethodCandidate[],
): ManualResolutionPlan {
  const pendingLines = resolved.lines.some(
    (line) => line.paymentMethod === null && !line.skipped,
  );
  if (resolved.store !== null && !pendingLines) {
    throw new BadRequestException(
      'Este archivo ya no tiene datos por identificar: vuelve a cargarlo y confírmalo desde la vista previa.',
    );
  }
  return {
    ...planStore(resolved, dto, chosenStore),
    ...planLines(resolved, dto, catalog),
  };
}
