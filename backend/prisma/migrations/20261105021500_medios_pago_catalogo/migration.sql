-- SPRINT-4-T32: medios de pago administrables y ventas MrComanda.
--
-- La base garantiza (para cualquier rol y vía de escritura: Prisma, SQL
-- directo o cascadas; solo session_replication_role = replica las omite, y
-- esta migración NO la usa):
-- - Catálogo payment_methods con código único e inmutable (contrato
--   operativo), nombre, orden, comportamiento (CASH / RECONCILABLE_CARD /
--   EXTERNAL_OTHER) y disponibilidad para propinas. Los cuatro códigos del
--   enum reemplazado (CASH, DEBIT_CARD, CREDIT_CARD, TRANSFER) se conservan
--   con UUID fijos, coincidentes con prisma/seed.ts (upsert idempotente por
--   código con update: {}, sin revertir la administración vía API).
-- - Sale, TipEntry y CashClosingLine referencian el catálogo por FK; los
--   valores históricos del enum se transfieren con backfill por código antes
--   de retirar las columnas y el enum. Las claves únicas de propinas y líneas
--   se recrean sobre el FK.
-- - Sale.source (MANUAL / MRCOMANDA) y período nullable: las cargas MrComanda
--   son únicas por local, medio y período (índice único; los períodos NULL de
--   las ventas manuales no colisionan en PostgreSQL). CHECK: origen y período
--   van siempre juntos, fin > inicio y las ventas MrComanda no llevan propina
--   (PROPINAS conserva su fuente propia en tip_entries).
-- - CashClosingVoucher.payment_method_id clasifica vouchers MrComanda nuevos;
--   la transición a CLOSED compara mrcomanda_net_sales solo con vouchers
--   MrComanda RECONCILABLE_CARD o sin clasificar (los históricos NULL
--   conservan el comportamiento heredado); los de CASH u EXTERNAL_OTHER
--   quedan fuera de la conciliación y no se suman dos veces.
-- - Se retiran y restauran explícitamente solo los triggers que bloquearían
--   el backfill (ventas y líneas de cierres CLOSED) y se actualizan
--   sales_check_tip_entry y cash_closings_enforce_status a los nuevos FKs.
--
-- La reversa está en down.sql (misma carpeta; Prisma solo aplica
-- migration.sql).

-- CreateEnum
CREATE TYPE "PaymentMethodBehavior" AS ENUM ('CASH', 'RECONCILABLE_CARD', 'EXTERNAL_OTHER');

-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('MANUAL', 'MRCOMANDA');

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "behavior" "PaymentMethodBehavior" NOT NULL,
    "available_for_tips" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_code_key" ON "payment_methods"("code");

-- Catálogo base: mismos códigos del enum reemplazado, con orden,
-- comportamiento y disponibilidad para propinas. Los UUID fijos coinciden
-- con prisma/seed.ts para que el seed haga upsert por código.
INSERT INTO "payment_methods" (
    "id", "code", "name", "sort_order", "is_active", "behavior",
    "available_for_tips", "created_at", "updated_at"
) VALUES
    ('b9000000-0000-4000-8000-000000000001', 'CASH', 'Efectivo', 10, true, 'CASH', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('b9000000-0000-4000-8000-000000000002', 'DEBIT_CARD', 'Tarjeta de débito', 20, true, 'RECONCILABLE_CARD', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('b9000000-0000-4000-8000-000000000003', 'CREDIT_CARD', 'Tarjeta de crédito', 30, true, 'RECONCILABLE_CARD', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('b9000000-0000-4000-8000-000000000004', 'TRANSFER', 'Transferencia', 40, true, 'EXTERNAL_OTHER', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable: las nuevas FKs se agregan NULLABLE junto a las columnas del
-- enum para permitir el backfill antes de exigirlas.
ALTER TABLE "sales"
ADD COLUMN     "payment_method_id" UUID,
ADD COLUMN     "period_end" TIMESTAMPTZ(6),
ADD COLUMN     "period_start" TIMESTAMPTZ(6),
ADD COLUMN     "source" "SaleSource" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "tip_entries" ADD COLUMN     "payment_method_id" UUID;

ALTER TABLE "cash_closing_lines" ADD COLUMN     "payment_method_id" UUID;

ALTER TABLE "cash_closing_vouchers" ADD COLUMN     "payment_method_id" UUID;

-- AddForeignKey (la NOT NULL llega después del backfill)
ALTER TABLE "sales" ADD CONSTRAINT "sales_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tip_entries" ADD CONSTRAINT "tip_entries_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_closing_lines" ADD CONSTRAINT "cash_closing_lines_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_closing_vouchers" ADD CONSTRAINT "cash_closing_vouchers_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Origen y período de la venta van siempre juntos; el período es un rango
-- válido; las cargas MrComanda agregan totales netos sin propina (PROPINAS
-- conserva su fuente propia en tip_entries).
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_source_period_consistency" CHECK (
    ("source" = 'MRCOMANDA' AND "period_start" IS NOT NULL AND "period_end" IS NOT NULL)
    OR ("source" = 'MANUAL' AND "period_start" IS NULL AND "period_end" IS NULL)
  ),
  ADD CONSTRAINT "sales_valid_period" CHECK (
    "period_end" IS NULL OR "period_end" > "period_start"
  ),
  ADD CONSTRAINT "sales_mrcomanda_no_tip" CHECK (
    "source" <> 'MRCOMANDA' OR "tip_amount" = 0
  );

-- Idempotencia de las cargas MrComanda: un total por local, medio y período.
-- Los períodos NULL de las ventas manuales no colisionan: PostgreSQL trata
-- cada NULL como distinto en un índice único.
CREATE UNIQUE INDEX "sales_store_id_payment_method_id_period_start_period_end_key" ON "sales"("store_id", "payment_method_id", "period_start", "period_end");

-- Retiro temporal de los triggers que bloquearían el backfill sobre filas
-- históricas de cierres CLOSED, y del trigger que referencia la columna del
-- enum (se recrea actualizado más abajo). Las funciones no se tocan y los
-- triggers se restauran íntegros al final. No se usa
-- session_replication_role.
DROP TRIGGER "sales_tip_entry_consistency" ON "sales";
DROP TRIGGER "sales_cash_closing_require_open" ON "sales";
DROP TRIGGER "sales_cash_closing_require_open_truncate" ON "sales";
DROP TRIGGER "cash_closing_lines_require_open" ON "cash_closing_lines";
DROP TRIGGER "cash_closing_lines_require_open_truncate" ON "cash_closing_lines";

-- Backfill: cada fila histórica adopta el catálogo por el texto del enum.
UPDATE "sales" AS s
  SET "payment_method_id" = m."id"
  FROM "payment_methods" AS m
  WHERE s."payment_method_id" IS NULL
    AND m."code" = s."payment_method"::text;

UPDATE "tip_entries" AS e
  SET "payment_method_id" = m."id"
  FROM "payment_methods" AS m
  WHERE e."payment_method_id" IS NULL
    AND m."code" = e."payment_method"::text;

UPDATE "cash_closing_lines" AS l
  SET "payment_method_id" = m."id"
  FROM "payment_methods" AS m
  WHERE l."payment_method_id" IS NULL
    AND m."code" = l."payment_method"::text;

-- El backfill debe ser total: ninguna fila histórica puede quedar sin medio
-- de pago (los cuatro códigos del enum tienen su catálogo).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sales" WHERE "payment_method_id" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incompleto: hay ventas históricas sin medio de pago mapeado' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "tip_entries" WHERE "payment_method_id" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incompleto: hay registros de propinas sin medio de pago mapeado' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "cash_closing_lines" WHERE "payment_method_id" IS NULL) THEN
    RAISE EXCEPTION 'Backfill incompleto: hay líneas de cierre sin medio de pago mapeado' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- Claves únicas recreadas sobre el FK del catálogo.
DROP INDEX "tip_entries_store_id_business_date_payment_method_key";
CREATE UNIQUE INDEX "tip_entries_store_id_business_date_payment_method_id_key" ON "tip_entries"("store_id", "business_date", "payment_method_id");

DROP INDEX "cash_closing_lines_closing_id_payment_method_key";
CREATE UNIQUE INDEX "cash_closing_lines_closing_id_payment_method_id_key" ON "cash_closing_lines"("closing_id", "payment_method_id");

-- Solo ahora se exige el FK en las tres tablas operativas.
ALTER TABLE "sales" ALTER COLUMN "payment_method_id" SET NOT NULL;
ALTER TABLE "tip_entries" ALTER COLUMN "payment_method_id" SET NOT NULL;
ALTER TABLE "cash_closing_lines" ALTER COLUMN "payment_method_id" SET NOT NULL;

-- Y después se retiran las columnas del enum y el enum mismo.
ALTER TABLE "sales" DROP COLUMN "payment_method";
ALTER TABLE "tip_entries" DROP COLUMN "payment_method";
ALTER TABLE "cash_closing_lines" DROP COLUMN "payment_method";
DROP TYPE "PaymentMethod";

-- Una venta solo se reconcilia con un registro del mismo local, medio y día
-- de negocio, ahora comparando los FKs del catálogo (misma regla y misma
-- fecha en hora de Chile que la versión anterior).
CREATE OR REPLACE FUNCTION "sales_check_tip_entry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."tip_entry_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "tip_entries" AS e
    WHERE e."id" = NEW."tip_entry_id"
      AND e."store_id" = NEW."store_id"
      AND e."payment_method_id" = NEW."payment_method_id"
      AND e."business_date" = (NEW."sold_at" AT TIME ZONE 'America/Santiago')::date
  ) THEN
    RAISE EXCEPTION 'La venta y su registro de propinas deben coincidir en local, fecha y medio de pago'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "sales_tip_entry_consistency"
  BEFORE INSERT OR UPDATE OF "tip_entry_id", "store_id", "payment_method_id", "sold_at" ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "sales_check_tip_entry"();

-- Transición a CLOSED: mrcomanda_net_sales solo recibe vouchers MrComanda
-- clasificados con un medio RECONCILABLE_CARD; los vouchers históricos sin
-- clasificación (NULL) conservan el comportamiento heredado y siguen
-- sumando. El resto de la regla (immutabilidad, motivo obligatorio con
-- diferencias y totales Mercado Pago contra sus vouchers) no cambia.
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
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MRCOMANDA' AND (v."payment_method_id" IS NULL OR m."behavior" = 'RECONCILABLE_CARD')), 0),
      COALESCE(SUM(v."amount") FILTER (WHERE v."source" = 'MERCADO_PAGO'), 0),
      COALESCE(SUM(v."tip_included_amount"), 0)
    INTO "voucher_mrcomanda", "voucher_mp_gross", "voucher_mp_tip"
    FROM "cash_closing_vouchers" AS v
    LEFT JOIN "payment_methods" AS m ON m."id" = v."payment_method_id"
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

-- Restauración íntegra de los triggers retirados para el backfill (las
-- funciones sales_require_open_cash_closing y cash_closing_children_require_open
-- no se modificaron).
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
