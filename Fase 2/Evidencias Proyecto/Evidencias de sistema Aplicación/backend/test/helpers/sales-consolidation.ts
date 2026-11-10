import { createHash, randomUUID } from 'node:crypto';
import type { RoleCode } from '../../src/auth/constants/roles.constants.js';
import type { AuthUser } from '../../src/auth/types/auth.types.js';
import {
  addDays,
  businessDateOf,
  formatDbDate,
  toDbDate,
} from '../../src/documents/utils/document-dates.util.js';
import type {
  PaymentMethodBehavior,
  Prisma,
} from '../../src/generated/prisma/client.js';
import { fakeSubwayStoreId } from './subway-store-id.js';

// Helpers de los tests de integración del panel y los reportes con ventas
// importadas (SPRINT-4R-T13). Todo se crea dentro de la transacción de
// rollback del test con identificadores propios (UUID): locales con su ID
// Subway, medios de pago y alias. Nunca escribe filas compartidas (alias
// MrComanda sembrados ni medios del catálogo base), para no retener sus
// bloqueos y provocar deadlocks con otras suites que corren en paralelo.

type Tx = Prisma.TransactionClient;

export interface TestStore {
  id: string;
  name: string;
  externalCode: string;
  subwayStoreId: string;
}

export interface TestMethod {
  id: string;
  code: string;
  name: string;
  label: string;
}

export interface ImportLineSpec {
  method: TestMethod;
  amount: number;
}

// Día de negocio de hoy en Chile y desplazamientos (YYYY-MM-DD).
export function businessToday(now: Date = new Date()): string {
  return formatDbDate(toDbDate(businessDateOf(now)));
}

export function businessDaysAgo(days: number, now: Date = new Date()): string {
  return formatDbDate(toDbDate(addDays(businessDateOf(now), -days)));
}

export function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

export async function createTestUser(
  tx: Tx,
  role: RoleCode,
  storeId: string | null,
): Promise<AuthUser> {
  const roleRecord = await tx.role.upsert({
    where: { code: role },
    update: {},
    create: { code: role, name: role },
  });
  const id = randomUUID();
  const email = `${id}@sales-consolidation-test.invalid`;
  await tx.user.create({
    data: {
      id,
      email,
      passwordHash: '$2b$04$hash-de-prueba',
      firstName: role,
      lastName: 'Consolidado',
      roleId: roleRecord.id,
      storeId,
    },
  });
  return { id, email, role, storeId };
}

// Local con su ID Subway propio (las importaciones lo exigen, SPRINT-4A-T17).
export async function createTestStore(
  tx: Tx,
  label: string,
  city: string,
  isActive = true,
): Promise<TestStore> {
  const name = `Subway T13 ${label} ${randomUUID()}`;
  const subwayStoreId = fakeSubwayStoreId();
  const store = await tx.store.create({
    data: {
      name,
      city,
      address: 'Calle sintética 123',
      isActive,
      subwayStoreId,
    },
  });
  const externalCode = `913 - ${subwayStoreId}`;
  return { id: store.id, name, externalCode, subwayStoreId };
}

// Medio de pago propio con alias MrComanda propio. Se crea activo (el
// trigger de líneas exige el alias) y el test lo desactiva después si
// necesita un medio inactivo con historial.
export async function createTestMethod(
  tx: Tx,
  name: string,
  sortOrder: number,
  behavior: PaymentMethodBehavior = 'RECONCILABLE_CARD',
): Promise<TestMethod> {
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase();
  const code = `T13_${suffix}`;
  const method = await tx.paymentMethod.create({
    data: { code, name, sortOrder, behavior, isActive: true },
  });
  const label = `T13 ${name.toUpperCase()} ${suffix}`;
  await tx.paymentMethodAlias.create({
    data: {
      system: 'MRCOMANDA',
      label,
      normalizedLabel: label,
      paymentMethodId: method.id,
    },
  });
  return { id: method.id, code, name, label };
}

export interface ImportSpec {
  store: TestStore;
  businessDate: string;
  lines: ImportLineSpec[];
  status: 'PENDING' | 'ACTIVE';
  confirmedById: string;
  // Inicio del período del reporte; por defecto las 09:00 de Chile del día.
  // La base exige que caiga en el día de negocio en hora de Chile.
  startsAt?: Date;
}

// Importación del día creada directo en la base (el flujo de carga ya está
// cubierto por SPRINT-4R-T10): cabecera PENDING, líneas y, si corresponde,
// confirmación a ACTIVE.
export async function createTestImport(
  tx: Tx,
  spec: ImportSpec,
): Promise<string> {
  const start = spec.startsAt ?? new Date(`${spec.businessDate}T12:00:00.000Z`);
  const totalAmount = spec.lines.reduce((sum, line) => sum + line.amount, 0);
  const version =
    (await tx.salesImport.count({
      where: {
        storeId: spec.store.id,
        businessDate: dbDate(spec.businessDate),
      },
    })) + 1;
  const header = await tx.salesImport.create({
    data: {
      storeId: spec.store.id,
      businessDate: dbDate(spec.businessDate),
      periodStart: start,
      periodEnd: new Date(start.getTime() + 8 * 3_600_000),
      externalStoreCode: spec.store.externalCode,
      subwayStoreId: spec.store.subwayStoreId,
      version,
      totalAmount: BigInt(totalAmount),
      fileName: 'ventas.xlsx',
      filePath: `sales-imports/test/${randomUUID()}.xlsx`,
      mimeType: 'application/octet-stream',
      sizeBytes: BigInt(10),
      sha256Hash: createHash('sha256').update(randomUUID()).digest('hex'),
      uploadedById: spec.confirmedById,
    },
  });
  await tx.salesImportLine.createMany({
    data: spec.lines.map((line, index) => ({
      importId: header.id,
      lineNumber: index + 1,
      originalLabel: line.method.label,
      normalizedLabel: line.method.label,
      amount: BigInt(line.amount),
      paymentMethodId: line.method.id,
    })),
  });
  if (spec.status === 'ACTIVE') {
    await tx.salesImport.update({
      where: { id: header.id },
      data: {
        status: 'ACTIVE',
        isCurrent: true,
        confirmedAt: new Date(Date.now() - 60_000),
        confirmedById: spec.confirmedById,
      },
    });
  }
  return header.id;
}

// Reemplaza la versión vigente (ACTIVE → SUPERSEDED), como al confirmar una
// versión nueva. Devuelve el ID de la versión reemplazada.
export async function supersedeTestImport(
  tx: Tx,
  importId: string,
): Promise<string> {
  const superseded = await tx.salesImport.update({
    where: { id: importId },
    data: { status: 'SUPERSEDED', isCurrent: null, supersededAt: new Date() },
    select: { id: true },
  });
  return superseded.id;
}
