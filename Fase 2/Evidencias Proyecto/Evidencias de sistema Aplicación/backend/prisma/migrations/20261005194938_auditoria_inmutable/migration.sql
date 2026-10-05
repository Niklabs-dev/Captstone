-- SPRINT-1-T15: registro de auditoría inmutable (criterio 2 de E1-H2).
-- Una vez registrada, una operación no se puede modificar ni eliminar,
-- ni siquiera por las cascadas de las llaves foráneas.

-- Las FK hacia usuarios y locales pasan de SET NULL a RESTRICT: con SET NULL,
-- borrar un usuario modificaría sus registros de auditoría (y borraría al
-- responsable). La Ley N°21.719 se cumple anonimizando (users.anonymized_at),
-- que conserva la fila.

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_store_id_fkey";

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rechaza toda modificación del registro de auditoría. Aplica a cualquier rol,
-- incluido el dueño de la tabla y el superusuario, y a cualquier vía
-- (Prisma, SQL directo o cascadas). Solo se omite con
-- session_replication_role = replica, que exige privilegios de superusuario
-- (mantenimiento de la base de datos, no un camino de la aplicación).
CREATE FUNCTION "audit_logs_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'El registro de auditoría es inmutable: no se permite % sobre audit_logs', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- UPDATE y DELETE fila a fila.
CREATE TRIGGER "audit_logs_immutable_rows"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_prevent_change"();

-- TRUNCATE no dispara los triggers por fila: se bloquea por sentencia.
CREATE TRIGGER "audit_logs_immutable_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_logs_prevent_change"();
