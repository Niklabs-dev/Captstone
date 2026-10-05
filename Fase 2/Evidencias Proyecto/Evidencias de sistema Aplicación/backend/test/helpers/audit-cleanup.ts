import type {
  Prisma,
  PrismaClient,
} from '../../src/generated/prisma/client.js';

// audit_logs es inmutable (SPRINT-1-T15): sus triggers rechazan UPDATE,
// DELETE y TRUNCATE. Los tests que ejercitan la API por HTTP no pueden
// revertir una transacción, así que purgan sus propios registros como un
// mantenimiento de base de datos: en una transacción con
// session_replication_role = replica, que omite los triggers y solo puede
// activar un superusuario (TEST_DATABASE_URL debe conectarse con uno, como el
// usuario postgres de docker compose). La aplicación nunca usa esta vía.
export async function purgeTestAuditLogs(
  prisma: PrismaClient,
  where: Prisma.AuditLogWhereInput,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.auditLog.deleteMany({ where });
  });
}
