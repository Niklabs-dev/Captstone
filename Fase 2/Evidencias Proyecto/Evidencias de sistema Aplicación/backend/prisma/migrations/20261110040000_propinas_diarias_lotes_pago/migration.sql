-- SPRINT-4A-T02: propina diaria por trabajador y lotes de pago.
--
-- Decisión del Product Owner (10/11/2026): la unidad de propina es la
-- asignación diaria por trabajador, creada en la MISMA transacción que la
-- operación diaria (la API lo hace desde SPRINT-4A-T03), con estado UNPAID
-- (No pagada) o PAID (Pagada). El pago se registra como lote (local +
-- período + quién + cuándo) que marca las asignaciones No pagadas del
-- período (el endpoint de pago es SPRINT-4A-T06). Los repartos por período
-- (tip_pools DRAFT/CONFIRMED/PAID) y sus constancias se conservan como
-- históricos: esta migración no borra ni modifica ninguna de sus filas.
--
-- Tablas nuevas:
-- - daily_tip_allocations: operación, local, fecha de negocio, trabajador,
--   monto CLP entero (BIGINT), estado, lote opcional y timestamps. Única por
--   (operation_id, worker_id); índices por (store_id, business_date) y por
--   (worker_id, business_date).
-- - tip_payment_batches: local, período desde/hasta, monto total, cantidad
--   de asignaciones, usuario que pagó y fecha de pago. legacy_pool_id enlaza
--   los lotes históricos que esta migración crea para los repartos PAID.
--
-- La base garantiza (para cualquier vía de escritura; solo
-- session_replication_role = replica omite los triggers y esta migración NO
-- la usa):
-- - CHECK: amount >= 0; PAID exige lote y UNPAID no lo admite; el lote tiene
--   período válido, total >= 0 y al menos una asignación.
-- - La asignación copia local y fecha de su operación y su trabajador es
--   participante de esa operación (trigger al escribir). Nace UNPAID; pasa a
--   PAID una sola vez, sin cambiar su monto, con un lote del mismo local cuyo
--   período contiene la fecha. Una asignación PAID es inmutable y no se borra.
-- - Conciliación (constraint trigger DIFERIDO, se evalúa al commit para que
--   operación, participantes y asignaciones se escriban en la misma
--   transacción): las asignaciones de una operación suman exactamente su
--   fondo (tip_fund_amount = tarjeta + efectivo) y hay una por participante.
--   Esta migración concilia las operaciones que tienen asignaciones; exigir
--   que toda operación con fondo y participantes las tenga corresponde a la
--   generación automática (SPRINT-4A-T03, migración propia), que es la que
--   las crea junto con la operación.
-- - Con alguna asignación PAID no cambian los montos, fecha ni local de la
--   operación ni su selección de participantes: un pago no se reinterpreta.
-- - El lote es inmutable (sin UPDATE, DELETE ni TRUNCATE) y sus totales
--   cuadran con sus asignaciones (constraint trigger diferido).
--
-- Migración de datos (determinista):
-- - Cada operación existente con fondo > 0 y participantes recibe una
--   asignación UNPAID por participante con la regla de reparto vigente
--   (splitDailyFund de SPRINT-4R-T04, la misma que usa la API desde
--   SPRINT-4A-T03): floor(fondo / n) a cada uno y los fondo mod n pesos
--   sobrantes de a $1 a los primeros participantes en orden estable: por ID
--   ascendente, rotado para comenzar en la posición (días desde 1970-01-01)
--   mod n. Es exactamente la regla con que se calcularon los repartos
--   equitativos existentes, así que los montos coinciden con sus líneas.
-- - Las operaciones que alimentan un reparto PAID quedan PAID en un lote
--   histórico por reparto (mismo local y período; pagado por y en la fecha
--   del reparto; legacy_pool_id = el reparto). El resto queda UNPAID,
--   incluidas las de repartos DRAFT y CONFIRMED, que se conservan sin efecto.
-- - Las operaciones con fondo 0 no generan asignaciones. Las operaciones con
--   fondo > 0 sin participantes (previas a SPRINT-4R-T02) quedan sin
--   asignaciones: no hay entre quiénes repartir; su reparto se genera al
--   corregirlas con participantes (SPRINT-4A-T03).
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateEnum
CREATE TYPE "TipAllocationStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateTable
CREATE TABLE "daily_tip_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_date" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "TipAllocationStatus" NOT NULL DEFAULT 'UNPAID',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "operation_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "payment_batch_id" UUID,

    CONSTRAINT "daily_tip_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tip_payment_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "allocation_count" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "store_id" UUID NOT NULL,
    "paid_by_id" UUID NOT NULL,
    "legacy_pool_id" UUID,

    CONSTRAINT "tip_payment_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_tip_allocations_store_id_business_date_idx" ON "daily_tip_allocations"("store_id", "business_date");

-- CreateIndex
CREATE INDEX "daily_tip_allocations_worker_id_business_date_idx" ON "daily_tip_allocations"("worker_id", "business_date");

-- CreateIndex
CREATE INDEX "daily_tip_allocations_payment_batch_id_idx" ON "daily_tip_allocations"("payment_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_tip_allocations_operation_id_worker_id_key" ON "daily_tip_allocations"("operation_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "tip_payment_batches_legacy_pool_id_key" ON "tip_payment_batches"("legacy_pool_id");

-- CreateIndex
CREATE INDEX "tip_payment_batches_store_id_period_start_period_end_idx" ON "tip_payment_batches"("store_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "tip_payment_batches_paid_by_id_idx" ON "tip_payment_batches"("paid_by_id");

-- AddForeignKey
ALTER TABLE "daily_tip_allocations" ADD CONSTRAINT "daily_tip_allocations_operation_id_fkey" FOREIGN KEY ("operation_id") REFERENCES "daily_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tip_allocations" ADD CONSTRAINT "daily_tip_allocations_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tip_allocations" ADD CONSTRAINT "daily_tip_allocations_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tip_allocations" ADD CONSTRAINT "daily_tip_allocations_payment_batch_id_fkey" FOREIGN KEY ("payment_batch_id") REFERENCES "tip_payment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payment_batches" ADD CONSTRAINT "tip_payment_batches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payment_batches" ADD CONSTRAINT "tip_payment_batches_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tip_payment_batches" ADD CONSTRAINT "tip_payment_batches_legacy_pool_id_fkey" FOREIGN KEY ("legacy_pool_id") REFERENCES "tip_pools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Reglas de fila.
ALTER TABLE "daily_tip_allocations"
ADD CONSTRAINT "daily_tip_allocations_amount_nonnegative" CHECK ("amount" >= 0);

ALTER TABLE "daily_tip_allocations"
ADD CONSTRAINT "daily_tip_allocations_paid_requires_batch" CHECK (
  ("status" = 'PAID' AND "payment_batch_id" IS NOT NULL)
  OR ("status" = 'UNPAID' AND "payment_batch_id" IS NULL)
);

ALTER TABLE "tip_payment_batches"
ADD CONSTRAINT "tip_payment_batches_period_valid" CHECK ("period_start" <= "period_end");

ALTER TABLE "tip_payment_batches"
ADD CONSTRAINT "tip_payment_batches_total_nonnegative" CHECK ("total_amount" >= 0);

ALTER TABLE "tip_payment_batches"
ADD CONSTRAINT "tip_payment_batches_count_positive" CHECK ("allocation_count" > 0);

-- Asignación: coherencia con su operación al escribir, nacimiento UNPAID,
-- transición única a PAID con un lote válido e inmutabilidad de lo pagado.
CREATE FUNCTION "daily_tip_allocations_enforce"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "daily_tip_allocations" WHERE "status" = 'PAID') THEN
      RAISE EXCEPTION 'Hay propinas diarias pagadas: no se permite TRUNCATE sobre daily_tip_allocations'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'PAID' THEN
      RAISE EXCEPTION 'La propina diaria % ya está pagada: no se puede eliminar', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'PAID' THEN
      RAISE EXCEPTION 'La propina diaria % ya está pagada: es inmutable', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF (NEW."id", NEW."operation_id", NEW."worker_id", NEW."store_id",
        NEW."business_date", NEW."created_at")
      IS DISTINCT FROM
       (OLD."id", OLD."operation_id", OLD."worker_id", OLD."store_id",
        OLD."business_date", OLD."created_at") THEN
      RAISE EXCEPTION 'La propina diaria % no puede cambiar de operación, trabajador, local ni fecha', OLD."id"
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW."status" = 'PAID' THEN
      IF NEW."amount" <> OLD."amount" THEN
        RAISE EXCEPTION 'La propina diaria % no puede cambiar su monto al pagarse', OLD."id"
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM "tip_payment_batches" AS b
        WHERE b."id" = NEW."payment_batch_id"
          AND b."store_id" = NEW."store_id"
          AND NEW."business_date" BETWEEN b."period_start" AND b."period_end"
      ) THEN
        RAISE EXCEPTION 'El lote de pago % no corresponde al local ni al período de la propina diaria %', NEW."payment_batch_id", OLD."id"
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW."status" <> 'UNPAID' THEN
    RAISE EXCEPTION 'La propina diaria nace No pagada (UNPAID): el pago se registra después con un lote'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "daily_operations" AS o
    WHERE o."id" = NEW."operation_id"
      AND o."store_id" = NEW."store_id"
      AND o."business_date" = NEW."business_date"
  ) THEN
    RAISE EXCEPTION 'La propina diaria debe copiar el local y la fecha de negocio de la operación %', NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "daily_operation_participants" AS p
    WHERE p."operation_id" = NEW."operation_id"
      AND p."worker_id" = NEW."worker_id"
  ) THEN
    RAISE EXCEPTION 'El trabajador % no participa de la operación %: no puede recibir propina de ese día', NEW."worker_id", NEW."operation_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_tip_allocations_enforce_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "daily_tip_allocations"
  FOR EACH ROW EXECUTE FUNCTION "daily_tip_allocations_enforce"();

CREATE TRIGGER "daily_tip_allocations_enforce_truncate"
  BEFORE TRUNCATE ON "daily_tip_allocations"
  FOR EACH STATEMENT EXECUTE FUNCTION "daily_tip_allocations_enforce"();

-- Conciliación de una operación: si tiene asignaciones, suman su fondo y hay
-- una por participante. Una operación sin asignaciones no se concilia aquí
-- (SPRINT-4A-T03 reemplaza esta función para exigirlas cuando hay fondo y
-- participantes). Una operación eliminada (cascada) ya no se verifica.
CREATE FUNCTION "daily_tip_allocations_check_operation"("target" uuid) RETURNS void
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

CREATE FUNCTION "daily_tip_allocations_assert_balanced"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'daily_operations' THEN
    PERFORM "daily_tip_allocations_check_operation"(NEW."id");
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM "daily_tip_allocations_check_operation"(OLD."operation_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM "daily_tip_allocations_check_operation"(NEW."operation_id");
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "daily_tip_allocations_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "daily_tip_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "daily_tip_allocations_assert_balanced"();

CREATE CONSTRAINT TRIGGER "daily_operations_tip_allocations_balanced"
  AFTER INSERT OR UPDATE ON "daily_operations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "daily_tip_allocations_assert_balanced"();

CREATE CONSTRAINT TRIGGER "daily_operation_participants_tip_allocations_balanced"
  AFTER INSERT OR UPDATE OR DELETE ON "daily_operation_participants"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "daily_tip_allocations_assert_balanced"();

-- Operación con propinas pagadas: sus montos, fecha y local ya no cambian
-- (el resto —motivo de la diferencia, voucher, updated_at— sí, como con los
-- repartos cerrados de SPRINT-4R-T02).
CREATE FUNCTION "daily_operations_require_unpaid_tips"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."store_id" <> OLD."store_id"
      OR NEW."business_date" <> OLD."business_date"
      OR NEW."card_tip_amount" <> OLD."card_tip_amount"
      OR NEW."cash_tip_amount" <> OLD."cash_tip_amount"
      OR NEW."tip_fund_amount" <> OLD."tip_fund_amount")
     AND EXISTS (
       SELECT 1 FROM "daily_tip_allocations" AS a
       WHERE a."operation_id" = OLD."id" AND a."status" = 'PAID'
     ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se pueden corregir sus montos, fecha o local', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_operations_require_unpaid_tips_rows"
  BEFORE UPDATE ON "daily_operations"
  FOR EACH ROW EXECUTE FUNCTION "daily_operations_require_unpaid_tips"();

-- Participantes de una operación con propinas pagadas: la selección ya no
-- cambia.
CREATE FUNCTION "daily_operation_participants_require_unpaid_tips"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM "daily_tip_allocations" WHERE "status" = 'PAID') THEN
      RAISE EXCEPTION 'Hay propinas diarias pagadas: no se permite TRUNCATE sobre %', TG_TABLE_NAME
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1 FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = OLD."operation_id" AND a."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se permite % sobre participantes', OLD."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1 FROM "daily_tip_allocations" AS a
    WHERE a."operation_id" = NEW."operation_id" AND a."status" = 'PAID'
  ) THEN
    RAISE EXCEPTION 'La operación % tiene propinas pagadas: no se permite % sobre participantes', NEW."operation_id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "daily_operation_participants_require_unpaid_tips_rows"
  BEFORE INSERT OR UPDATE OR DELETE ON "daily_operation_participants"
  FOR EACH ROW EXECUTE FUNCTION "daily_operation_participants_require_unpaid_tips"();

CREATE TRIGGER "daily_operation_participants_require_unpaid_tips_truncate"
  BEFORE TRUNCATE ON "daily_operation_participants"
  FOR EACH STATEMENT EXECUTE FUNCTION "daily_operation_participants_require_unpaid_tips"();

-- Lote de pago: inmutable y auditable (solo INSERT).
CREATE FUNCTION "tip_payment_batches_enforce_immutability"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los lotes de pago de propinas son inmutables: no se permite % sobre tip_payment_batches', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "tip_payment_batches_immutable_rows"
  BEFORE UPDATE OR DELETE ON "tip_payment_batches"
  FOR EACH ROW EXECUTE FUNCTION "tip_payment_batches_enforce_immutability"();

CREATE TRIGGER "tip_payment_batches_immutable_truncate"
  BEFORE TRUNCATE ON "tip_payment_batches"
  FOR EACH STATEMENT EXECUTE FUNCTION "tip_payment_batches_enforce_immutability"();

-- Totales del lote: al commit, total_amount y allocation_count son la suma y
-- la cantidad de las asignaciones que marcó.
CREATE FUNCTION "tip_payment_batches_check_totals"("target" uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  "expected_total" BIGINT;
  "expected_count" INTEGER;
  "actual_total" BIGINT;
  "actual_count" BIGINT;
BEGIN
  SELECT b."total_amount", b."allocation_count"
    INTO "expected_total", "expected_count"
    FROM "tip_payment_batches" AS b WHERE b."id" = "target";
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT count(*), COALESCE(sum(a."amount"), 0)
    INTO "actual_count", "actual_total"
    FROM "daily_tip_allocations" AS a
    WHERE a."payment_batch_id" = "target";
  IF "actual_count" <> "expected_count" OR "actual_total" <> "expected_total" THEN
    RAISE EXCEPTION 'El lote de pago % declara % asignaciones por % y marcó % por %', "target", "expected_count", "expected_total", "actual_count", "actual_total"
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION "tip_payment_batches_assert_totals"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'tip_payment_batches' THEN
    PERFORM "tip_payment_batches_check_totals"(NEW."id");
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."payment_batch_id" IS NOT NULL THEN
    PERFORM "tip_payment_batches_check_totals"(OLD."payment_batch_id");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."payment_batch_id" IS NOT NULL THEN
    PERFORM "tip_payment_batches_check_totals"(NEW."payment_batch_id");
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "tip_payment_batches_totals"
  AFTER INSERT ON "tip_payment_batches"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tip_payment_batches_assert_totals"();

CREATE CONSTRAINT TRIGGER "daily_tip_allocations_batch_totals"
  AFTER INSERT OR UPDATE OR DELETE ON "daily_tip_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "tip_payment_batches_assert_totals"();

-- -------------------------------------------------------------
-- Migración de datos existentes (los triggers anteriores la validan; los
-- diferidos, al commit de esta migración).
-- -------------------------------------------------------------

-- 1. Una asignación UNPAID por participante de cada operación con fondo > 0,
--    con la regla de splitDailyFund (SPRINT-4R-T04): base = fondo / n
--    (división entera) y +$1 a los "fondo mod n" primeros participantes del
--    orden por ID rotado desde la posición (días desde 1970-01-01) mod n. El
--    orden por uuid de PostgreSQL es el mismo que el de su texto en
--    minúsculas que usa la API.
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

-- 2. Un lote histórico por reparto PAID alimentado por operaciones diarias:
--    mismo local y período, pagado por quien pagó el reparto y en su fecha.
INSERT INTO "tip_payment_batches"
  ("store_id", "period_start", "period_end", "total_amount", "allocation_count", "paid_by_id", "paid_at", "legacy_pool_id")
SELECT
  p."store_id",
  p."period_start",
  p."period_end",
  sum(a."amount"),
  count(a."id"),
  COALESCE(p."paid_by_id", p."confirmed_by_id", p."calculated_by_id"),
  COALESCE(p."paid_at", p."updated_at"),
  p."id"
FROM "tip_pools" AS p
INNER JOIN "tip_pool_daily_operation_sources" AS s ON s."pool_id" = p."id"
INNER JOIN "daily_tip_allocations" AS a ON a."operation_id" = s."operation_id"
WHERE p."status" = 'PAID'
GROUP BY p."id";

-- 3. Las asignaciones de esas operaciones quedan PAID en su lote histórico.
UPDATE "daily_tip_allocations" AS a
SET "status" = 'PAID', "payment_batch_id" = b."id", "updated_at" = CURRENT_TIMESTAMP
FROM "tip_payment_batches" AS b
INNER JOIN "tip_pool_daily_operation_sources" AS s ON s."pool_id" = b."legacy_pool_id"
WHERE a."operation_id" = s."operation_id";
