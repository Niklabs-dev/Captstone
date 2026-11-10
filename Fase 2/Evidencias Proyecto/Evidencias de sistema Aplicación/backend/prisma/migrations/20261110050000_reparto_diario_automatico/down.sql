-- Reversa de 20261110050000_reparto_diario_automatico (SPRINT-4A-T03).
-- Restaura la función de conciliación tal como la dejó
-- 20261110040000_propinas_diarias_lotes_pago: vuelve a conciliar solo las
-- operaciones que tienen reparto (sin exigirlo). No borra filas: las
-- propinas generadas por esta migración o por la API se conservan.

CREATE OR REPLACE FUNCTION "daily_tip_allocations_check_operation"("target" uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  "fund" BIGINT;
  "allocated" BIGINT;
  "allocation_count" BIGINT;
  "mismatched" BIGINT;
BEGIN
  SELECT o."tip_fund_amount" INTO "fund"
  FROM "daily_operations" AS o WHERE o."id" = "target";
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), COALESCE(sum(a."amount"), 0)
    INTO "allocation_count", "allocated"
    FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = "target";

  IF "allocation_count" = 0 THEN
    RETURN;
  END IF;

  IF "allocated" <> "fund" THEN
    RAISE EXCEPTION 'Las propinas diarias de la operación % suman % y su fondo es %: deben ser iguales', "target", "allocated", "fund"
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO "mismatched"
  FROM (
    SELECT p."worker_id" FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = "target"
  ) AS sel
  FULL JOIN (
    SELECT a."worker_id" FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = "target"
  ) AS alloc ON alloc."worker_id" = sel."worker_id"
  WHERE sel."worker_id" IS NULL OR alloc."worker_id" IS NULL;
  IF "mismatched" > 0 THEN
    RAISE EXCEPTION 'Las propinas diarias de la operación % no coinciden con sus participantes: debe haber una por participante', "target"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
