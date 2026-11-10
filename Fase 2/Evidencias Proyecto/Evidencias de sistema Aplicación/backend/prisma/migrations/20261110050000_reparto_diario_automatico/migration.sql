-- SPRINT-4A-T03: el reparto de la operación diaria es automático y
-- obligatorio.
--
-- Desde SPRINT-4A-T03 la API guarda el reparto (una propina No pagada por
-- participante, daily_tip_allocations) en la MISMA transacción que la
-- operación diaria y lo recalcula al corregir el fondo o la selección. Esta
-- migración reemplaza la función de conciliación de
-- 20261110040000_propinas_diarias_lotes_pago (que no se edita) para que la
-- base también lo exija: al commit, una operación con fondo mayor que 0 y
-- participantes debe tener su reparto (además de sumar el fondo y cubrir a
-- cada participante, como ya exigía). Sin reparto solo se aceptan las
-- operaciones con fondo 0 y las anteriores a la selección de participantes
-- (fondo sin participantes), que no se pueden repartir.
--
-- Antes de endurecer la regla se genera, de forma determinista y con la
-- misma regla de splitDailyFund, el reparto de cualquier operación con
-- fondo y participantes que se haya registrado sin él entre la migración
-- anterior y la API nueva (en una base recién migrada no hay ninguna: es una
-- red de seguridad). Las propinas pagadas, los lotes y los repartos
-- históricos no se tocan.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- Red de seguridad: una asignación UNPAID por participante de cada
-- operación con fondo > 0 que aún no tenga reparto, con la regla de
-- splitDailyFund (SPRINT-4R-T04): base = fondo / n (división entera) y +$1 a
-- los "fondo mod n" primeros participantes del orden por ID rotado desde la
-- posición (días desde 1970-01-01) mod n. El orden por uuid de PostgreSQL es
-- el mismo que el de su texto en minúsculas que usa la API.
WITH "ranked" AS (
  SELECT
    o."id" AS "operation_id",
    o."store_id",
    o."business_date",
    o."tip_fund_amount" AS "fund",
    p."worker_id",
    row_number() OVER (PARTITION BY o."id" ORDER BY p."worker_id") - 1 AS "idx",
    count(*) OVER (PARTITION BY o."id") AS "n"
  FROM "daily_operations" AS o
  INNER JOIN "daily_operation_participants" AS p ON p."operation_id" = o."id"
  WHERE o."tip_fund_amount" > 0
    AND NOT EXISTS (
      SELECT 1 FROM "daily_tip_allocations" AS a WHERE a."operation_id" = o."id"
    )
)
INSERT INTO "daily_tip_allocations"
  ("operation_id", "store_id", "business_date", "worker_id", "amount", "status", "updated_at")
SELECT
  r."operation_id",
  r."store_id",
  r."business_date",
  r."worker_id",
  r."fund" / r."n"
    + CASE
        WHEN ((r."idx" - (r."business_date" - DATE '1970-01-01') % r."n" + r."n") % r."n") < r."fund" % r."n"
        THEN 1
        ELSE 0
      END,
  'UNPAID',
  CURRENT_TIMESTAMP
FROM "ranked" AS r;

CREATE OR REPLACE FUNCTION "daily_tip_allocations_check_operation"("target" uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  "fund" BIGINT;
  "allocated" BIGINT;
  "allocation_count" BIGINT;
  "participant_count" BIGINT;
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

  SELECT count(*) INTO "participant_count"
    FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = "target";

  -- Sin reparto solo se acepta fondo 0 o una operación sin participantes
  -- (anterior a la selección de SPRINT-4R-T02: no hay entre quiénes
  -- repartir). Toda otra operación debe traer su reparto en la misma
  -- transacción.
  IF "allocation_count" = 0 THEN
    IF "fund" > 0 AND "participant_count" > 0 THEN
      RAISE EXCEPTION 'La operación % tiene fondo % y % participantes pero no tiene su reparto de propinas diarias: debe guardarse en la misma transacción', "target", "fund", "participant_count"
        USING ERRCODE = 'check_violation';
    END IF;
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
