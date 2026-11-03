import type { Prisma } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Sustituto de PrismaService para probar la API por HTTP dentro de
// withinRollback: la aplicación completa usa la transacción activa del test,
// así que sus lecturas y escrituras (también las de auditoría) se revierten.
// Su $transaction reutiliza esa misma transacción en vez de abrir otra. Sin
// transacción activa no expone nada: Nest no ve hooks de ciclo de vida que
// abrirían una conexión real.
export interface SwitchablePrisma {
  service: PrismaService;
  use(tx: Prisma.TransactionClient | null): void;
}

export function createSwitchablePrisma(): SwitchablePrisma {
  let active: Prisma.TransactionClient | null = null;

  function currentTransaction(): Prisma.TransactionClient {
    if (!active) throw new Error('No hay una transacción de test activa');
    return active;
  }

  const service = new Proxy(
    {},
    {
      get(_target, property): unknown {
        if (property === '$transaction') {
          return <T>(
            work:
              ((client: Prisma.TransactionClient) => Promise<T>) | Promise<T>[],
          ): Promise<T | T[]> =>
            Array.isArray(work)
              ? Promise.all(work)
              : work(currentTransaction());
        }
        return active ? (Reflect.get(active, property) as unknown) : undefined;
      },
    },
  );

  return {
    service: service as unknown as PrismaService,
    use(tx) {
      active = tx;
    },
  };
}
