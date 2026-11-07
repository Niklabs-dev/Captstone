-- Reversa de 20261107200000_participantes_diarios_reparto_equitativo
-- (SPRINT-4R-T02). Solo deshace el esquema nuevo; los históricos de
-- tip_entries, tip_pools, tip_pool_sources y repartos proporcionales no se
-- ven afectados porque esta migración jamás los tocó (solo añadió la regla
-- equitativa al enum y dejó NULLable hours_worked sin reescribir filas).
--
-- Requisitos para aplicarla: ninguna fila usa EQUAL_SHARES (pactos, líneas ni
-- constancias equitativas) y hours_worked no tiene NULLs: si los hay, primero
-- hay que resolver esos repartos DRAFT equitativos.

-- Triggers y funciones nuevos.
DROP TRIGGER "tip_pool_receipts_hours_consistent_rows" ON "tip_pool_receipts";
DROP TRIGGER "tip_pool_lines_hours_consistent_rows" ON "tip_pool_lines";
DROP TRIGGER "tip_pool_daily_operation_sources_enforce_truncate" ON "tip_pool_daily_operation_sources";
DROP TRIGGER "tip_pool_daily_operation_sources_enforce_rows" ON "tip_pool_daily_operation_sources";
DROP TRIGGER "daily_operations_require_draft_pool_rows" ON "daily_operations";
DROP TRIGGER "daily_operation_participants_require_draft_pool_truncate" ON "daily_operation_participants";
DROP TRIGGER "daily_operation_participants_require_draft_pool_rows" ON "daily_operation_participants";
DROP TRIGGER "daily_operation_participants_validate_worker_rows" ON "daily_operation_participants";

DROP FUNCTION "tip_pool_children_hours_consistent"();
DROP FUNCTION "tip_pool_daily_operation_sources_enforce"();
DROP FUNCTION "daily_operations_require_draft_pool"();
DROP FUNCTION "daily_operation_participants_require_draft_pool"();
DROP FUNCTION "daily_operation_participants_validate_worker"();

-- Tablas nuevas (sus índices y FKs se eliminan con ellas).
DROP TABLE "tip_pool_daily_operation_sources";
DROP TABLE "daily_operation_participants";

-- Se exigen de nuevo las horas en líneas y constancias (falla si quedan
-- NULLs: resolver primero los repartos DRAFT equitativos).
ALTER TABLE "tip_pool_lines" ALTER COLUMN "hours_worked" SET NOT NULL;
ALTER TABLE "tip_pool_receipts" ALTER COLUMN "hours_worked" SET NOT NULL;

-- La constancia vuelve a comparar horas con igualdad estricta (estado
-- anterior a SPRINT-4R-T02).
CREATE OR REPLACE FUNCTION "tip_pool_receipts_enforce_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Las constancias de pago son inmutables: no se permite % sobre tip_pool_receipts', TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    WHERE p."id" = NEW."pool_id" AND p."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'Solo se emiten constancias de un reparto pagado (reparto %)', NEW."pool_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "tip_pools" AS p
    INNER JOIN "tip_pool_lines" AS l ON l."pool_id" = p."id"
    WHERE p."id" = NEW."pool_id"
      AND l."user_id" = NEW."user_id"
      AND l."amount" = NEW."amount"
      AND l."hours_worked" = NEW."hours_worked"
      AND p."store_id" = NEW."store_id"
      AND p."period_start" = NEW."period_start"
      AND p."period_end" = NEW."period_end"
      AND p."payment_date" = NEW."payment_date"
      AND p."paid_by_id" = NEW."paid_by_id"
  ) THEN
    RAISE EXCEPTION 'La constancia no coincide con el reparto % ni con la línea del trabajador %', NEW."pool_id", NEW."user_id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

-- El enum vuelve a tener solo la regla proporcional (requiere que ninguna
-- fila use EQUAL_SHARES; se recrea el tipo renombrándolo, vía la columna que
-- lo usa).
CREATE TYPE "TipAgreementRule_new" AS ENUM ('PROPORTIONAL_TO_HOURS');
ALTER TABLE "tip_agreements" ALTER COLUMN "rule" TYPE "TipAgreementRule_new"
  USING ("rule"::text::"TipAgreementRule_new");
DROP TYPE "TipAgreementRule";
ALTER TYPE "TipAgreementRule_new" RENAME TO "TipAgreementRule";
