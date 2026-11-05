import type {
  PaymentMethodBehavior,
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';

// Helper de catálogo de medios de pago para los tests de SPRINT-4-T32: crea
// el medio si no existe (código único global) o devuelve el existente, sin
// revertir su estado administrativo salvo que el test lo pida. Los tests que
// necesitan medios con estado específico usan códigos propios con prefijo
// para no interferir entre archivos que corren en paralelo.

type Client = Prisma.TransactionClient | PrismaClient;

export interface TestPaymentMethodSpec {
  code: string;
  name: string;
  behavior?: PaymentMethodBehavior;
  sortOrder?: number;
  isActive?: boolean;
  availableForTips?: boolean;
}

export interface TestPaymentMethod {
  id: string;
  code: string;
  name: string;
}

export const DEFAULT_TEST_METHODS: readonly TestPaymentMethodSpec[] = [
  {
    code: 'CASH',
    name: 'Efectivo',
    behavior: 'CASH',
    sortOrder: 10,
    isActive: true,
    availableForTips: true,
  },
  {
    code: 'DEBIT_CARD',
    name: 'Tarjeta de débito',
    behavior: 'RECONCILABLE_CARD',
    sortOrder: 20,
    isActive: true,
    availableForTips: true,
  },
  {
    code: 'CREDIT_CARD',
    name: 'Tarjeta de crédito',
    behavior: 'RECONCILABLE_CARD',
    sortOrder: 30,
    isActive: true,
    availableForTips: true,
  },
  {
    code: 'TRANSFER',
    name: 'Transferencia',
    behavior: 'EXTERNAL_OTHER',
    sortOrder: 40,
    isActive: true,
    availableForTips: true,
  },
] as const;

// Asegura los medios por defecto del catálogo (los que siembra la migración y
// el seed) sin revertir su estado administrativo, igual que el seed real:
// los crea si faltan y, si existen, los deja tal cual.
export async function ensureDefaultPaymentMethods(
  client: Client,
): Promise<void> {
  for (const spec of DEFAULT_TEST_METHODS) {
    await ensurePaymentMethod(client, spec);
  }
}

export async function ensurePaymentMethod(
  client: Client,
  spec: TestPaymentMethodSpec,
  restoreState = false,
): Promise<TestPaymentMethod> {
  const data = {
    name: spec.name,
    behavior: spec.behavior ?? 'EXTERNAL_OTHER',
    sortOrder: spec.sortOrder ?? 100,
    isActive: spec.isActive ?? true,
    availableForTips: spec.availableForTips ?? false,
  };
  const method = await client.paymentMethod.upsert({
    where: { code: spec.code },
    update: restoreState ? data : {},
    create: { code: spec.code, ...data },
  });
  return { id: method.id, code: method.code, name: method.name };
}

// Resuelve el ID de un medio por código; exige que exista.
export async function paymentMethodIdOf(
  client: Client,
  code: string,
): Promise<string> {
  const method = await client.paymentMethod.findUniqueOrThrow({
    where: { code },
    select: { id: true },
  });
  return method.id;
}
