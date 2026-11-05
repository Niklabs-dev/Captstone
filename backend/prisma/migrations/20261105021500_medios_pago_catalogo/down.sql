-- Reversa de 20261105021500_medios_pago_catalogo (SPRINT-4-T32).
-- Prisma no ejecuta este archivo: solo aplica migration.sql. Uso (en backend/):
--   npx prisma db execute --file prisma/migrations/20261105021500_medios_pago_catalogo/down.sql
-- Al final borra el registro de la migración en _prisma_migrations para que
-- `prisma migrate deploy` la vuelva a aplicar. Todo corre en una sola
-- transacción: si algo falla, no queda nada a medias.
--
-- ADVERTENCIA: revierte el catálogo de medios de pago, los FKs de ventas,
-- propinas, líneas y vouchers, y la fuente/período de ventas. Falla a
-- propósito si existe algún medio de pago creado tras T32 que no tenga código
-- del enum antiguo (no se puede clasificar): hay que reclasificarlo antes de
-- revertir.

BEGIN;

-- Triggers (manual): se retiran todos y se restauran al final, cuando las
-- columnas del enum ya existen de nuevo.
DROP TRIGGER "cash_closing_lines_require_open_truncate" ON "cash_closing_lines";
DROP TRIGGER "cash_closing_lines_require_open" ON "cash_closing_lines";
DROP TRIGGER "sales_cash_closing_require_open_truncate" ON "sales";
DROP TRIGGER "sales_cash_closing_require_open" ON "sales";
DROP TRIGGER "sales_tip_entry_consistency" ON "sales";

-- Funciones restauradas a sus versiones anteriores (el cuerpo plpgsql no
-- valida columnas hasta su ejecución, así que pueden reemplazarse antes de
-- recrear las columnas del enum).
CREATE OR REPLACE FUNCTION "sales_check_tip_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tip_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "tip_entries" AS e
    WHERE e."id" = NEW."tip_entry_id"
      AND e."store_id" = NEW."store_id"
      AND e."payment_method" = NEW."payment_method"
      AND e."business_date" = (NEW."sold_at" AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RAISE EXCEPTION 'La venta y su registro de propinas deben coincidir en local, fecha y medio de pago'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "cash_closings_enforce_status"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  "voucher_mrcomanda" NUMERIC;
  "voucher_mp_gross" NUMERIC;
  "voucher_mp_tip" NUMERIC;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'Los cierres de caja no se pueden eliminar: no se permite TRUNCATE sobre cash_closings'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'OPEN' THEN
      RAISE EXCEPTION 'El cierre de caja debe crearse en estado OPEN y cerrarse después'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'CLOSED' THEN
    RAISE EXCEPTION 'El cierre de caja % está cerrado y es inmutable: no se permite % sobre cash_closings', OLD."id", TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW."store_id" <> OLD."store_id"
    OR NEW."business_date" <> OLD."business_date"
    OR NEW."shift" <> OLD."shift" THEN
    RAISE EXCEPTION 'No se puede cambiar el local, el día ni el turno del cierre de caja %', OLD."id"
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW."status" = 'CLOSED' THEN
    SELECT
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MRCOMANDA'), 0),
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MERCADO_PAGO'), 0),
      COALESCE(SUM(v."tip_included_amount"), 0)
    INTO "voucher_mrcomanda", "voucher_mp_gross", "voucher_mp_tip"
    FROM "cash_closing_vouchers" AS v
    WHERE v."closing_id" = NEW."id";

    IF "voucher_mrcomanda" <> NEW."mrcomanda_net_sales"
      OR "voucher_mp_gross" <> NEW."mercado_pago_gross_amount"
      OR "voucher_mp_tip" <> NEW."mercado_pago_tip_amount" THEN
      RAISE EXCEPTION 'Los totales de conciliación del cierre de caja % no coinciden con la suma de sus vouchers', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW."difference_reason" IS NULL AND (
      NEW."reconciliation_difference" <> 0
      OR EXISTS (
        SELECT 1 FROM "cash_closing_lines" AS l
        WHERE l."closing_id" = NEW."id" AND l."difference" <> 0
      )
    ) THEN
      RAISE EXCEPTION 'El cierre de caja % tiene diferencias: el motivo es obligatorio para cerrarlo', NEW."id"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- CHECK e índice único de totales de ventas (manual).
ALTER TABLE "sales"
  DROP CONSTRAINT "sales_mrcomanda_no_tip",
  DROP CONSTRAINT "sales_valid_period",
  DROP CONSTRAINT "sales_source_period_consistency";

DROP INDEX "sales_store_id_payment_method_id_period_start_period_end_key";

-- Índices únicos nuevos fuera antes de devolver las columnas al enum.
DROP INDEX "cash_closing_lines_closing_id_payment_method_id_key";
DROP INDEX "tip_entries_store_id_business_date_payment_method_id_key";

-- Enum, columnas y backfill inverso por código.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER');

ALTER TABLE "sales" ADD COLUMN "payment_method" "PaymentMethod";
ALTER TABLE "tip_entries" ADD COLUMN "payment_method" "PaymentMethod";
ALTER TABLE "cash_closing_lines" ADD COLUMN "payment_method" "PaymentMethod";

UPDATE "sales" AS s
  SET "payment_method" = m."code"::"PaymentMethod"
  FROM "payment_methods" AS m
  WHERE m."id" = s."payment_method_id";

UPDATE "tip_entries" AS e
  SET "payment_method" = m."code"::"PaymentMethod"
  FROM "payment_methods" AS m
  WHERE m."id" = e."payment_method_id";

UPDATE "cash_closing_lines" AS l
  SET "payment_method" = m."code"::"PaymentMethod"
  FROM "payment_methods" AS m
  WHERE m."id" = l."payment_method_id";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sales" WHERE "payment_method" IS NULL) THEN
    RAISE EXCEPTION 'Reversa incompleta: hay medios de pago sin código del enum antiguo; reclasifíquelos antes de revertir' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "tip_entries" WHERE "payment_method" IS NULL) THEN
    RAISE EXCEPTION 'Reversa incompleta: hay medios de pago sin código del enum antiguo; reclasifíquelos antes de revertir' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "cash_closing_lines" WHERE "payment_method" IS NULL) THEN
    RAISE EXCEPTION 'Reversa incompleta: hay medios de pago sin código del enum antiguo; reclasifíquelos antes de revertir' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

ALTER TABLE "sales" ALTER COLUMN "payment_method" SET NOT NULL;
ALTER TABLE "tip_entries" ALTER COLUMN "payment_method" SET NOT NULL;
ALTER TABLE "cash_closing_lines" ALTER COLUMN "payment_method" SET NOT NULL;

-- Índices únicos restaurados sobre la columna del enum (manual).
CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_key" ON "cash_closing_lines"("closing_id", "payment_method");
CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_key" ON "tip_entries"("store_id", "business_date", "payment_method");

-- DropForeignKey
ALTER TABLE "sales" DROP CONSTRAINT "sales_payment_method_id_fkey";
ALTER TABLE "tip_entries" DROP CONSTRAINT "tip_entries_payment_method_id_fkey";
ALTER TABLE "cash_closing_lines" DROP CONSTRAINT "cash_closing_lines_payment_method_id_fkey";
ALTER TABLE "cash_closing_vouchers" DROP CONSTRAINT "cash_closing_vouchers_payment_method_id_fkey";

-- AlterTable
ALTER TABLE "sales"
DROP COLUMN "payment_method_id",
DROP COLUMN "period_end",
DROP COLUMN "period_start",
DROP COLUMN "source";

ALTER TABLE "tip_entries" DROP COLUMN "payment_method_id";
ALTER TABLE "cash_closing_lines" DROP COLUMN "payment_method_id";
ALTER TABLE "cash_closing_vouchers" DROP COLUMN "payment_method_id";

-- Triggers restaurados (las columnas del enum ya existen de nuevo).
CREATE TRIGGER "sales_tip_entry_consistency"
  BEFORE INSERT OR UPDATE OF "tip_entry_id", "store_id", "payment_method", "sold_at" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_check_tip_entry"();

CREATE TRIGGER "sales_cash_closing_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_require_open_cash_closing"();

CREATE TRIGGER "sales_cash_closing_require_open_truncate"
  BEFORE TRUNCATE ON "sales"
  FOR EACH STATEMENT EXECUTE FUNCTION "sales_require_open_cash_closing"();

CREATE TRIGGER "cash_closing_lines_require_open"
  BEFORE INSERT OR UPDATE OR DELETE ON "cash_closing_lines"
  FOR EACH ROW EXECUTE FUNCTION "cash_closing_children_require_open"();

CREATE TRIGGER "cash_closing_lines_require_open_truncate"
  BEFORE TRUNCATE ON "cash_closing_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "cash_closing_children_require_open"();

-- DropTable
DROP TABLE "payment_methods";

-- DropEnum
DROP TYPE "PaymentMethodBehavior";
DROP TYPE "SaleSource";

-- Registro de la migración (manual): permite que migrate deploy la reaplique.
DELETE FROM "_prisma_migrations"
  WHERE "migration_name" = '20261105021500_medios_pago_catalogo';

COMMIT;
